import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { devNow } from '../dev/clock.js';
import { logMessage, getMessages } from '../dev/messageLog.js';
import { loadClient, getDataDir } from '../state/store.js';

export interface SuggestionResult {
  suggestion: string; // The generated draft text
  basedOnCount: number; // Number of client messages used as context
  generatedAt: string; // ISO timestamp
  clientId: string;
}

const suggestions = new Map<string, SuggestionResult>();
const lastSentTimestamps = new Map<string, string>();

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY environment variable is not defined.');
}

const anthropic = new Anthropic({
  apiKey,
  timeout: 10000,
  maxRetries: 0,
});

/**
 * Generates a response suggestion for the client.
 */
export async function generateSuggestion(clientId: string): Promise<SuggestionResult> {
  const currentDevTime = devNow().toISOString();

  // 1. Load the system prompt
  const promptPath = path.join(getDataDir(), 'suggestion-prompt.md');
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Suggestion prompt file not found at: ${promptPath}`);
  }
  const baseSystemPrompt = fs.readFileSync(promptPath, 'utf-8');

  // 2. Load client state
  const clientState = loadClient(clientId, currentDevTime);

  // 3. Retrieve messages from message log since lastSentTimestamp for this client
  const lastSent = lastSentTimestamps.get(clientId);

  const clientMessages = getMessages(clientId).filter((msg) => {
    // Check if timestamp is after lastSent
    if (lastSent && msg.timestamp <= lastSent) {
      return false;
    }
    // Filter to only inbound client messages (exclude bot responses)
    if (msg.direction !== 'inbound') {
      return false;
    }
    return true;
  });

  // 4. If no messages found, throw an error
  if (clientMessages.length === 0) {
    throw new Error(`No new messages found to respond to for client: ${clientId}`);
  }

  // 5. Build user prompt and client context block
  const yesNo = clientState.gm_received_today ? 'yes' : 'no';
  const contextBlock = `
--- Client Context ---
Streak: ${clientState.streak_count} consecutive days
Today's status: ${clientState.compliance_status}
GM received today: ${yesNo}`;

  const systemPrompt = `${baseSystemPrompt}\n${contextBlock}`;

  const formattedMessages = clientMessages
    .map((msg) => `[${msg.timestamp}] ${msg.message}`)
    .join('\n');
  const userPrompt = `Client messages (oldest to newest):\n${formattedMessages}`;

  // 6. Call LLM
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content returned from Anthropic API.');
  }

  const suggestionText = textBlock.text.trim();

  // 7. Store result in suggestions Map
  const result: SuggestionResult = {
    suggestion: suggestionText,
    basedOnCount: clientMessages.length,
    generatedAt: currentDevTime,
    clientId,
  };

  suggestions.set(clientId, result);

  // 8. Return result
  return result;
}

/**
 * Marks the suggestion as sent.
 */
export function markSuggestionSent(clientId: string, customText?: string): void {
  const suggestion = suggestions.get(clientId);
  if (!suggestion && !customText) {
    throw new Error(`No suggestion found for client: ${clientId}`);
  }

  const currentDevTime = devNow().toISOString();

  // Update lastSentTimestamp
  lastSentTimestamps.set(clientId, currentDevTime);

  // Log sent suggestion to message log as [BOT]
  const textToSend = customText !== undefined ? customText : suggestion!.suggestion;
  logMessage(clientId, '[BOT]', textToSend, currentDevTime, 'outbound');

  // Clear stored suggestion
  suggestions.delete(clientId);
}

/**
 * Retrieves the currently stored suggestion.
 */
export function getLatestSuggestion(clientId: string): SuggestionResult | null {
  return suggestions.get(clientId) || null;
}
