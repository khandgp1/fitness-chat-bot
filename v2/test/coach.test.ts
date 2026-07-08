import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoach, type Coach } from '../src/agents/coach.js';
import { createFakeLlmClient, type FakeLlmClient } from '../src/agents/llmClient.js';
import { createAutonomyPolicy } from '../src/approval/autonomy.js';
import { createContextBuilder } from '../src/pipeline/context.js';
import { createAuditRepo, type AuditRepo } from '../src/repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from '../src/repos/clientRepo.js';
import { createComplianceRepo } from '../src/repos/complianceRepo.js';
import { createDraftRepo, type DraftRepo } from '../src/repos/draftRepo.js';
import { createMessageRepo, type MessageRepo } from '../src/repos/messageRepo.js';
import { createNarrativeStore, type NarrativeStore } from '../src/repos/narrativeStore.js';
import { createPromptStore } from '../src/repos/promptStore.js';
import { makeTestDb, type TestCtx } from './helpers/testDb.js';

let ctx: TestCtx;
let audit: AuditRepo;
let clients: ClientRepo;
let messages: MessageRepo;
let drafts: DraftRepo;
let narratives: NarrativeStore;
let llm: FakeLlmClient;
let coach: Coach;
let clientId: string;

const DRAFT_CALL = (over: Record<string, unknown> = {}) => ({
  type: 'tool_use' as const,
  id: 'tu-draft',
  name: 'draft_response',
  input: {
    text: 'Yes, 1-to-1 swap. Keep the portion the same.',
    response_type: 'coaching_answer',
    confidence: 0.9,
    ...over,
  },
});

beforeEach(() => {
  ctx = makeTestDb();
  audit = createAuditRepo(ctx.db, ctx.clock);
  clients = createClientRepo(ctx.db, ctx.clock, audit);
  messages = createMessageRepo(ctx.db, ctx.clock, audit);
  drafts = createDraftRepo(ctx.db, ctx.clock, audit);
  const compliance = createComplianceRepo(ctx.db, ctx.clock, audit);
  narratives = createNarrativeStore(ctx.db, ctx.clock, audit, {
    narrativesDir: join(ctx.dir, 'narratives'),
  });

  const promptsDir = join(ctx.dir, 'prompts');
  mkdirSync(promptsDir);
  writeFileSync(join(promptsDir, 'coach_system.md'), 'you draft replies\n');
  writeFileSync(join(promptsDir, 'coach_persona.md'), 'no emojis\n');
  writeFileSync(join(promptsDir, 'coach_examples.md'), 'examples here\n');
  writeFileSync(
    join(promptsDir, 'autonomy.yaml'),
    'autonomy:\n  coaching_answer: { level: 0, auto_send_min_confidence: null }\n'
  );
  const prompts = createPromptStore({ promptsDir });

  llm = createFakeLlmClient();
  coach = createCoach({
    llm,
    prompts,
    audit,
    messages,
    compliance,
    narratives,
    drafts,
    context: createContextBuilder(
      { clock: ctx.clock, clients, messages, compliance, narratives },
      { maxMessages: 30, maxDays: 14 }
    ),
    autonomy: createAutonomyPolicy({ prompts }),
    model: 'sonnet-test',
    maxTurns: 3,
  });

  const c = clients.create({ displayName: 'Mike', timezone: 'UTC' });
  clients.verify(c.id);
  clientId = c.id;
  messages.appendInbound({ clientId, text: 'can I swap rice for sweet potato?' });
});
afterEach(() => ctx.cleanup());

describe('coach loop', () => {
  it('1-turn happy path: draft created, covers the newest inbound, audited', async () => {
    llm.enqueueTurn([DRAFT_CALL({ note: 'straightforward swap' })]);
    const draft = await coach.draft(clientId);

    expect(draft.status).toBe('draft');
    expect(draft.responseType).toBe('coaching_answer');
    expect(draft.confidence).toBe(0.9);
    expect(draft.autonomyLevel).toBe(0);
    expect(draft.coversThroughMessageId).toBe(messages.latestInbound(clientId)!.id);

    expect(llm.converseRequests).toHaveLength(1);
    expect(llm.converseRequests[0]!.toolChoice).toEqual({ type: 'auto' });
    expect(llm.converseRequests[0]!.system).toContain('no emojis');
    const call = audit.listLlmCalls({ clientId })[0]!;
    expect(call.agent).toBe('coach');
    expect(call.promptFileHash).toMatch(/\+.*\+/); // three joined hashes
  });

  it('pull-then-draft: read tool executes and its result feeds the next turn', async () => {
    llm.enqueueTurn([
      { type: 'tool_use', id: 'tu-1', name: 'get_recent_conversation', input: { limit: 5 } },
    ]);
    llm.enqueueTurn([DRAFT_CALL()]);

    const draft = await coach.draft(clientId);
    expect(draft.status).toBe('draft');
    expect(llm.converseRequests).toHaveLength(2);

    // turn 2's history contains the tool result with real conversation text
    const turn2 = llm.converseRequests[1]!;
    const lastMsg = turn2.messages[turn2.messages.length - 1]!;
    const blocks = lastMsg.content as Array<{ type: string; content?: string }>;
    expect(blocks[0]!.type).toBe('tool_result');
    expect(blocks[0]!.content).toContain('swap rice');
  });

  it('forces draft_response on the final turn (P3-4)', async () => {
    llm.enqueueTurn([{ type: 'text', text: 'thinking out loud' }]); // no tool call
    llm.enqueueTurn([{ type: 'text', text: 'still dithering' }]);
    llm.enqueueTurn([DRAFT_CALL()]);

    await coach.draft(clientId);
    expect(llm.converseRequests[0]!.toolChoice).toEqual({ type: 'auto' });
    expect(llm.converseRequests[1]!.toolChoice).toEqual({ type: 'auto' });
    expect(llm.converseRequests[2]!.toolChoice).toEqual({ type: 'tool', name: 'draft_response' });
  });

  it('flag_for_narrative lands a flag even alongside a same-turn draft', async () => {
    llm.enqueueTurn([
      { type: 'tool_use', id: 'tu-flag', name: 'flag_for_narrative', input: { note: 'started night shifts' } },
      DRAFT_CALL(),
    ]);
    await coach.draft(clientId);
    const flags = narratives.listUnclearedFlags(clientId);
    expect(flags.map((f) => f.note)).toEqual(['started night shifts']);
    expect(flags[0]!.createdBy).toBe('agent');
  });

  it('a model-invented response_type fails the draft loudly', async () => {
    llm.enqueueTurn([DRAFT_CALL({ response_type: 'sales_pitch' })]);
    await expect(coach.draft(clientId)).rejects.toThrow(/response_type/);
    expect(drafts.getActive(clientId)).toBeUndefined();
    expect(audit.listEvents({ clientId }).map((e) => e.action)).toContain('coach_draft_failed');
  });

  it('refuses when there is nothing to reply to', async () => {
    const empty = clients.create({ displayName: 'Silent', timezone: 'UTC' });
    clients.verify(empty.id);
    await expect(coach.draft(empty.id)).rejects.toThrow(/no inbound/);
  });
});
