import { parse } from 'yaml';
import type { PromptStore } from '../repos/promptStore.js';

/**
 * The autonomy ladder policy (Phase 3 §4, D21). Hot-read from
 * prompts/autonomy.yaml per lookup; anything unknown, missing, or malformed
 * FAILS CLOSED to level 0 (operator-triggered draft, manual send).
 */
export interface AutonomyPolicy {
  levelFor(responseType: string): { level: 0 | 1 | 2; autoSendMinConfidence?: number };
}

const LEVEL_0 = { level: 0 as const };

export function createAutonomyPolicy(deps: { prompts: PromptStore }): AutonomyPolicy {
  return {
    levelFor(responseType) {
      try {
        const doc: unknown = parse(deps.prompts.get('autonomy.yaml').content);
        const entry = (doc as { autonomy?: Record<string, unknown> } | null)?.autonomy?.[
          responseType
        ];
        if (typeof entry !== 'object' || entry === null) return LEVEL_0;
        const level = (entry as Record<string, unknown>).level;
        if (level !== 0 && level !== 1 && level !== 2) return LEVEL_0;
        const threshold = (entry as Record<string, unknown>).auto_send_min_confidence;
        return {
          level,
          autoSendMinConfidence: typeof threshold === 'number' ? threshold : undefined,
        };
      } catch {
        return LEVEL_0;
      }
    },
  };
}
