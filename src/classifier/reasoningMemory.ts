import fs from 'fs';
import path from 'path';
import { getDataDir } from '../state/store.js';

/**
 * A curated reasoning memory entry representing an operator-approved
 * GM classification example for few-shot prompt injection.
 */
export interface ReasoningMemoryEntry {
  _comment?: string; // Optional schema documentation (ignored by code)
  message: string; // The original classified message
  is_valid_gm: boolean; // Operator's definitive classification
  reasoning: string; // LLM's original reasoning
  override_reasoning?: string | null; // Operator's custom reasoning (if provided)
}

/**
 * Returns the path to the reasoning memory JSON file.
 */
function getReasoningMemoryPath(): string {
  return path.join(getDataDir(), 'reasoning_memory.json');
}

/**
 * Loads reasoning memory entries from disk.
 * Hard-fails if the file is missing or contains malformed JSON.
 * Filters out pure comment entries (entries with _comment but no message).
 */
export function loadReasoningMemory(): ReasoningMemoryEntry[] {
  const filePath = getReasoningMemoryPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Reasoning memory file not found: ${filePath}. This file must exist — create it with at least an empty array [].`,
    );
  }

  let rawData: string;
  try {
    rawData = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read reasoning memory file: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch (err) {
    throw new Error(`Reasoning memory file contains malformed JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Reasoning memory file must contain a JSON array.');
  }

  // Filter out pure comment entries and validate real entries
  const entries: ReasoningMemoryEntry[] = [];
  for (const item of parsed) {
    // Skip pure comment entries (have _comment but no message)
    if (item._comment && !item.message) {
      continue;
    }

    // Validate required fields on real entries
    if (typeof item.message !== 'string') {
      throw new Error(
        `Invalid reasoning memory entry: missing or non-string "message" field. Entry: ${JSON.stringify(item)}`,
      );
    }
    if (typeof item.is_valid_gm !== 'boolean') {
      throw new Error(
        `Invalid reasoning memory entry: missing or non-boolean "is_valid_gm" field. Entry: ${JSON.stringify(item)}`,
      );
    }
    if (typeof item.reasoning !== 'string') {
      throw new Error(
        `Invalid reasoning memory entry: missing or non-string "reasoning" field. Entry: ${JSON.stringify(item)}`,
      );
    }

    entries.push(item as ReasoningMemoryEntry);
  }

  return entries;
}

/**
 * Formats reasoning memory entries into a natural-language section
 * for injection into the GM classification system prompt.
 *
 * Uses override_reasoning if present, otherwise falls back to reasoning.
 * Returns empty string if no entries are provided.
 */
export function formatReasoningForPrompt(entries: ReasoningMemoryEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const lines = entries.map((entry) => {
    const effectiveReasoning = entry.override_reasoning || entry.reasoning;
    return `- "${entry.message}" → is_valid_gm: ${entry.is_valid_gm} | Reasoning: ${effectiveReasoning}`;
  });

  return (
    '\n\nApproved Past Classifications (use these as authoritative reference):\n' + lines.join('\n')
  );
}
