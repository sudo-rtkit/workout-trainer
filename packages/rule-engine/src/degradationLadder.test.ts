import { describe, expect, it } from 'vitest';
import { selectWithDegradationLadder } from './degradationLadder.js';
import type { Exercise } from './types.js';

function makeExercise(overrides: Partial<Exercise> & Pick<Exercise, 'id' | 'movementPattern'>): Exercise {
  return {
    name: overrides.id,
    primaryMuscles: [],
    secondaryMuscles: [],
    isCompound: false,
    requiredEquipmentIds: [],
    ...overrides,
  };
}

describe('selectWithDegradationLadder', () => {
  it('rung 1: fully satisfies the target using only primary-muscle matches when enough exist', () => {
    const a = makeExercise({ id: 'a', movementPattern: 'squat', primaryMuscles: ['quads'] });
    const b = makeExercise({ id: 'b', movementPattern: 'lunge', primaryMuscles: ['quads'] });

    const result = selectWithDegradationLadder([a, b], ['quads'], 2);

    expect(result.shortfall).toBe(0);
    expect(result.exercises.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('rung 2: falls back to secondary-muscle matches when primary matches run out', () => {
    const primaryMatch = makeExercise({ id: 'primary', movementPattern: 'squat', primaryMuscles: ['quads'] });
    const secondaryMatch = makeExercise({
      id: 'secondary',
      movementPattern: 'lunge',
      primaryMuscles: ['glutes'],
      secondaryMuscles: ['quads'],
    });

    const result = selectWithDegradationLadder([primaryMatch, secondaryMatch], ['quads'], 2);

    expect(result.shortfall).toBe(0);
    expect(result.exercises.map((e) => e.id).sort()).toEqual(['primary', 'secondary']);
  });

  it('rung 3: repeats a movement pattern when no distinct pattern remains, reporting no shortfall if count is met', () => {
    const squatA = makeExercise({ id: 'squat-a', movementPattern: 'squat', primaryMuscles: ['quads'] });
    const squatB = makeExercise({ id: 'squat-b', movementPattern: 'squat', primaryMuscles: ['quads'] });

    const result = selectWithDegradationLadder([squatA, squatB], ['quads'], 2);

    expect(result.shortfall).toBe(0);
    expect(result.exercises.map((e) => e.id).sort()).toEqual(['squat-a', 'squat-b']);
  });

  it('reports a shortfall and returns what it could find when the library is too sparse', () => {
    const onlyOption = makeExercise({ id: 'only', movementPattern: 'squat', primaryMuscles: ['quads'] });

    const result = selectWithDegradationLadder([onlyOption], ['quads'], 3);

    expect(result.shortfall).toBe(2);
    expect(result.exercises.map((e) => e.id)).toEqual(['only']);
  });
});
