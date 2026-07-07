import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read-only at runtime (D14/D15): prompts are edited only in the design
 * plane. Every read is fresh (hot-read, D15) and returns the git BLOB hash —
 * content-addressed, so it identifies the exact prompt version in llm_calls
 * whether or not the file is committed yet.
 */
export interface PromptStore {
  get(name: string): { content: string; gitHash: string };
}

export function createPromptStore(opts: { promptsDir: string }): PromptStore {
  return {
    get(name) {
      const path = join(opts.promptsDir, name);
      if (!existsSync(path)) {
        throw new Error(`Prompt file not found: ${path}`);
      }
      const content = readFileSync(path, 'utf8');
      const gitHash = execFileSync('git', ['hash-object', path], { encoding: 'utf8' }).trim();
      return { content, gitHash };
    },
  };
}
