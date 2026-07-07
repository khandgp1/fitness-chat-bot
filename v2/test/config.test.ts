import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';

describe('loadConfig', () => {
  it('applies defaults with an empty env', () => {
    const cfg = loadConfig({});
    expect(cfg.dbPath).toBe('data/v2.sqlite');
    expect(cfg.debounceMinutes).toBe(3);
    expect(cfg.contextMaxMessages).toBe(30);
    expect(cfg.contextMaxDays).toBe(14);
    expect(cfg.stalenessThresholdExchanges).toBe(5);
    expect(cfg.stalenessThresholdDays).toBe(14);
    expect(cfg.maxCoachTurns).toBe(6);
    expect(cfg.port).toBe(3000);
    expect(cfg.devMode).toBe(true);
    expect(cfg.anthropicApiKey).toBeUndefined();
  });

  it('parses env overrides', () => {
    const cfg = loadConfig({
      DB_PATH: '/tmp/x.sqlite',
      DEBOUNCE_MINUTES: '5',
      DEV_MODE: 'false',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(cfg.dbPath).toBe('/tmp/x.sqlite');
    expect(cfg.debounceMinutes).toBe(5);
    expect(cfg.devMode).toBe(false);
    expect(cfg.anthropicApiKey).toBe('sk-test');
  });

  it('fails fast on malformed numeric values', () => {
    expect(() => loadConfig({ DEBOUNCE_MINUTES: 'abc' })).toThrow(/DEBOUNCE_MINUTES/);
    expect(() => loadConfig({ PORT: '-1' })).toThrow(/PORT/);
    expect(() => loadConfig({ MAX_COACH_TURNS: '2.5' })).toThrow(/MAX_COACH_TURNS/);
  });

  it('fails fast on malformed booleans', () => {
    expect(() => loadConfig({ DEV_MODE: 'yes' })).toThrow(/DEV_MODE/);
  });
});
