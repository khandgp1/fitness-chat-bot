import Anthropic from '@anthropic-ai/sdk';

/**
 * One seam for LLM calls. The client returns parsed tool input + usage;
 * it never interprets results — validation belongs to the agents.
 * FakeLlmClient is the test default; nothing in CI touches the network (P4-4).
 */
export interface LlmToolRequest {
  model: string;
  system: string;
  userText: string;
  tool: { name: string; description: string; inputSchema: Record<string, unknown> };
  maxTokens?: number;
}

export interface LlmToolResult {
  input: unknown; // the forced tool call's arguments (unvalidated)
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

// converse(): one turn of a tool-choice conversation (the coach's loop lives
// in coach.ts — the client only translates one round trip).
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmContentBlock[];
}

export interface LlmConverseRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  toolChoice?: { type: 'auto' } | { type: 'tool'; name: string };
  maxTokens?: number;
}

export interface LlmConverseResult {
  content: LlmContentBlock[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LlmClient {
  completeWithTool(req: LlmToolRequest): Promise<LlmToolResult>;
  converse(req: LlmConverseRequest): Promise<LlmConverseResult>;
}

export function createAnthropicLlmClient(opts: { apiKey: string }): LlmClient {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return {
    async completeWithTool(req) {
      const started = Date.now();
      const response = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 512,
        system: req.system,
        messages: [{ role: 'user', content: req.userText }],
        tools: [
          {
            name: req.tool.name,
            description: req.tool.description,
            input_schema: req.tool.inputSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: req.tool.name },
      });
      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (toolUse === undefined) {
        throw new Error('Model returned no tool call despite forced tool_choice');
      }
      return {
        input: toolUse.input,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - started,
      };
    },

    async converse(req) {
      const started = Date.now();
      const response = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        messages: req.messages.map(toApiMessage),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        tool_choice:
          req.toolChoice?.type === 'tool'
            ? { type: 'tool', name: req.toolChoice.name }
            : { type: 'auto' },
      });
      const content: LlmContentBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'tool_use') {
          content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
        }
      }
      return {
        content,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - started,
      };
    },
  };
}

function toApiMessage(m: LlmMessage): Anthropic.MessageParam {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  const blocks: Anthropic.ContentBlockParam[] = m.content.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'tool_use') {
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    }
    return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content };
  });
  return { role: m.role, content: blocks };
}

/** Boot-safe stand-in when no API key is configured: fails loudly per call. */
export function createUnconfiguredLlmClient(): LlmClient {
  const fail = () =>
    Promise.reject(new Error('ANTHROPIC_API_KEY is not configured — LLM calls are unavailable'));
  return { completeWithTool: fail, converse: fail };
}

/**
 * Test double. Single-shot responses are queued PER TOOL NAME so parallel
 * router/classifier calls can't race on ordering; converse turns are a simple
 * FIFO queue. Enqueue an Error to script a failure.
 */
export interface FakeLlmClient extends LlmClient {
  enqueue(toolName: string, result: unknown | Error): void;
  enqueueTurn(turn: LlmContentBlock[] | Error): void;
  readonly requests: LlmToolRequest[];
  readonly converseRequests: LlmConverseRequest[];
}

export function createFakeLlmClient(): FakeLlmClient {
  const queues = new Map<string, Array<unknown | Error>>();
  const turns: Array<LlmContentBlock[] | Error> = [];
  const requests: LlmToolRequest[] = [];
  const converseRequests: LlmConverseRequest[] = [];
  return {
    requests,
    converseRequests,
    enqueue(toolName, result) {
      const q = queues.get(toolName) ?? [];
      q.push(result);
      queues.set(toolName, q);
    },
    enqueueTurn(turn) {
      turns.push(turn);
    },
    async completeWithTool(req) {
      requests.push(req);
      const q = queues.get(req.tool.name);
      const next = q?.shift();
      if (next === undefined) {
        throw new Error(`FakeLlmClient: no queued response for tool '${req.tool.name}'`);
      }
      if (next instanceof Error) throw next;
      return { input: next, inputTokens: 100, outputTokens: 25, latencyMs: 1 };
    },
    async converse(req) {
      // Snapshot the message list — callers mutate their array across turns.
      converseRequests.push({ ...req, messages: [...req.messages] });
      const next = turns.shift();
      if (next === undefined) throw new Error('FakeLlmClient: no queued converse turn');
      if (next instanceof Error) throw next;
      return { content: next, inputTokens: 200, outputTokens: 50, latencyMs: 1 };
    },
  };
}
