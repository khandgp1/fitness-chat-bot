import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChannelAdapter } from './adapters/types.js';
import { createTelegramAdapter } from './adapters/telegram.js';
import { createClock, type Clock } from './clock/clock.js';
import { loadConfig, type Config } from './config/config.js';
import { openDb, type Db } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { createComplianceEngine, type ComplianceEngine } from './domain/compliance.js';
import { createDebouncer, type Debouncer } from './pipeline/debounce.js';
import { createIngestor, type Ingestor } from './pipeline/ingest.js';
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
export function buildApp(opts: { cfg?: Config; adapter?: ChannelAdapter; clock?: Clock } = {}): App {
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

  const debouncer = createDebouncer(
    { db, clock, messages },
    {
      debounceMs: cfg.debounceMinutes * 60 * 1000,
      // Stage 4 replaces this with the classifier/router processor.
      onBatchClosed: (batchId, clientId) =>
        console.log(`[pipeline] batch ${batchId} pending for client ${clientId}`),
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

  const adapter =
    opts.adapter ??
    createTelegramAdapter({
      token:
        cfg.telegramToken ??
        (() => {
          throw new Error('TELEGRAM_TOKEN is required to start the telegram adapter');
        })(),
    });

  let tick: NodeJS.Timeout | undefined;

  return {
    deps: { cfg, db, clock, audit, clients, messages, compliance, drafts, narratives, engine, debouncer, ingestor, adapter },

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

      tick = setInterval(() => {
        try {
          engine.reconcileAll();
          debouncer.sweep();
          debouncer.rearm();
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
