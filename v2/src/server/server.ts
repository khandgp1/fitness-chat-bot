import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AppDeps } from '../app.js';
import { registerApiRoutes } from './api.js';

/**
 * The admin server: token login → httpOnly session cookie; every /api route
 * except login requires the session. Static SPA assets are unauthenticated —
 * all data flows through the authed API. In-memory sessions: a restart just
 * means logging in again (single operator, D5).
 */
export function createServer(deps: AppDeps): { listen(port: number): Promise<Server> } {
  const adminToken = deps.cfg.adminToken;
  if (adminToken === undefined || adminToken === '') {
    throw new Error('ADMIN_TOKEN is required to start the admin server');
  }

  const sessions = new Set<string>();
  const app = express();
  app.use(express.json());

  const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

  app.post('/api/login', (req, res) => {
    const supplied = (req.body as { token?: unknown } | undefined)?.token;
    if (typeof supplied !== 'string' || !timingSafeEqual(sha(supplied), sha(adminToken))) {
      res.status(401).json({ error: 'invalid token' });
      return;
    }
    const sid = randomUUID();
    sessions.add(sid);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (sid === undefined || !sessions.has(sid)) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    next();
  });

  registerApiRoutes(app, deps);

  // SPA: serve the built UI when present; API 404s stay JSON.
  const distDir = join(process.cwd(), 'admin-ui', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        // root + relative path: sendFile's dotfile check must only see
        // 'index.html' — an absolute path through a hidden directory
        // (e.g. this repo's parent, .AntiGrav) 404s otherwise.
        res.sendFile('index.html', { root: distDir }, (err) => err && next(err));
        return;
      }
      next();
    });
  }

  return {
    listen(port: number) {
      return new Promise((resolve, reject) => {
        const server = app.listen(port, (err?: Error) => {
          if (err) reject(err);
          else resolve(server);
        });
      });
    },
  };
}
