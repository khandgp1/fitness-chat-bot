import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The only source of time in the system. Every module receives a Clock;
 * nothing calls Date.now() directly. The offset persists to a sidecar file
 * so simulated time survives process restarts (downtime simulation, D20).
 */
export interface Clock {
  now(): Date;
  offsetMs(): number;
  advance(ms: number): void; // dev mode only
  reset(): void; // dev mode only
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export function createClock(opts: { devMode: boolean; offsetFile: string }): Clock {
  let offset = readOffset(opts.offsetFile);
  let seenMtimeMs = fileMtimeMs(opts.offsetFile);

  // The clock CLI runs in a separate process; a running app must notice
  // sidecar changes live (operator-found gap, Stage 4 Verify). mtime-checked
  // re-read: one statSync per read — negligible at this scale. Prod
  // (devMode=false) never re-reads; the offset there is always 0-at-boot.
  const refresh = () => {
    if (!opts.devMode) return;
    const mtime = fileMtimeMs(opts.offsetFile);
    if (mtime !== seenMtimeMs) {
      seenMtimeMs = mtime;
      offset = readOffset(opts.offsetFile);
    }
  };
  const persist = () => {
    mkdirSync(dirname(opts.offsetFile), { recursive: true });
    writeFileSync(opts.offsetFile, JSON.stringify({ offsetMs: offset }) + '\n');
    seenMtimeMs = fileMtimeMs(opts.offsetFile);
  };
  const guard = (op: string) => {
    if (!opts.devMode) throw new Error(`Clock.${op} is not allowed outside dev mode`);
  };

  return {
    now: () => {
      refresh();
      return new Date(Date.now() + offset);
    },
    offsetMs: () => {
      refresh();
      return offset;
    },
    advance(ms: number) {
      guard('advance');
      refresh();
      offset += ms;
      persist();
    },
    reset() {
      guard('reset');
      offset = 0;
      persist();
    },
  };
}

function fileMtimeMs(file: string): number | undefined {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

function readOffset(file: string): number {
  if (!existsSync(file)) return 0;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'offsetMs' in parsed &&
      typeof (parsed as { offsetMs: unknown }).offsetMs === 'number'
    ) {
      return (parsed as { offsetMs: number }).offsetMs;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * The single place a UTC instant becomes a client-timezone calendar date
 * (Phase 2 §1). Nothing else in the system computes dates.
 */
export function clientDate(tz: string, instant: Date): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
