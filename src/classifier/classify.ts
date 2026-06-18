import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

// Define the ClassificationResult interface
export interface ClassificationResult {
  is_valid_gm: boolean;
  reasoning: string;
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY environment variable is not defined.');
}

// Initialize Anthropic client with a 10-second timeout and 0 retries
const anthropic = new Anthropic({
  apiKey,
  timeout: 10000,
  maxRetries: 0,
});

// Tool schema matching the specification in Section 3.4
const gmTool: Anthropic.Tool = {
  name: 'classify_gm',
  description: 'Classify whether a message is a valid GM check-in',
  input_schema: {
    type: 'object',
    properties: {
      is_valid_gm: {
        type: 'boolean',
        description: 'True if the message represents a valid morning/GM check-in, false otherwise.',
      },
      reasoning: {
        type: 'string',
        description: 'A brief, clear explanation of the classification judgment.',
      },
    },
    required: ['is_valid_gm', 'reasoning'],
  },
};

const systemPrompt = `You are a text classification assistant. Your task is to classify whether a user's message is a valid daily GM (good morning) check-in.

Guidance:
- A valid GM is a message that functions as the client's daily check-in — in the spirit of "GM" or "good morning".
- Minor typos and phrasing variations (e.g., "Goof morning", "gm!!1", "G'morning") should be recognized as valid.
- The greeting may appear anywhere in the message, not only at the start (e.g., "Quick GM, let's go" counts as valid).
- Repeated greetings do not invalidate (e.g., "GM GM" is valid).
- A bare "morning" on its own — without the fuller "good morning" framing — generally falls short of the standard and should be treated as invalid.
- Weigh the whole message and reach a reasonable conclusion, including for phrasings that sit between categories.
- Messages that don't reasonably represent a check-in — questions, comments, unrelated content — are not valid GMs.

Illustrative Examples (grounding):
- "GM" -> is_valid_gm: true
- "Hey, good morning, let's go" -> is_valid_gm: true
- "Goof morning!" -> is_valid_gm: true
- "Can we talk about my macros?" -> is_valid_gm: false
- "morning, ready to work" -> is_valid_gm: false
- "Mornin'!" -> [Use your best judgment, but generally invalid or valid based on whether it feels like a deliberate check-in greeting]

You must invoke the "classify_gm" tool with the results of your classification.`;

/**
 * Classifies if a message is a valid GM check-in.
 * Returns null if the API call fails or times out.
 */
export async function classifyMessage(message: string): Promise<ClassificationResult | null> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools: [gmTool],
      tool_choice: { type: 'tool', name: 'classify_gm' },
    });

    const toolUseBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      console.error('Claude API classification failed: No tool_use block returned.');
      return null;
    }

    const result = toolUseBlock.input as ClassificationResult;
    if (typeof result.is_valid_gm !== 'boolean' || typeof result.reasoning !== 'string') {
      console.error('Claude API classification failed: Malformed tool input.', result);
      return null;
    }

    return result;
  } catch (error) {
    console.error('Claude API classification error occurred:', error);
    return null;
  }
}
