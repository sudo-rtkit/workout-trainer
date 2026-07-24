import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required (see `supabase start` output)');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface FreeExerciseDbEntry {
  name: string;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
}

const EQUIPMENT_NORMALIZATION: Record<string, { name: string; category: string }> = {
  barbell: { name: 'Barbell', category: 'free_weight' },
  dumbbell: { name: 'Dumbbell', category: 'free_weight' },
  'body only': { name: 'Bodyweight', category: 'bodyweight' },
  cable: { name: 'Cable Machine', category: 'machine' },
  machine: { name: 'Machine', category: 'machine' },
  kettlebells: { name: 'Kettlebell', category: 'free_weight' },
  bands: { name: 'Resistance Band', category: 'accessory' },
  'medicine ball': { name: 'Medicine Ball', category: 'accessory' },
  'exercise ball': { name: 'Exercise Ball', category: 'accessory' },
  'e-z curl bar': { name: 'EZ Curl Bar', category: 'free_weight' },
  'foam roll': { name: 'Foam Roller', category: 'accessory' },
  other: { name: 'Other', category: 'accessory' },
};

async function main() {
  const raw = readFileSync(new URL('./data/free-exercise-db.json', import.meta.url), 'utf-8');
  const entries: FreeExerciseDbEntry[] = JSON.parse(raw);

  const equipmentValues = new Set(
    entries
      .map((e) => e.equipment?.toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );

  for (const value of equipmentValues) {
    if (!EQUIPMENT_NORMALIZATION[value]) {
      throw new Error(`Unmapped equipment value in dataset: "${value}" — add it to EQUIPMENT_NORMALIZATION`);
    }
  }

  const catalogRows = Array.from(equipmentValues).map((v) => EQUIPMENT_NORMALIZATION[v]);
  const { data: insertedCatalog, error: catalogError } = await supabase
    .from('equipment_catalog')
    .upsert(catalogRows, { onConflict: 'name' })
    .select('id, name');

  if (catalogError) throw catalogError;

  const catalogIdByName = new Map(insertedCatalog!.map((row) => [row.name as string, row.id as string]));

  let exerciseCount = 0;
  for (const entry of entries) {
    const { data: insertedExercise, error: exerciseError } = await supabase
      .from('exercises')
      .insert({
        name: entry.name,
        primary_muscles: entry.primaryMuscles,
        secondary_muscles: entry.secondaryMuscles,
        instructions: entry.instructions.join('\n'),
        source: 'seed',
      })
      .select('id')
      .single();

    if (exerciseError) throw exerciseError;
    exerciseCount += 1;

    if (entry.equipment) {
      const normalized = EQUIPMENT_NORMALIZATION[entry.equipment.toLowerCase()];
      const catalogId = catalogIdByName.get(normalized.name);
      if (!catalogId) throw new Error(`Missing catalog id for ${normalized.name}`);

      const { error: linkError } = await supabase
        .from('exercise_equipment')
        .insert({ exercise_id: insertedExercise!.id, equipment_catalog_id: catalogId });

      if (linkError) throw linkError;
    }
  }

  console.log(`Seeded ${exerciseCount} exercises and ${catalogRows.length} equipment catalog entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
