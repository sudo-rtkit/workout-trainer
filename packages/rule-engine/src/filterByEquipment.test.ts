import { describe, expect, it } from 'vitest';
import { filterByEquipment } from './filterByEquipment.js';
import type { Exercise } from './types.js';

const bodyweightPushup: Exercise = {
  id: 'ex-pushup',
  name: 'Push-up',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  movementPattern: 'push-up',
  isCompound: true,
  requiredEquipmentIds: [],
};

const barbellBenchPress: Exercise = {
  id: 'ex-bench',
  name: 'Barbell Bench Press',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  movementPattern: 'bench-press',
  isCompound: true,
  requiredEquipmentIds: ['eq-barbell', 'eq-bench'],
};

describe('filterByEquipment', () => {
  it('includes exercises requiring no equipment regardless of availability', () => {
    const result = filterByEquipment([bodyweightPushup], []);
    expect(result).toEqual([bodyweightPushup]);
  });

  it('excludes an exercise when only some of its required equipment is available (AND, not OR)', () => {
    const result = filterByEquipment([barbellBenchPress], ['eq-barbell']);
    expect(result).toEqual([]);
  });

  it('includes an exercise when all of its required equipment is available', () => {
    const result = filterByEquipment([barbellBenchPress], ['eq-barbell', 'eq-bench', 'eq-rack']);
    expect(result).toEqual([barbellBenchPress]);
  });
});
