import type { Express, Request, Response } from 'express';
import type { AppDeps } from '../app.js';
import { StaleDraftError } from '../approval/drafts.js';
import { clientDate, HOUR_MS } from '../clock/clock.js';
import { dateAdd } from '../domain/compliance.js';
import { snapshotExists, takeSnapshot } from '../dev/snapshot.js';
import { ActiveDraftExistsError } from '../repos/draftRepo.js';
import { assembleTriage } from './triage.js';

/** Thin glue: every route is an existing domain operation. No business logic here. */
export function registerApiRoutes(app: Express, deps: AppDeps): void {
  const h =
    (fn: (req: Request, res: Response) => Promise<void> | void) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status =
          err instanceof StaleDraftError || err instanceof ActiveDraftExistsError
            ? 409
            : /not found/i.test(msg)
              ? 404
              : 400;
        res.status(status).json({ error: msg });
      }
    };

  const requireClient = (id: string) => {
    const c = deps.clients.get(id);
    if (c === undefined) throw new Error(`Client not found: ${id}`);
    return c;
  };

  app.get('/api/triage', h((_req, res) => {
    res.json(assembleTriage(deps));
  }));

  app.get('/api/clients', h((_req, res) => {
    res.json(
      deps.clients.listByStatus().map((c) => ({
        ...c,
        streak: deps.compliance.currentStreak(c.id),
      }))
    );
  }));

  app.get('/api/clients/:id', h((req, res) => {
    const client = requireClient(req.params.id as string);
    const today = clientDate(client.timezone, deps.clock.now());
    res.json({
      client,
      streak: deps.compliance.currentStreak(client.id),
      today,
      calendar: deps.compliance.listDays(client.id, dateAdd(today, -27), today),
      narrative: deps.narratives.read(client.id).content ?? '',
      staleness: deps.narratives.stalenessScore(client.id),
      drafts: deps.drafts.list(client.id).slice(0, 10),
      identity: deps.clients.getIdentity(client.id, deps.adapter.name),
    });
  }));

  app.get('/api/clients/:id/messages', h((req, res) => {
    requireClient(req.params.id as string);
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json(deps.messages.list(req.params.id as string, { beforeId: before, limit: 50 }));
  }));

  app.post('/api/clients/:id/verify', h((req, res) => {
    deps.clients.verify(req.params.id as string);
    res.json({ ok: true });
  }));
  app.post('/api/clients/:id/block', h((req, res) => {
    deps.clients.block(req.params.id as string);
    res.json({ ok: true });
  }));
  app.post('/api/clients/:id/reset', h((req, res) => {
    deps.clients.reset(req.params.id as string);
    res.json({ ok: true });
  }));
  app.post('/api/clients/:id/delete', h((req, res) => {
    deps.clients.delete(req.params.id as string);
    res.json({ ok: true });
  }));
  app.put('/api/clients/:id/timezone', h((req, res) => {
    const tz = (req.body as { timezone?: unknown }).timezone;
    if (typeof tz !== 'string') throw new Error('timezone required');
    deps.clients.update(req.params.id as string, { timezone: tz });
    res.json({ ok: true });
  }));

  app.put('/api/clients/:id/narrative', h((req, res) => {
    const content = (req.body as { content?: unknown }).content;
    if (typeof content !== 'string') throw new Error('content required');
    deps.narratives.quickEdit(req.params.id as string, content, 'operator');
    res.json({ ok: true });
  }));

  app.post('/api/clients/:id/drafts', h(async (req, res) => {
    res.json(await deps.draftService.triggerDraft(req.params.id as string));
  }));
  app.post('/api/drafts/:id/send', h(async (req, res) => {
    const text = (req.body as { text?: unknown } | undefined)?.text;
    await deps.draftService.send(req.params.id as string, typeof text === 'string' ? text : undefined);
    res.json({ ok: true });
  }));
  app.post('/api/drafts/:id/reject', h((req, res) => {
    deps.draftService.reject(req.params.id as string);
    res.json({ ok: true });
  }));

  app.post('/api/batches/:id/dismiss', h((req, res) => {
    deps.messages.dismissBatch(req.params.id as string);
    res.json({ ok: true });
  }));

  app.post('/api/compliance/:clientId/:date/correct', h((req, res) => {
    const status = (req.body as { status?: unknown }).status;
    if (status !== 'compliant' && status !== 'miss') throw new Error("status must be 'compliant' or 'miss'");
    deps.engine.correctDay(req.params.clientId as string, req.params.date as string, status, 'operator');
    res.json({ ok: true });
  }));

  app.post('/api/followups/:clientId/:date', h((req, res) => {
    const state = (req.body as { state?: unknown }).state;
    if (state !== 'handled' && state !== 'dismissed') throw new Error("state must be 'handled' or 'dismissed'");
    deps.compliance.setFollowupState(req.params.clientId as string, req.params.date as string, state);
    res.json({ ok: true });
  }));

  app.get('/api/audit', h((req, res) => {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    res.json(deps.audit.listEvents({ clientId, limit: 50 }));
  }));
  app.get('/api/llm-calls', h((req, res) => {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    res.json(deps.audit.listLlmCalls({ clientId, limit: 50 }));
  }));

  // ---- Dev panel (devMode only; 404 otherwise) ----
  if (deps.cfg.devMode) {
    app.get('/api/dev/clock', h((_req, res) => {
      res.json({
        realNow: new Date().toISOString(),
        effectiveNow: deps.clock.now().toISOString(),
        offsetHours: deps.clock.offsetMs() / HOUR_MS,
        snapshotExists: snapshotExists(deps.cfg.dbPath),
      });
    }));

    app.post('/api/dev/clock/advance', h((req, res) => {
      const hours = Number((req.body as { hours?: unknown }).hours ?? 24);
      if (!Number.isFinite(hours)) throw new Error('hours must be a number');
      // D20: first advance of a simulation snapshots DB + clock together.
      if (!snapshotExists(deps.cfg.dbPath)) takeSnapshot(deps.cfg.dbPath);
      deps.clock.advance(hours * HOUR_MS);
      deps.engine.reconcileAll();
      deps.debouncer.sweep();
      res.json({ effectiveNow: deps.clock.now().toISOString() });
    }));

    app.post('/api/dev/clock/reset', h((_req, res) => {
      // Restoring the DB file under an open connection is unsafe — the full
      // rewind is a CLI operation with the app stopped (D20).
      if (snapshotExists(deps.cfg.dbPath)) {
        throw new Error(
          'A snapshot exists. Stop the app and run `npm run clock -- reset` to restore DB + clock together.'
        );
      }
      deps.clock.reset();
      res.json({ effectiveNow: deps.clock.now().toISOString() });
    }));

    app.post('/api/dev/inbound', h((req, res) => {
      const body = req.body as { clientId?: unknown; externalId?: unknown; text?: unknown };
      if (typeof body.text !== 'string' || body.text.trim() === '') throw new Error('text required');
      let externalId: string;
      if (typeof body.clientId === 'string') {
        // Simulate a message from an EXISTING client via a dev-channel identity.
        requireClient(body.clientId);
        const existing = deps.clients.getIdentity(body.clientId, 'dev');
        if (existing === undefined) {
          deps.clients.registerIdentity(body.clientId, 'dev', `dev-${body.clientId}`);
        }
        externalId = existing?.externalId ?? `dev-${body.clientId}`;
      } else if (typeof body.externalId === 'string') {
        externalId = body.externalId; // stranger simulation
      } else {
        throw new Error('clientId or externalId required');
      }
      const result = deps.ingestor.handle({ channel: 'dev', externalId, text: body.text });
      res.json(result);
    }));
  }
}
