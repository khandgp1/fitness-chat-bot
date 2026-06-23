export interface MessageLogEntry {
  userId: string;
  message: string;
  timestamp: string;
}

const MAX_LOG_ENTRIES = 500;
const messages: MessageLogEntry[] = [];

/**
 * Log a message to the in-memory message log for dev visualization.
 */
export function logMessage(userId: string, message: string, timestamp: string): void {
  messages.push({ userId, message, timestamp });
  if (messages.length > MAX_LOG_ENTRIES) {
    messages.shift(); // Evict oldest
  }
}

/**
 * Returns all logged messages.
 */
export function getMessages(): MessageLogEntry[] {
  return [...messages];
}
