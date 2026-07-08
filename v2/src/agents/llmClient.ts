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

export interface LlmClient {
  completeWithTool(req: LlmToolRequest): Promise<LlmToolResult>;
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
  };
}

/** Boot-safe stand-in when no API key is configured: fails loudly per call. */
export function createUnconfiguredLlmClient(): LlmClient {
  return {
    completeWithTool() {
      return Promise.reject(
        new Error('ANTHROPIC_API_KEY is not configured — LLM calls are unavailable')
      );
    },
  };
}

/**
 * Test double. Responses are queued PER TOOL NAME so parallel router/classifier
 * calls can't race on ordering. Enqueue an Error to script a failure.
 */
export interface FakeLlmClient extends LlmClient {
  enqueue(toolName: string, result: unknown | Error): void;
  readonly requests: LlmToolRequest[];
}

export function createFakeLlmClient(): FakeLlmClient {
  const queues = new Map<string, Array<unknown | Error>>();
  const requests: LlmToolRequest[] = [];
  return {
    requests,
    enqueue(toolName, result) {
      const q = queues.get(toolName) ?? [];
      q.push(result);
      queues.set(toolName, q);
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
  };
}
