import { classifyMessage } from './classify.js';
import 'dotenv/config';

async function runTests() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY is not configured in .env');
    process.exit(1);
  }

  console.log('Starting LLM Classifier tests with real API calls...');

  const testCases = [
    { input: 'GM', expected: true },
    { input: "Hey, good morning, let's go", expected: true },
    { input: 'Goof morning!', expected: true },
    { input: 'Can we talk about my macros?', expected: false },
    { input: 'morning, ready to work', expected: false },
  ];

  let passed = true;

  for (const tc of testCases) {
    console.log(`\nTesting: "${tc.input}"`);
    const result = await classifyMessage(tc.input);

    if (result === null) {
      console.error(`❌ FAILED: Got null response for input "${tc.input}"`);
      passed = false;
      continue;
    }

    const isMatch = result.is_valid_gm === tc.expected;
    if (isMatch) {
      console.log(`✅ PASSED: Got is_valid_gm = ${result.is_valid_gm}`);
    } else {
      console.error(`❌ FAILED: Expected is_valid_gm = ${tc.expected}, got ${result.is_valid_gm}`);
      passed = false;
    }
    console.log(`Reasoning: "${result.reasoning}"`);
  }

  // Verify that an invalid API key throws (testing SDK integration error path)
  console.log('\nTesting error handling path using invalid key...');
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const badClient = new Anthropic({ apiKey: 'invalid_key', maxRetries: 0 });
  try {
    await badClient.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'test' }],
    });
    console.error('❌ FAILED: Expected invalid API key call to throw an error.');
    passed = false;
  } catch (e) {
    console.log('✅ PASSED: Invalid key call threw error as expected:', (e as Error).message);
  }

  if (passed) {
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.error('\n❌ SOME TESTS FAILED.');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled rejection in test runner:', err);
  process.exit(1);
});
