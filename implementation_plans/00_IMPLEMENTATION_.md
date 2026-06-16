# Phase 1 — Project Scaffolding

> **Plan Index:** 00
> **KICKSTART Reference:** Phase 1 of `KICKSTART.md`
> **Goal:** A clean, typed, runnable TypeScript project with all dependencies installed, linting configured, and the correct folder structure in place.
> **Exit Criteria:** `npm run dev` compiles and runs `src/index.ts`, prints `Bot scaffolding ready.`, and exits cleanly with code 0.

---

## Tech Decisions (Confirmed via /grill-me)

| Decision                    | Choice                                              |
| --------------------------- | --------------------------------------------------- |
| Package name                | `fitness-chat-bot`                                  |
| Node.js target              | 20 LTS                                              |
| TypeScript compiler (dev)   | `tsx`                                               |
| TypeScript compiler (build) | `tsc`                                               |
| Linting                     | ESLint flat config (`eslint.config.mjs`) + Prettier |
| Transport (later phases)    | Grammy long polling                                 |
| State (later phases)        | Flat JSON files                                     |

---

## Progress Checklist

### Step 1 — Git & .gitignore

- [x] Confirm `.git` is present (already initialized — verified)
- [x] Create `.gitignore` at project root with entries:
  ```
  node_modules/
  dist/
  .env
  data/
  ```

---

### Step 2 — package.json

- [x] Run `npm init -y` to generate `package.json`
- [x] Update `package.json` with:
  - `"name": "fitness-chat-bot"`
  - `"version": "0.1.0"`
  - `"engines": { "node": ">=20.0.0" }`
  - `"type": "module"` — ESM modules (required for ESLint flat config + modern Grammy)
  - `"main": "dist/index.js"`
  - Scripts:
    ```json
    "scripts": {
      "dev": "tsx src/index.ts",
      "build": "tsc",
      "start": "node dist/index.js",
      "lint": "eslint .",
      "format": "prettier --write ."
    }
    ```

---

### Step 3 — Install Runtime Dependencies

- [x] Run:
  ```bash
  npm install grammy @anthropic-ai/sdk node-cron dotenv
  ```
- [x] Confirm all 4 packages appear in `package.json` `dependencies`

---

### Step 4 — Install Dev Dependencies

- [x] Run:
  ```bash
  npm install -D typescript tsx @types/node @types/node-cron eslint prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser globals
  ```
- [x] Confirm all dev packages appear in `package.json` `devDependencies`

---

### Step 5 — tsconfig.json

- [x] Create `tsconfig.json` at project root:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "outDir": "dist",
      "rootDir": "src",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist"]
  }
  ```

---

### Step 6 — ESLint Flat Config

- [x] Create `eslint.config.mjs` at project root:

  ```js
  import tsPlugin from '@typescript-eslint/eslint-plugin';
  import tsParser from '@typescript-eslint/parser';
  import globals from 'globals';

  export default [
    {
      files: ['src/**/*.ts'],
      languageOptions: {
        parser: tsParser,
        globals: { ...globals.node },
      },
      plugins: { '@typescript-eslint': tsPlugin },
      rules: {
        ...tsPlugin.configs.recommended.rules,
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/explicit-function-return-type': 'off',
        'no-console': 'off',
      },
    },
  ];
  ```

---

### Step 7 — Prettier Config

- [x] Create `.prettierrc` at project root:
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 100,
    "tabWidth": 2
  }
  ```
- [x] Create `.prettierignore`:
  ```
  node_modules/
  dist/
  data/
  ```

---

### Step 8 — Environment Files

- [x] Create `.env.example` at project root:

  ```
  # Telegram
  TELEGRAM_BOT_TOKEN=your_bot_token_here

  # Anthropic
  ANTHROPIC_API_KEY=your_anthropic_key_here
  ```

- [x] Create `.env` (gitignored) and populate with real values

---

### Step 9 — Folder Structure

- [x] Create the following empty directories and placeholder files:
  ```
  src/
    index.ts             <- entrypoint (Step 10)
    state/
      .gitkeep
    classifier/
      .gitkeep
    compliance/
      .gitkeep
    response/
      .gitkeep
    scheduler/
      .gitkeep
    bot/
      .gitkeep
  data/                  <- gitignored, auto-created at runtime
  docs/
    .gitkeep
  implementation_plans/  <- already exists (this file lives here)
  ```

---

### Step 10 — Entrypoint (src/index.ts)

- [x] Create `src/index.ts`:

  ```ts
  import 'dotenv/config';

  function main(): void {
    console.log('Bot scaffolding ready.');
    console.log(`Node version: ${process.version}`);
    console.log(`TELEGRAM_BOT_TOKEN set: ${Boolean(process.env.TELEGRAM_BOT_TOKEN)}`);
    console.log(`ANTHROPIC_API_KEY set: ${Boolean(process.env.ANTHROPIC_API_KEY)}`);
  }

  main();
  ```

---

### Step 11 — Smoke Test

- [x] Run `npm run dev`
- [x] Confirm output:
  ```
  Bot scaffolding ready.
  Node version: v20.x.x
  TELEGRAM_BOT_TOKEN set: true
  ANTHROPIC_API_KEY set: true
  ```
- [x] Confirm process exits with code 0 (no hanging process)
- [x] Run `npm run lint` — confirm no errors on the stub `index.ts`
- [x] Run `npm run format` — confirm Prettier runs without errors

---

## Files Created in This Phase

| File                | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `.gitignore`        | Excludes secrets, build artifacts, state data    |
| `package.json`      | Project metadata, scripts, dependency manifest   |
| `tsconfig.json`     | TypeScript compiler config (strict, ES2022, ESM) |
| `eslint.config.mjs` | ESLint flat config with TypeScript rules         |
| `.prettierrc`       | Prettier formatting rules                        |
| `.prettierignore`   | Prettier exclusions                              |
| `.env.example`      | Template for required env vars                   |
| `.env`              | Real env vars (gitignored)                       |
| `src/index.ts`      | Smoke-test entrypoint                            |
| `src/*/(.gitkeep)`  | Placeholder files to establish folder structure  |
| `docs/.gitkeep`     | Placeholder for spec + library files             |

---

## What This Phase Does NOT Include

- Any bot logic, classification, compliance, or state code (Phase 2-5)
- Grammy bot initialization or Telegram connection (Phase 5)
- `data/` directory creation (auto-created at runtime in Phase 2)
- Production channel decisions (KICKSTART Open Decision OD-6)

---

_Plan: 00*IMPLEMENTATION*.md | Phase 1 - Scaffolding | fitness-chat-bot | Spec: Fitness_Bot_Algo_v0.md v0.5_
