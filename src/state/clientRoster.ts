import fs from 'fs';
import path from 'path';
import { RosterEntry, RosterFile } from './schema.js';
import { getDataDir } from './store.js';

const DEFAULT_TIMEZONE = 'America/New_York';

function getRosterFilePath(): string {
  return path.join(getDataDir(), 'roster.json');
}

function loadRosterFromDisk(): Map<string, RosterEntry> {
  const filePath = getRosterFilePath();

  if (!fs.existsSync(filePath)) {
    console.warn('[Roster] roster.json not found. Creating empty roster...');
    const empty: RosterFile = { clients: [] };
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(empty, null, 2), 'utf-8');
    return new Map();
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as RosterFile;
  return new Map(parsed.clients.map((c) => [c.id, c]));
}

function saveRosterToDisk(roster: Map<string, RosterEntry>): void {
  const filePath = getRosterFilePath();
  const rosterFile: RosterFile = { clients: [...roster.values()] };
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rosterFile, null, 2), 'utf-8');
}

// --- In-memory cache, loaded at module initialisation ---
const rosterMap = loadRosterFromDisk();

export function getRoster(): string[] {
  return [...rosterMap.keys()];
}

export function getRosterEntry(id: string): RosterEntry | undefined {
  return rosterMap.get(id);
}

export function registerClient(id: string, timezone: string = DEFAULT_TIMEZONE): void {
  if (rosterMap.has(id)) return;
  const entry: RosterEntry = { id, timezone };
  rosterMap.set(id, entry);
  saveRosterToDisk(rosterMap);
  console.log(`[Roster] Registered new client "${id}" (timezone=${timezone})`);
}
