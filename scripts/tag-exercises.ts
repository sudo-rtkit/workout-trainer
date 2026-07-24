import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required');
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY env var is required');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

interface SourceExercise {
  id: string;
  name: string;
  primary_muscles: string[];
}

interface TagResult {
  id: string;
  movement_pattern: string;
  is_compound: boolean;
}

const BATCH_SIZE = 40;

async function tagBatch(batch: SourceExercise[]): Promise<TagResult[]> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `For each exercise below, assign:
- movement_pattern: a short lowercase-with-hyphens label grouping equipment variants of the same movement (e.g. "bench-press", "barbell-row", "back-squat"). Equipment variants of the same movement must share the same label.
- is_compound: true if the exercise works multiple major muscle groups/joints at once (e.g. squat, bench press, deadlift, row), false for single-joint isolation exercises (e.g. bicep curl, leg extension).

Respond with ONLY a JSON array of {"id": "...", "movement_pattern": "...", "is_compound": true|false}, one entry per exercise, no other text.

Exercises:
${batch.map((e) => `- id: ${e.id}, name: "${e.name}", primary_muscles: ${e.primary_muscles.join(', ')}`).join('\n')}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

  return JSON.parse(textBlock.text) as TagResult[];
}

async function main() {
  const { data: exercises, error } = await supabase
    .from('exercises')
    .select('id, name, primary_muscles')
    .eq('source', 'seed');

  if (error) throw error;
  if (!exercises || exercises.length === 0) throw new Error('No seed exercises found — run scripts/seed-exercises.ts first');

  const allResults: TagResult[] = [];
  for (let i = 0; i < exercises.length; i += BATCH_SIZE) {
    const batch = exercises.slice(i, i + BATCH_SIZE);
    const results = await tagBatch(batch);
    allResults.push(...results);
    console.log(`Tagged ${allResults.length}/${exercises.length}`);
  }

  writeFileSync('scripts/data/movement-tags-review.json', JSON.stringify(allResults, null, 2));
  console.log(
    'Wrote scripts/data/movement-tags-review.json — review and hand-edit this file, then run scripts/apply-movement-tags.ts',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
