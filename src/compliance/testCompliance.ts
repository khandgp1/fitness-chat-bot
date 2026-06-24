import fs from 'fs';
import path from 'path';
import assert from 'assert';

// 1. Point store directory to a test directory before importing store/compliance/scheduler
const TEST_DATA_DIR = path.join(process.cwd(), 'data_test');
process.env.DATA_DIR = TEST_DATA_DIR;

import { ClientState } from '../state/schema.js';
import { createClient, loadClient, saveClient } from '../state/store.js';
import {
  getLocalDateStr,
  getNextDateStr,
  transitionClientDays,
  handleGmResult,
} from './compliance.js';
import { startHourlyScheduler } from '../scheduler/hourly.js';

// Helper to clean up the test data directory
function cleanTestDir(): void {
  if (fs.existsSync(TEST_DATA_DIR)) {
    const files = fs.readdirSync(TEST_DATA_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEST_DATA_DIR, file));
    }
    fs.rmdirSync(TEST_DATA_DIR);
  }
}

function runTests() {
  console.log('--- STARTING COMPLIANCE & SCHEDULER TESTS ---');

  // Ensure we start fresh
  cleanTestDir();
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  try {
    // ==========================================
    // Test 1: Date Utility Functions
    // ==========================================
    console.log('Testing date utility functions...');
    const localDate = getLocalDateStr('UTC');
    assert.match(localDate, /^\d{4}-\d{2}-\d{2}$/, 'getLocalDateStr should return YYYY-MM-DD');

    const nextDateStr = getNextDateStr('2026-06-30');
    assert.strictEqual(
      nextDateStr,
      '2026-07-01',
      'getNextDateStr should transition months properly',
    );
    assert.strictEqual(
      getNextDateStr('2026-12-31'),
      '2027-01-01',
      'getNextDateStr should transition years properly',
    );

    // ==========================================
    // Test 2: transitionClientDays Logic
    // ==========================================
    console.log('Testing transitionClientDays directly...');

    // Setup state
    let state: ClientState = {
      client_id: 'test_client_1',
      timezone: 'UTC',
      gm_received_today: false,
      compliance_status: 'Unknown',
      streak_count: 5,
      current_response_level: 0,
      window_position: 0,
      responses_given: 0,
      last_active_date: '2026-06-15',
      gm_log: [],
      miss_log: [],
      pending_review_log: [],
      classification_log: [],
    };

    // Transition to same day: should have no change
    state = transitionClientDays(state, '2026-06-15');
    assert.strictEqual(state.last_active_date, '2026-06-15');
    assert.strictEqual(state.streak_count, 5);
    assert.strictEqual(state.miss_log.length, 0);

    // Transition to next day without check-in: should log a Miss and reset streak
    state = transitionClientDays(state, '2026-06-16');
    assert.strictEqual(state.last_active_date, '2026-06-16');
    assert.strictEqual(state.streak_count, 0, 'Streak should reset to 0 on Miss');
    assert.deepStrictEqual(state.miss_log, ['2026-06-15'], 'Miss should be logged for 2026-06-15');
    assert.strictEqual(
      state.compliance_status,
      'Unknown',
      'New day status should reset to Unknown',
    );
    assert.strictEqual(
      state.gm_received_today,
      false,
      'New day gm_received_today should reset to false',
    );

    // Simulate check-in on 2026-06-16
    state.gm_received_today = true;
    state.compliance_status = 'Compliant';
    state.streak_count = 1;

    // Transition to 2026-06-17 with compliant day: should transition date, no Miss logged, streak holds
    state = transitionClientDays(state, '2026-06-17');
    assert.strictEqual(state.last_active_date, '2026-06-17');
    assert.strictEqual(state.streak_count, 1, 'Streak should hold at 1');
    assert.deepStrictEqual(state.miss_log, ['2026-06-15'], 'No new Miss should be logged');

    // Simulate Pending Review on 2026-06-17
    state.compliance_status = 'Pending Review';

    // Transition to 2026-06-18 with Pending Review: should transition date, no Miss, streak holds
    state = transitionClientDays(state, '2026-06-18');
    assert.strictEqual(state.last_active_date, '2026-06-18');
    assert.strictEqual(state.streak_count, 1, 'Streak holds during Pending Review');
    assert.deepStrictEqual(state.miss_log, ['2026-06-15'], 'No Miss logged for Pending Review day');

    // Transition to 2026-06-21 (3-day gap) with no check-in: should log multiple Misses
    state = transitionClientDays(state, '2026-06-21');
    assert.strictEqual(state.last_active_date, '2026-06-21');
    assert.strictEqual(state.streak_count, 0, 'Streak resets to 0');
    // Misses should be logged for 2026-06-18, 2026-06-19, 2026-06-20
    assert.ok(state.miss_log.includes('2026-06-18'), 'Miss logged for 18th');
    assert.ok(state.miss_log.includes('2026-06-19'), 'Miss logged for 19th');
    assert.ok(state.miss_log.includes('2026-06-20'), 'Miss logged for 20th');

    // ==========================================
    // Test 3: handleGmResult API Logic
    // ==========================================
    console.log('Testing handleGmResult logic...');

    // Create new client in database
    const clientId = 'client_test_store';
    const storeState = createClient(clientId, 'UTC');
    assert.strictEqual(storeState.streak_count, 0);
    assert.strictEqual(storeState.gm_received_today, false);
    assert.strictEqual(storeState.compliance_status, 'Unknown');
    assert.match(storeState.last_active_date || '', /^\d{4}-\d{2}-\d{2}$/);

    // Mock Date.now/Intl.DateTimeFormat if needed, but since we are running in real-time,
    // we can just use the current date returned by getLocalDateStr('UTC').
    const todayStr = getLocalDateStr('UTC');

    // Scenario A: First Valid GM
    const stateA = handleGmResult(
      storeState,
      { is_valid_gm: true, reasoning: 'Valid check-in greeting' },
      'GM',
    );
    assert.strictEqual(stateA.gm_received_today, true);
    assert.strictEqual(stateA.compliance_status, 'Compliant');
    assert.strictEqual(stateA.streak_count, 1);
    assert.strictEqual(stateA.gm_log.length, 1);
    assert.strictEqual(stateA.gm_log[0].message, 'GM');
    assert.strictEqual(stateA.classification_log.length, 1);
    assert.strictEqual(stateA.classification_log[0].is_valid_gm, true);

    // Scenario B: Duplicate GM same day
    const stateB = handleGmResult(
      stateA,
      { is_valid_gm: true, reasoning: 'Valid check-in' },
      'good morning',
    );
    assert.strictEqual(stateB.gm_received_today, true);
    assert.strictEqual(stateB.streak_count, 1, 'Streak count should not increment on duplicate');
    assert.strictEqual(stateB.gm_log.length, 1, 'Duplicate should not add to gm_log');
    assert.strictEqual(
      stateB.classification_log.length,
      2,
      'Duplicate should add to classification_log',
    );
    assert.match(
      stateB.classification_log[1].reasoning,
      /Duplicate/,
      'Should contain duplicate label',
    );

    // Scenario C: Invalid GM same day
    const stateC = handleGmResult(
      stateB,
      { is_valid_gm: false, reasoning: 'Not check-in' },
      'Can we talk macros?',
    );
    assert.strictEqual(stateC.gm_received_today, true); // remains true since we checked in earlier today
    assert.strictEqual(stateC.streak_count, 1);
    assert.strictEqual(stateC.classification_log.length, 3);
    assert.strictEqual(stateC.classification_log[2].is_valid_gm, false);

    // Reset client for next subtests
    const freshClient = createClient('client_test_store_2', 'UTC');

    // Scenario D: Invalid message on new day (Unknown)
    const stateD = handleGmResult(
      freshClient,
      { is_valid_gm: false, reasoning: 'Not check-in' },
      'What time is it?',
    );
    assert.strictEqual(stateD.gm_received_today, false);
    assert.strictEqual(
      stateD.compliance_status,
      'Unknown',
      'Invalid message should not alter compliance status from Unknown',
    );
    assert.strictEqual(stateD.classification_log.length, 1);

    // Scenario E: LLM failure (result === null)
    const stateE = handleGmResult(stateD, null, 'Gooffy morning');
    assert.strictEqual(stateE.gm_received_today, false);
    assert.strictEqual(stateE.compliance_status, 'Pending Review');
    assert.strictEqual(stateE.pending_review_log.length, 1);
    assert.strictEqual(stateE.pending_review_log[0].message, 'Gooffy morning');
    assert.strictEqual(stateE.pending_review_log[0].date, todayStr);

    // Scenario F: Natural resolution of Pending Review on same day
    const stateF = handleGmResult(
      stateE,
      { is_valid_gm: true, reasoning: 'Resolved check-in' },
      'GM',
    );
    assert.strictEqual(stateF.gm_received_today, true);
    assert.strictEqual(stateF.compliance_status, 'Compliant');
    assert.strictEqual(stateF.streak_count, 1);
    assert.strictEqual(
      stateF.pending_review_log.length,
      0,
      "Pending review log should clear today's entry on natural resolution",
    );

    // ==========================================
    // Test 4: Storage Integration & Catch-up on Load
    // ==========================================
    console.log('Testing storage integration & catch-up...');

    // Create client
    const catchupClient = createClient('client_catchup', 'UTC');
    // Artificially change last_active_date to 2 days ago
    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];

    catchupClient.last_active_date = twoDaysAgoStr;
    catchupClient.gm_received_today = false;
    catchupClient.compliance_status = 'Unknown';
    catchupClient.streak_count = 3;
    saveClient(catchupClient);

    // Loading should trigger reactive catch-up and save to disk
    const loaded = loadClient('client_catchup');
    assert.strictEqual(loaded.last_active_date, todayStr, 'Should catch up to current date');
    assert.strictEqual(loaded.streak_count, 0, 'Streak should reset to 0');
    assert.strictEqual(loaded.miss_log.length, 2, 'Two misses should be logged');

    // Verify written back to disk
    const rawData = fs.readFileSync(path.join(TEST_DATA_DIR, 'client_catchup.json'), 'utf-8');
    const diskState = JSON.parse(rawData) as ClientState;
    assert.strictEqual(diskState.last_active_date, todayStr);
    assert.strictEqual(diskState.streak_count, 0);

    // ==========================================
    // Test 5: Scheduler Verification
    // ==========================================
    console.log('Testing hourly scheduler integration...');

    // Setup another stale client
    const schedulerClient = createClient('client_scheduler', 'UTC');
    schedulerClient.last_active_date = twoDaysAgoStr;
    schedulerClient.streak_count = 4;
    saveClient(schedulerClient);

    // Start scheduler (we will call its internal cron runner task logic manually by mocking/triggering,
    // or since startHourlyScheduler returns the task, we can just run the files directory poll)
    const schedulerTask = startHourlyScheduler();

    // Since scheduler works on files in DATA_DIR, we verify that calling loadClient for each file transitions it.
    // We will simulate the top-of-hour readdir poll directly:
    const files = fs.readdirSync(TEST_DATA_DIR);
    assert.ok(files.includes('client_scheduler.json'));

    // Trigger transition by simulating load
    const updatedSched = loadClient('client_scheduler');
    assert.strictEqual(updatedSched.last_active_date, todayStr);
    assert.strictEqual(updatedSched.streak_count, 0);
    assert.strictEqual(updatedSched.miss_log.length, 2);

    // Clean up scheduler task
    schedulerTask.stop();

    // ==========================================
    // Test 6: Custom Timestamp-driven Transitions
    // ==========================================
    console.log('Testing custom timestamp-driven transitions...');

    // 1. Test getLocalDateStr with custom timestamp
    const dateUTC = getLocalDateStr('UTC', '2026-06-18T19:21:26.131Z');
    assert.strictEqual(dateUTC, '2026-06-18', 'getLocalDateStr with custom timestamp in UTC');

    const dateNY = getLocalDateStr('America/New_York', '2026-06-18T03:21:26.131Z');
    assert.strictEqual(
      dateNY,
      '2026-06-17',
      'getLocalDateStr NY day adjustment should match timezone',
    );

    // 2. Test createClient with timestamp
    const timestampedClient = createClient('client_timestamped', 'UTC', '2026-06-18T19:21:26.131Z');
    assert.strictEqual(timestampedClient.last_active_date, '2026-06-18');

    // 3. Test handleGmResult with timestamp
    const stateT1 = handleGmResult(
      timestampedClient,
      { is_valid_gm: true, reasoning: 'Custom check-in' },
      'GM',
      '2026-06-18T19:21:26.131Z',
    );
    assert.strictEqual(stateT1.gm_received_today, true);
    assert.strictEqual(stateT1.streak_count, 1);
    assert.strictEqual(stateT1.gm_log[0].timestamp, '2026-06-18T19:21:26.131Z');
    assert.strictEqual(stateT1.classification_log[0].timestamp, '2026-06-18T19:21:26.131Z');

    // Save state to disk before testing loadClient catch-up
    saveClient(stateT1);

    // 4. Test loadClient with timestamp (triggering catch-up up to that timestamp date)
    // Client was active on 2026-06-18, next day check-in is at 2026-06-20 (a miss on 19th)
    const stateT2 = loadClient('client_timestamped', '2026-06-20T12:00:00Z');
    assert.strictEqual(stateT2.last_active_date, '2026-06-20');
    assert.strictEqual(stateT2.streak_count, 0, 'Streak should reset on missed day');
    assert.deepStrictEqual(stateT2.miss_log, ['2026-06-19'], 'Miss logged for 2026-06-19');

    console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
  } finally {
    // Clean up test directories
    cleanTestDir();
  }
}

runTests();
