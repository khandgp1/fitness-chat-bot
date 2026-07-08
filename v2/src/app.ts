import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChannelAdapter } from './adapters/types.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { createCoach } from './agents/coach.js';
import { createGmClassifier } from './agents/gmClassifier.js';
import {
  createAnthropicLlmClient,
  createUnconfiguredLlmClient,
  type LlmClient,
} from './agents/llmClient.js';
import { createRouter } from './agents/router.js';
import { createAutonomyPolicy } from './approval/autonomy.js';
import { createDraftService, type DraftService } from './approval/drafts.js';
import { createClock, type Clock } from './clock/clock.js';
import { loadConfig, type Config } from './config/config.js';
import { openDb, type Db } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { createComplianceEngine, type ComplianceEngine } from './domain/compliance.js';
import { createContextBuilder } from './pipeline/context.js';
import { createDebouncer, type Debouncer } from './pipeline/debounce.js';
import { createIngestor, type Ingestor } from './pipeline/ingest.js';
import { createProcessor, type Processor } from './pipeline/process.js';
import { createPromptStore, type PromptStore } from './repos/promptStore.js';
import { createAuditRepo, type AuditRepo } from './repos/auditRepo.js';
import { createClientRepo, type ClientRepo } from './repos/clientRepo.js';
import { createComplianceRepo, type ComplianceRepo } from './repos/complianceRepo.js';
import { createDraftRepo, type DraftRepo } from './repos/draftRepo.js';
import { createMessageRepo, type MessageRepo } from './repos/messageRepo.js';
import { createNarrativeStore, type NarrativeStore } from './repos/narrativeStore.js';

const TICK_MS = 15 * 60 * 1000; // reconcile + sweep; both idempotent and cheap

export interface AppDeps {
  cfg: Config;
  db: Db;
  clock: Clock;
  audit: AuditRepo;
  clients: ClientRepo;
  messages: MessageRepo;
  compliance: ComplianceRepo;
  drafts: DraftRepo;
  narratives: NarrativeStore;
  engine: ComplianceEngine;
  debouncer: Debouncer;
  ingestor: Ingestor;
  adapter: ChannelAdapter;
  prompts: PromptStore;
  processor: Processor;
  draftService: DraftService;
}

export interface App {
  deps: AppDeps;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Composition root. Boot sequence (Stage 3 spec): config → DB → migrate →
 * reconcileAll → sweep → adapter → periodic tick.
 */
export function buildApp(
  opts: { cfg?: Config; adapter?: ChannelAdapter; clock?: Clock; llm?: LlmClient } = {}
): App {
  const cfg = opts.cfg ?? loadConfig();

  mkdirSync(dirname(cfg.dbPath), { recursive: true });
  const db = openDb(cfg.dbPath);
  runMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));

  const clock =
    opts.clock ?? createClock({ devMode: cfg.devMode, offsetFile: `${cfg.dbPath}.clock.json` });
  const audit = createAuditRepo(db, clock);
  const clients = createClientRepo(db, clock, audit);
  const messages = createMessageRepo(db, clock, audit);
  const compliance = createComplianceRepo(db, clock, audit);
  const drafts = createDraftRepo(db, clock, audit);
  const narratives = createNarrativeStore(db, clock, audit, { narrativesDir: cfg.narrativesDir });
  const engine = createComplianceEngine({ db, clock, clients, compliance, audit });

  const prompts = createPromptStore({ promptsDir: cfg.promptsDir });
  const llm =
    opts.llm ??
    (cfg.anthropicApiKey !== undefined
      ? createAnthropicLlmClient({ apiKey: cfg.anthropicApiKey })
      : createUnconfiguredLlmClient());
  const router = createRouter({ llm, prompts, audit, model: cfg.routerModel });
  const classifier = createGmClassifier({ llm, prompts, audit, model: cfg.classifierModel });
  const processor = createProcessor({
    clock,
    clients,
    messages,
    compliance,
    engine,
    router,
    classifier,
    classifierModel: cfg.classifierModel,
  });

  const adapter =
    opts.adapter ??
    createTelegramAdapter({
      token:
        cfg.telegramToken ??
        (() => {
          throw new Error('TELEGRAM_TOKEN is required to start the telegram adapter');
        })(),
    });

  const contextBuilder = createContextBuilder(
    { clock, clients, messages, compliance, narratives },
    { maxMessages: cfg.contextMaxMessages, maxDays: cfg.contextMaxDays }
  );
  const autonomy = createAutonomyPolicy({ prompts });
  const coach = createCoach({
    llm,
    prompts,
    audit,
    messages,
    compliance,
    narratives,
    drafts,
    context: contextBuilder,
    autonomy,
    model: cfg.coachModel,
    maxTurns: cfg.maxCoachTurns,
  });
  const draftService = createDraftService({ db, clients, messages, drafts, coach, adapter });

  const debouncer = createDebouncer(
    { db, clock, messages },
    {
      debounceMs: cfg.debounceMinutes * 60 * 1000,
      onBatchClosed: (batchId, clientId) => {
        console.log(`[pipeline] batch ${batchId} pending for client ${clientId} — processing`);
        void processor.processBatch(batchId).catch((err) => {
          console.error(`[process] batch ${batchId} failed:`, err);
        });
      },
    }
  );

  const ingestor = createIngestor({
    db,
    clients,
    messages,
    audit,
    debouncer,
    defaultTimezone: cfg.defaultTimezone,
  });

  let tick: NodeJS.Timeout | undefined;

  return {
    deps: { cfg, db, clock, audit, clients, messages, compliance, drafts, narratives, engine, debouncer, ingestor, adapter, prompts, processor, draftService },

    async start() {
      const reconciled = engine.reconcileAll();
      const swept = debouncer.sweep();
      const rearmed = debouncer.rearm();
      console.log(
        `[boot] reconciled ${reconciled.clients} client(s), closed ${reconciled.closed} day(s), swept ${swept} batch(es), re-armed ${rearmed} window(s)`
      );

      await adapter.start((msg) => {
        try {
          const r = ingestor.handle(msg);
          console.log(`[ingest] ${msg.channel}:${msg.externalId} → ${r.gated}`);
        } catch (err) {
          console.error('[ingest] failed:', err);
        }
      });

      // Leftover pending batches from before a crash get processed on boot
      // (the grace period keeps this from racing fresh onBatchClosed work).
      await processor.retryPending();

      tick = setInterval(() => {
        try {
          engine.reconcileAll();
          debouncer.sweep();
          debouncer.rearm();
          void processor.retryPending().catch((err) => console.error('[retry] failed:', err));
        } catch (err) {
          console.error('[tick] failed:', err);
        }
      }, TICK_MS);
    },

    async stop() {
      if (tick !== undefined) clearInterval(tick);
      debouncer.stop();
      await adapter.stop();
      db.close();
    },
  };
}
