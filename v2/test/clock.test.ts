import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientDate, createClock, DAY_MS, HOUR_MS } from '../src/clock/clock.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clock-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createClock', () => {
  it('advances and resets the offset', () => {
    const clock = createClock({ devMode: true, offsetFile: join(dir, 'c.json') });
    expect(clock.offsetMs()).toBe(0);
    clock.advance(DAY_MS);
    expect(clock.offsetMs()).toBe(DAY_MS);
    const drift = clock.now().getTime() - Date.now() - DAY_MS;
    expect(Math.abs(drift)).toBeLessThan(1000);
    clock.reset();
    expect(clock.offsetMs()).toBe(0);
  });

  it('persists the offset across restarts (new instance, same file)', () => {
    const file = join(dir, 'c.json');
    const first = createClock({ devMode: true, offsetFile: file });
    first.advance(2 * DAY_MS + 3 * HOUR_MS);

    const second = createClock({ devMode: true, offsetFile: file });
    expect(second.offsetMs()).toBe(2 * DAY_MS + 3 * HOUR_MS);
  });

  it('refuses mutation outside dev mode', () => {
    const clock = createClock({ devMode: false, offsetFile: join(dir, 'c.json') });
    expect(() => clock.advance(DAY_MS)).toThrow(/dev mode/);
    expect(() => clock.reset()).toThrow(/dev mode/);
    expect(clock.now()).toBeInstanceOf(Date); // reading is always allowed
  });

  it('treats a corrupt sidecar file as offset 0', () => {
    const file = join(dir, 'c.json');
    const clock = createClock({ devMode: true, offsetFile: file });
    clock.advance(DAY_MS);
    // simulate corruption
    writeFileSync(file, 'not json');
    const reread = createClock({ devMode: true, offsetFile: file });
    expect(reread.offsetMs()).toBe(0);
  });
});

describe('clientDate', () => {
  it('converts UTC instants to client-timezone dates across the date line', () => {
    // 02:00 UTC on Jul 7 is still Jul 6 evening in New York (EDT, UTC-4)
    expect(clientDate('America/New_York', new Date('2026-07-07T02:00:00Z'))).toBe('2026-07-06');
    // In winter (EST, UTC-5) the same wall-clock logic holds
    expect(clientDate('America/New_York', new Date('2026-01-07T03:00:00Z'))).toBe('2026-01-06');
  });

  it('handles the DST spring-forward day', () => {
    // US DST began 2026-03-08; 06:59 UTC = 01:59 EST, 07:01 UTC = 03:01 EDT — same date
    expect(clientDate('America/New_York', new Date('2026-03-08T06:59:00Z'))).toBe('2026-03-08');
    expect(clientDate('America/New_York', new Date('2026-03-08T07:01:00Z'))).toBe('2026-03-08');
  });

  it('handles UTC+14', () => {
    // Kiritimati is a full day ahead at noon UTC
    expect(clientDate('Pacific/Kiritimati', new Date('2026-01-07T12:00:00Z'))).toBe('2026-01-08');
  });
});
