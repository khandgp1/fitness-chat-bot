import fs from 'fs';
import path from 'path';
import { getDataDir } from '../state/store.js';

export interface MessageLogEntry {
  userId: string;
  message: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
}

const MAX_LOG_ENTRIES = 500;

function getMessagesFilePath(clientId: string): string {
  const safeClientId = clientId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeClientId !== clientId || !clientId) {
    throw new Error(`Invalid or insecure client ID format for message log: "${clientId}"`);
  }
  return path.join(getDataDir(), `${safeClientId}_messages.json`);
}

/**
 * Log a message to the disk-persisted message log for dev visualization.
 */
export function logMessage(
  clientId: string,
  userId: string,
  message: string,
  timestamp: string,
  direction: 'inbound' | 'outbound',
): void {
  try {
    const filePath = getMessagesFilePath(clientId);
    const messages = getMessages(clientId);

    messages.push({ userId, message, timestamp, direction });
    if (messages.length > MAX_LOG_ENTRIES) {
      messages.shift(); // Evict oldest
    }

    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[MessageLog] Error logging message for client "${clientId}":`, err);
  }
}

/**
 * Returns all logged messages for a specific client.
 */
export function getMessages(clientId: string): MessageLogEntry[] {
  try {
    const filePath = getMessagesFilePath(clientId);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const rawData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(rawData) as MessageLogEntry[];
  } catch (err) {
    console.error(`[MessageLog] Error reading messages for client "${clientId}":`, err);
    return [];
  }
}

/**
 * Clears all logged messages for a specific client.
 */
export function clearMessages(clientId: string): void {
  try {
    const filePath = getMessagesFilePath(clientId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[MessageLog] Deleted message log for client "${clientId}": ${filePath}`);
    }
  } catch (err) {
    console.error(`[MessageLog] Error clearing messages for client "${clientId}":`, err);
  }
}

