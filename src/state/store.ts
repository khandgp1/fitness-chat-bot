import fs from 'fs';
import path from 'path';
import { ClientState } from './schema.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

/**
 * Gets the secure path to a client's state file, preventing path traversal.
 */
export function getClientFilePath(clientId: string): string {
  const safeClientId = clientId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeClientId !== clientId || !clientId) {
    throw new Error(`Invalid or insecure client ID format: "${clientId}"`);
  }
  return path.join(DATA_DIR, `${safeClientId}.json`);
}

/**
 * Checks if a state file exists for the given client ID.
 */
export function clientExists(clientId: string): boolean {
  try {
    const filePath = getClientFilePath(clientId);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Loads a client's state from disk.
 * Throws if the file does not exist or contains invalid JSON.
 */
export function loadClient(clientId: string): ClientState {
  const filePath = getClientFilePath(clientId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Client state file not found for client ID: ${clientId}`);
  }
  const rawData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(rawData) as ClientState;
}

/**
 * Saves a client's state to disk, creating the data directory if it doesn't exist.
 */
export function saveClient(state: ClientState): void {
  if (!state || !state.client_id) {
    throw new Error('Cannot save state: missing client_id');
  }
  const filePath = getClientFilePath(state.client_id);

  // Ensure the target directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const serialized = JSON.stringify(state, null, 2);
  fs.writeFileSync(filePath, serialized, 'utf-8');
}

/**
 * Creates a new client state with default values and persists it.
 * Validates the provided timezone string.
 */
export function createClient(clientId: string, timezone: string): ClientState {
  // Validate IANA timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new Error(`Invalid IANA timezone: "${timezone}"`);
  }

  const newState: ClientState = {
    client_id: clientId,
    timezone,
    gm_received_today: false,
    compliance_status: 'Unknown',
    streak_count: 0,
    current_response_level: 0,
    window_position: 0,
    responses_given: 0,
    gm_log: [],
    miss_log: [],
    pending_review_log: [],
    classification_log: [],
  };

  saveClient(newState);
  return newState;
}
