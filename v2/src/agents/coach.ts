import type { AuditRepo } from '../repos/auditRepo.js';
import type { ComplianceRepo } from '../repos/complianceRepo.js';
import type { DraftRepo } from '../repos/draftRepo.js';
import type { MessageRepo } from '../repos/messageRepo.js';
import type { NarrativeStore } from '../repos/narrativeStore.js';
import type { PromptStore } from '../repos/promptStore.js';
import type { Draft, ResponseType } from '../repos/types.js';
import type { AutonomyPolicy } from '../approval/autonomy.js';
import type { ContextBuilder } from '../pipeline/context.js';
import type { LlmClient, LlmContentBlock, LlmMessage } from './llmClient.js';

/**
 * The Primary Coaching Agent (Phase 3 §2.3): a bounded tool loop that MUST
 * terminate in draft_response (P3-4 — forced on the final turn). Tools are
 * deterministic handlers; the model only ever produces arguments. No send
 * capability, no narrative mutation, no compliance writes.
 */
export interface Coach {
  draft(clientId: string): Promise<Draft>;
}

const RESPONSE_TYPES: readonly ResponseType[] = [
  'gm_ack',
  'status_ack',
  'coaching_answer',
  'accountability_followup',
];

const TOOLS = [
  {
    name: 'get_recent_conversation',
    description:
      'Pull older conversation history, before a given message id. Use only when the pushed context is genuinely insufficient.',
    inputSchema: {
      type: 'object',
      properties: {
        before_message_id: { type: 'string' },
        limit: { type: 'integer', maximum: 50 },
      },
    },
  },
  {
    name: 'get_compliance_summary',
    description: 'Pull a longer compliance window (day-by-day statuses), up to 90 days.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'integer', maximum: 90 } },
    },
  },
  {
    name: 'flag_for_narrative',
    description:
      'Mark a durable fact or pattern worth adding to the client narrative (schedule change, new obstacle, what landed well).',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
  },
  {
    name: 'draft_response',
    description:
      'Submit your draft reply. This ends your turn. note is for the coach only — never sent to the client.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        response_type: { enum: [...RESPONSE_TYPES] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        note: { type: 'string' },
      },
      required: ['text', 'response_type', 'confidence'],
    },
  },
];

interface DraftArgs {
  text: string;
  responseType: ResponseType;
  confidence: number;
  note?: string;
}

function validateDraftArgs(input: unknown): DraftArgs {
  if (typeof input !== 'object' || input === null) throw new Error('draft_response: not an object');
  const r = input as Record<string, unknown>;
  if (typeof r.text !== 'string' || r.text.trim() === '') {
    throw new Error('draft_response: text missing or empty');
  }
  if (!RESPONSE_TYPES.includes(r.response_type as ResponseType)) {
    throw new Error(`draft_response: invalid response_type '${String(r.response_type)}'`);
  }
  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    throw new Error(`draft_response: confidence out of range: ${String(r.confidence)}`);
  }
  if (r.note !== undefined && typeof r.note !== 'string') {
    throw new Error('draft_response: note not a string');
  }
  return {
    text: r.text,
    responseType: r.response_type as ResponseType,
    confidence: r.confidence,
    note: r.note as string | undefined,
  };
}

