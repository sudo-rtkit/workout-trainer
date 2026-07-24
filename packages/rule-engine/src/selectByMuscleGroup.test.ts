import { describe, expect, it } from 'vitest';
import { selectByMuscleGroup } from './selectByMuscleGroup.js';
import type { Exercise } from './types.js';

function makeExercise(overrides: Partial<Exercise> & Pick<Exercise, 'id' | 'movementPattern'>): Exercise {
  return {
    name: overrides.id,
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    isCompound: false,
    requiredEquipmentIds: [],
    ...overrides,
  };
}

describe('selectByMuscleGroup', () => {
  it('never selects two exercises with the same movement pattern', () => {
    const benchA = makeExercise({ id: 'a', movementPattern: 'bench-press' });
    const benchB = makeExercise({ id: 'b', movementPattern: 'bench-press' });
    const flye = makeExercise({ id: 'c', movementPattern: 'chest-flye' });

    const result = selectByMuscleGroup([benchA, benchB, flye], ['chest'], 3);

    const patterns = result.map((e) => e.movementPattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(result.length).toBe(2); // only 2 distinct patterns exist
  });

  it('orders compound exercises before isolation exercises', () => {
    const isolation = makeExercise({ id: 'iso', movementPattern: 'chest-flye', isCompound: false });
    const compound = makeExercise({ id: 'comp', movementPattern: 'bench-press', isCompound: true });

    const result = selectByMuscleGroup([isolation, compound], ['chest'], 2);

    expect(result.map((e) => e.id)).toEqual(['comp', 'iso']);
  });

  it('only includes exercises matching a target muscle group', () => {
    const chestExercise = makeExercise({ id: 'chest-ex', movementPattern: 'bench-press', primaryMuscles: ['chest'] });
    const backExercise = makeExercise({ id: 'back-ex', movementPattern: 'row', primaryMuscles: ['back'] });

    const result = selectByMuscleGroup([chestExercise, backExercise], ['chest'], 2);

    expect(result.map((e) => e.id)).toEqual(['chest-ex']);
  });
});
