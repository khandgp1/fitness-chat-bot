import assert from 'assert/strict';
import fs from 'fs';
import { clientExists, createClient, loadClient, saveClient, getClientFilePath } from './store.js';
import { ClientState, GmLogEntry, PendingReviewEntry, ClassificationLogEntry } from './schema.js';

function runTests(): void {
  const testClientId = 'test-client-999';

  console.log('🚀 Starting State Store Round-Trip Tests...');

  // 1. Initial state checks
  console.log('Checking that test client does not exist initially...');
  if (clientExists(testClientId)) {
    console.log('Test client file already exists. Cleaning it up first...');
    fs.unlinkSync(getClientFilePath(testClientId));
  }
  assert.equal(clientExists(testClientId), false, 'Client should not exist initially');

  // 2. Client creation and defaults verification
  console.log('Creating a new test client in America/New_York timezone...');
  const state: ClientState = createClient(testClientId, 'America/New_York');

  assert.equal(state.client_id, testClientId);
  assert.equal(state.client_handle, testClientId);
  assert.equal(state.timezone, 'America/New_York');
  assert.equal(state.gm_received_today, false);
  assert.equal(state.compliance_status, 'Unknown');
  assert.equal(state.streak_count, 0);
  assert.equal(state.current_response_level, 0);
  assert.equal(state.window_position, 0);
  assert.equal(state.responses_given, 0);
  assert.deepEqual(state.gm_log, []);
  assert.deepEqual(state.miss_log, []);
  assert.deepEqual(state.pending_review_log, []);
  assert.deepEqual(state.classification_log, []);

  assert.equal(clientExists(testClientId), true, 'Client file should exist after creation');

  // 3. Mutating and saving state
  console.log('Mutating state fields and adding logs...');
  const nowStr = new Date().toISOString();
  state.gm_received_today = true;
  state.compliance_status = 'Compliant';
  state.streak_count = 5;
  state.current_response_level = 1;
  state.window_position = 3;
  state.responses_given = 2;

  (state.gm_log as GmLogEntry[]).push({
    timestamp: nowStr,
    message: 'GM!',
    reasoning: 'Matches standard greeting exactly.',
  });

  (state.miss_log as string[]).push('2026-06-15');

  (state.pending_review_log as PendingReviewEntry[]).push({
    date: '2026-06-14',
    message: 'mornin',
    failure_reason: 'API connection timed out',
    timestamp: nowStr,
  });

  (state.classification_log as ClassificationLogEntry[]).push({
    timestamp: nowStr,
    message: 'GM!',
    is_valid_gm: true,
    reasoning: 'Matches standard greeting exactly.',
  });

  console.log('Saving mutated state...');
  saveClient(state);

  // 4. Reload and assert consistency
  console.log('Reloading state from disk and verifying all properties...');
  const loadedState = loadClient(testClientId);

  assert.equal(loadedState.client_id, state.client_id);
  assert.equal(loadedState.client_handle, state.client_handle);
  assert.equal(loadedState.timezone, state.timezone);
  assert.equal(loadedState.gm_received_today, state.gm_received_today);
  assert.equal(loadedState.compliance_status, state.compliance_status);
  assert.equal(loadedState.streak_count, state.streak_count);
  assert.equal(loadedState.current_response_level, state.current_response_level);
  assert.equal(loadedState.window_position, state.window_position);
  assert.equal(loadedState.responses_given, state.responses_given);
  assert.deepEqual(loadedState.gm_log, state.gm_log);
  assert.deepEqual(loadedState.miss_log, state.miss_log);
  assert.deepEqual(loadedState.pending_review_log, state.pending_review_log);
  assert.deepEqual(loadedState.classification_log, state.classification_log);

  // 5. Timezone validation check
  console.log('Verifying invalid timezone validation...');
  assert.throws(() => {
    createClient('another-client', 'Invalid/Timezone_Name');
  }, /Invalid IANA timezone/);

  // 6. Cleanup
  console.log('Cleaning up test files...');
  fs.unlinkSync(getClientFilePath(testClientId));
  assert.equal(clientExists(testClientId), false, 'Client file should be deleted after cleanup');

  console.log('🎉 All state tests passed successfully!');
}

try {
  runTests();
  process.exit(0);
} catch (error) {
  console.error('❌ Test failed with error:', error);
  process.exit(1);
}
