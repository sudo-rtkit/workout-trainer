import type { Exercise } from './types.js';

export function selectByMuscleGroup(
  candidates: Exercise[],
  targetMuscleGroups: string[],
  count: number,
): Exercise[] {
  const matching = candidates.filter((exercise) =>
    exercise.primaryMuscles.some((muscle) => targetMuscleGroups.includes(muscle)),
  );

  const sorted = [...matching].sort((a, b) => Number(b.isCompound) - Number(a.isCompound));

  const seenPatterns = new Set<string>();
  const selected: Exercise[] = [];

  for (const exercise of sorted) {
    if (selected.length >= count) break;
    if (seenPatterns.has(exercise.movementPattern)) continue;
    seenPatterns.add(exercise.movementPattern);
    selected.push(exercise);
  }

  return selected;
}
