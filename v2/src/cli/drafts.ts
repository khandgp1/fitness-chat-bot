/**
 * Level-0 dev surface until the Stage 6 admin UI exists.
 * Usage: npm run drafts -- <trigger <clientId> | show <clientId> | send <draftId> [--text "..."] | reject <draftId>>
 * Needs ANTHROPIC_API_KEY (trigger) and TELEGRAM_TOKEN (send) in .env.
 */
import 'dotenv/config';
import { buildApp } from '../app.js';
import { StaleDraftError } from '../approval/drafts.js';

const app = buildApp();
const { draftService, drafts, audit } = app.deps;

const [cmd, id, ...rest] = process.argv.slice(2);

function printDraft(d: NonNullable<ReturnType<typeof drafts.get>>): void {
  console.log(`id:         ${d.id}`);
  console.log(`status:     ${d.status}  type: ${d.responseType}  confidence: ${d.confidence ?? '—'}`);
  console.log(`draft:      ${d.draftText}`);
  if (d.finalText !== undefined && d.finalText !== d.draftText) console.log(`final:      ${d.finalText}`);
  console.log(`created:    ${d.createdAt}`);
}

try {
  switch (cmd) {
    case 'trigger': {
      requireArg(id, 'client id');
      console.log('drafting…');
      const draft = await draftService.triggerDraft(id);
      printDraft(draft);
      const call = audit.listLlmCalls({ clientId: id, limit: 1 })[0];
      if (call !== undefined) {
        console.log(`llm:        ${call.model} · ${call.inputTokens} in / ${call.outputTokens} out · ${call.latencyMs}ms`);
      }
      console.log(`\nsend with: npm run drafts -- send ${draft.id} [--text "edited version"]`);
      break;
    }
    case 'show': {
      requireArg(id, 'client id');
      const all = drafts.list(id).slice(0, 5);
      if (all.length === 0) console.log('(no drafts)');
      for (const d of all) {
        printDraft(d);
        console.log('---');
      }
      break;
    }
    case 'send': {
      requireArg(id, 'draft id');
      const textFlag = rest.indexOf('--text');
      const finalText = textFlag >= 0 ? rest.slice(textFlag + 1).join(' ') : undefined;
      await draftService.send(id, finalText);
      console.log(`sent${finalText !== undefined ? ' (edited)' : ''}.`);
      break;
    }
    case 'reject': {
      requireArg(id, 'draft id');
      draftService.reject(id);
      console.log('rejected.');
      break;
    }
    default:
      console.log(
        'usage: npm run drafts -- <trigger <clientId> | show <clientId> | send <draftId> [--text "..."] | reject <draftId>>'
      );
      process.exitCode = cmd === undefined ? 0 : 1;
  }
} catch (err) {
  if (err instanceof StaleDraftError) {
    console.error(`stale: ${err.message}`);
    console.error('the client said something new — trigger a fresh draft.');
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
} finally {
  await app.stop();
}

function requireArg(value: string | undefined, name: string): asserts value is string {
  if (value === undefined) throw new Error(`${name} required`);
}
