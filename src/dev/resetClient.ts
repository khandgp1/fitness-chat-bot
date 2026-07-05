import fs from 'fs';
import { clientExists, loadClient, createClient, getClientFilePath } from '../state/store.js';
import { ClientState } from '../state/schema.js';
import { clearMessages } from './messageLog.js';

/**
 * Resets a client's state to fresh defaults.
 * If the client already exists, reads their timezone first so we preserve it.
 * Deletes the existing client state file and calls createClient to re-initialize.
 */
export function resetClient(clientId: string): ClientState {
  let timezone = 'America/New_York'; // default fallback

  if (clientExists(clientId)) {
    try {
      const existing = loadClient(clientId);
      if (existing && existing.timezone) {
        timezone = existing.timezone;
      }
    } catch (err) {
      console.warn(`[Reset] Could not load existing client "${clientId}" to read timezone:`, err);
    }

    try {
      const filePath = getClientFilePath(clientId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Reset] Deleted state file for client "${clientId}": ${filePath}`);
      }
    } catch (err) {
      console.error(`[Reset] Error deleting state file for client "${clientId}":`, err);
      throw err;
    }
  } else {
    console.log(`[Reset] Client "${clientId}" state file did not exist.`);
  }

  // Always clear message log for the client on reset
  clearMessages(clientId);

  // Create client with the preserved/default timezone
  const newState = createClient(clientId, timezone);
  console.log(
    `[Reset] Re-created fresh client state for "${clientId}" with timezone "${timezone}"`,
  );
  return newState;
}
