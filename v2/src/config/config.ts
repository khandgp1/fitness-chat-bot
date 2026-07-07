export interface Config {
  dbPath: string;
  narrativesDir: string;
  promptsDir: string;
  debounceMinutes: number;
  contextMaxMessages: number;
  contextMaxDays: number;
  stalenessThresholdExchanges: number;
  stalenessThresholdDays: number;
  maxCoachTurns: number;
  port: number;
  devMode: boolean;
  // Secrets: declared here, validated by the module that needs them at its startup.
  anthropicApiKey?: string;
  telegramToken?: string;
  adminToken?: string;
}

function intVar(env: NodeJS.ProcessEnv, key: string, def: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`Config: ${key} must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

function boolVar(env: NodeJS.ProcessEnv, key: string, def: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Config: ${key} must be true/false, got "${raw}"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbPath: env.DB_PATH ?? 'data/v2.sqlite',
    narrativesDir: env.NARRATIVES_DIR ?? '../fitness-bot-narratives',
    promptsDir: env.PROMPTS_DIR ?? 'prompts',
    debounceMinutes: intVar(env, 'DEBOUNCE_MINUTES', 3),
    contextMaxMessages: intVar(env, 'CONTEXT_MAX_MESSAGES', 30),
    contextMaxDays: intVar(env, 'CONTEXT_MAX_DAYS', 14),
    stalenessThresholdExchanges: intVar(env, 'STALENESS_THRESHOLD_EXCHANGES', 5),
    stalenessThresholdDays: intVar(env, 'STALENESS_THRESHOLD_DAYS', 14),
    maxCoachTurns: intVar(env, 'MAX_COACH_TURNS', 6),
    port: intVar(env, 'PORT', 3000),
    devMode: boolVar(env, 'DEV_MODE', true),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    telegramToken: env.TELEGRAM_TOKEN || undefined,
    adminToken: env.ADMIN_TOKEN || undefined,
  };
}
