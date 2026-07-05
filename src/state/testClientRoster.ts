import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { getRoster, registerClient } from './clientRoster.js';
import { getDataDir } from './store.js';

function runTests(): void {
  console.log('🚀 Starting Client Roster Tests...');

  const initial = getRoster();
  console.log('Initial roster loaded:', initial);

  const testClient = 'test-client-roster-' + Date.now();
  assert.equal(getRoster().includes(testClient), false);

  console.log(`Registering new client: ${testClient}`);
  registerClient(testClient, 'America/New_York');

  const updated = getRoster();
  assert.equal(updated.includes(testClient), true);
  console.log('Roster after registration contains the client!');

  // Verify disk persistence by reading the file directly
  const filePath = path.join(getDataDir(), 'roster.json');
  assert.equal(fs.existsSync(filePath), true, 'roster.json file must exist on disk');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as { clients: { id: string; timezone: string }[] };
  const found = parsed.clients.some((c) => c.id === testClient);
  assert.equal(found, true, 'Registered client must be written to roster.json on disk');
  console.log('Roster disk persistence verified successfully!');

  // Registering the same client again should not duplicate it
  registerClient(testClient);
  const reUpdated = getRoster();
  const count = reUpdated.filter((id) => id === testClient).length;
  assert.equal(count, 1, 'Client should be unique in the roster list');
  console.log('Roster maintains uniqueness successfully!');

  // Cleanup registered test client from file to keep it clean
  const cleanClients = parsed.clients.filter((c) => c.id !== testClient);
  fs.writeFileSync(filePath, JSON.stringify({ clients: cleanClients }, null, 2), 'utf-8');
  console.log('Cleaned up test client from roster.json.');

  console.log('🎉 All client roster tests passed successfully!');
}

runTests();
