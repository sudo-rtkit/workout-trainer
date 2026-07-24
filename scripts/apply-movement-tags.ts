import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TagResult {
  id: string;
  movement_pattern: string;
  is_compound: boolean;
}

async function main() {
  const raw = readFileSync('scripts/data/movement-tags-review.json', 'utf-8');
  const tags: TagResult[] = JSON.parse(raw);

  for (const tag of tags) {
    const { error } = await supabase
      .from('exercises')
      .update({ movement_pattern: tag.movement_pattern, is_compound: tag.is_compound })
      .eq('id', tag.id);

    if (error) throw error;
  }

  console.log(`Applied movement_pattern/is_compound to ${tags.length} exercises.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
