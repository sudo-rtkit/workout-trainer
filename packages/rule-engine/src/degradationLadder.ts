import type { Exercise } from './types.js';
import { selectByMuscleGroup } from './selectByMuscleGroup.js';

export interface DegradationResult {
  exercises: Exercise[];
  shortfall: number;
}

export function selectWithDegradationLadder(
  candidates: Exercise[],
  targetMuscleGroups: string[],
  count: number,
): DegradationResult {
  // Rung 1: primary-muscle match, one exercise per movement pattern.
  const selected = selectByMuscleGroup(candidates, targetMuscleGroups, count);
  if (selected.length >= count) {
    return { exercises: selected.slice(0, count), shortfall: 0 };
  }

  // Rung 2: also allow secondary-muscle matches, still one per movement pattern.
  const selectedIds = new Set(selected.map((e) => e.id));
  const secondaryMatches = candidates.filter(
    (exercise) =>
      !selectedIds.has(exercise.id) &&
      exercise.secondaryMuscles.some((muscle) => targetMuscleGroups.includes(muscle)),
  );
  const sortedSecondary = [...secondaryMatches].sort(
    (a, b) => Number(b.isCompound) - Number(a.isCompound),
  );
  const seenPatterns = new Set(selected.map((e) => e.movementPattern));
  for (const exercise of sortedSecondary) {
    if (selected.length >= count) break;
    if (seenPatterns.has(exercise.movementPattern)) continue;
    seenPatterns.add(exercise.movementPattern);
    selected.push(exercise);
    selectedIds.add(exercise.id);
  }
  if (selected.length >= count) {
    return { exercises: selected.slice(0, count), shortfall: 0 };
  }

  // Rung 3: allow repeated movement patterns among any primary-or-secondary match.
  const primaryOrSecondary = candidates.filter(
    (exercise) =>
      exercise.primaryMuscles.some((m) => targetMuscleGroups.includes(m)) ||
      exercise.secondaryMuscles.some((m) => targetMuscleGroups.includes(m)),
  );
  const sortedAll = [...primaryOrSecondary].sort(
    (a, b) => Number(b.isCompound) - Number(a.isCompound),
  );
  for (const exercise of sortedAll) {
    if (selected.length >= count) break;
    if (selectedIds.has(exercise.id)) continue;
    selectedIds.add(exercise.id);
    selected.push(exercise);
  }

  const shortfall = Math.max(0, count - selected.length);
  return { exercises: selected.slice(0, count), shortfall };
}
