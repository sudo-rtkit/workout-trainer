import { describe, expect, it } from 'vitest';
import { generate } from './generate.js';
import type { Exercise } from './types.js';

const bodyweightSquat: Exercise = {
  id: 'ex-bw-squat',
  name: 'Bodyweight Squat',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  movementPattern: 'squat',
  isCompound: true,
  requiredEquipmentIds: [],
};

const bodyweightLunge: Exercise = {
  id: 'ex-bw-lunge',
  name: 'Bodyweight Lunge',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  movementPattern: 'lunge',
  isCompound: true,
  requiredEquipmentIds: [],
};

const barbellBackSquat: Exercise = {
  id: 'ex-bb-squat',
  name: 'Barbell Back Squat',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  movementPattern: 'squat',
  isCompound: true,
  requiredEquipmentIds: ['eq-barbell', 'eq-rack'],
};

describe('generate', () => {
  it('a sparse home-gym equipment profile still yields a sensible leg day', () => {
    const result = generate({
      exerciseLibrary: [bodyweightSquat, bodyweightLunge, barbellBackSquat],
      availableEquipmentIds: [], // no equipment at all
      targetMuscleGroups: ['quads'],
      goal: 'hypertrophy',
      targetExerciseCount: 3,
    });

    // Barbell squat is filtered out entirely (equipment unavailable). Only 2 bodyweight
    // leg exercises exist in the library, so the target of 3 can't be fully met.
    expect(result.exercises.map((e) => e.exerciseId).sort()).toEqual(
      ['ex-bw-lunge', 'ex-bw-squat'].sort(),
    );
    expect(result.shortfall).toBe(1);
    expect(result.exercises.every((e) => e.targetSets === 3 && e.targetReps === 10)).toBe(true);
  });

  it('never repeats a movement pattern when enough distinct patterns exist', () => {
    const anotherSquatVariant: Exercise = {
      id: 'ex-bw-squat-2',
      name: 'Goblet Squat',
      primaryMuscles: ['quads'],
      secondaryMuscles: ['glutes'],
      movementPattern: 'squat',
      isCompound: true,
      requiredEquipmentIds: [],
    };
    const library = [bodyweightSquat, bodyweightLunge, anotherSquatVariant];

    const result = generate({
      exerciseLibrary: library,
      availableEquipmentIds: [],
      targetMuscleGroups: ['quads'],
      goal: 'strength',
      targetExerciseCount: 2,
    });

    const patterns = result.exercises.map(
      (e) => library.find((ex) => ex.id === e.exerciseId)?.movementPattern,
    );
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(result.shortfall).toBe(0);
  });
});