export function createCoach(deps: {
  llm: LlmClient;
  prompts: PromptStore;
  audit: AuditRepo;
  messages: MessageRepo;
  compliance: ComplianceRepo;
  narratives: NarrativeStore;
  drafts: DraftRepo;
  context: ContextBuilder;
  autonomy: AutonomyPolicy;
  model: string;
  maxTurns: number;
}): Coach {
  const assembleSystem = (): { system: string; gitHash: string } => {
    const files = ['coach_system.md', 'coach_persona.md', 'coach_examples.md'].map((f) =>
      deps.prompts.get(f)
    );
    return {
      system: files.map((f) => f.content).join('\n\n'),
      gitHash: files.map((f) => f.gitHash).join('+'),
    };
  };

  // Read tools return text; the model reads it as a tool_result next turn.
  const runReadTool = (clientId: string, name: string, input: unknown): string => {
    const args = (input ?? {}) as Record<string, unknown>;
    if (name === 'get_recent_conversation') {
      const limit = Math.min(typeof args.limit === 'number' ? args.limit : 30, 50);
      const beforeId = typeof args.before_message_id === 'string' ? args.before_message_id : undefined;
      const older = deps.messages.list(clientId, { beforeId, limit }).reverse();
      if (older.length === 0) return '(no older messages)';
      return older
        .map((m) => `[${m.createdAt}] ${m.direction === 'inbound' ? 'CLIENT' : 'COACH'}: ${m.text}`)
        .join('\n');
    }
    if (name === 'get_compliance_summary') {
      const days = deps.compliance.listDays(clientId, '0000-01-01', '9999-12-31');
      const requested = Math.min(typeof args.days === 'number' ? args.days : 30, 90);
      const window = days.slice(-requested);
      if (window.length === 0) return '(no compliance history)';
      return window.map((d) => `${d.date}: ${d.status} (streak ${d.streakAfter ?? 'held'})`).join('\n');
    }
    throw new Error(`Unknown read tool: ${name}`);
  };

  return {
    async draft(clientId) {
      const latestInbound = deps.messages.latestInbound(clientId);
      if (latestInbound === undefined) {
        throw new Error(`Client ${clientId} has no inbound messages to reply to`);
      }

      const { system, gitHash } = assembleSystem();
      const messages: LlmMessage[] = [{ role: 'user', content: deps.context.build(clientId) }];

      for (let turn = 1; turn <= deps.maxTurns; turn++) {
        const finalTurn = turn === deps.maxTurns;
        const started = Date.now();
        let content: LlmContentBlock[];
        try {
          const res = await deps.llm.converse({
            model: deps.model,
            system,
            messages,
            tools: TOOLS,
            // P3-4: the loop cannot end without a draft — force it at the cap.
            toolChoice: finalTurn ? { type: 'tool', name: 'draft_response' } : { type: 'auto' },
            maxTokens: 1024,
          });
          content = res.content;
          deps.audit.llmCall({
            clientId,
            agent: 'coach',
            model: deps.model,
            promptFileHash: gitHash,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            latencyMs: res.latencyMs,
            result: { turn, content },
          });
        } catch (err) {
          deps.audit.llmCall({
            clientId,
            agent: 'coach',
            model: deps.model,
            promptFileHash: gitHash,
            latencyMs: Date.now() - started,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        messages.push({ role: 'assistant', content });
        const toolCalls = content.filter(
          (b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
        );

        // Non-terminal tools first (a flag alongside a draft still lands).
        let draftArgs: DraftArgs | undefined;
        const results: LlmContentBlock[] = [];
        for (const call of toolCalls) {
          if (call.name === 'draft_response') {
            try {
              draftArgs = validateDraftArgs(call.input);
            } catch (err) {
              deps.audit.event({
                clientId,
                actor: 'system',
                action: 'coach_draft_failed',
                details: { reason: err instanceof Error ? err.message : String(err) },
              });
              throw err;
            }
          } else if (call.name === 'flag_for_narrative') {
            const note = (call.input as Record<string, unknown> | null)?.note;
            if (typeof note === 'string' && note.trim() !== '') {
              deps.narratives.addFlag(clientId, note, 'agent');
            }
            results.push({ type: 'tool_result', toolUseId: call.id, content: 'noted' });
          } else {
            results.push({
              type: 'tool_result',
              toolUseId: call.id,
              content: runReadTool(clientId, call.name, call.input),
            });
          }
        }

        if (draftArgs !== undefined) {
          return deps.drafts.create({
            clientId,
            coversThroughMessageId: latestInbound.id,
            draftText: draftArgs.text,
            responseType: draftArgs.responseType,
            confidence: draftArgs.confidence,
            autonomyLevel: deps.autonomy.levelFor(draftArgs.responseType).level,
          });
        }

        messages.push(
          toolCalls.length > 0
            ? { role: 'user', content: results }
            : { role: 'user', content: 'You must finish by calling draft_response with your reply.' }
        );
      }
      // Unreachable: the final turn forces draft_response or throws above.
      throw new Error('Coach loop ended without a draft');
    },
  };
}
