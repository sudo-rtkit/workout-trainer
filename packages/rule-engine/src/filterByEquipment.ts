import type { Exercise } from './types.js';

export function filterByEquipment(exercises: Exercise[], availableEquipmentIds: string[]): Exercise[] {
  const available = new Set(availableEquipmentIds);
  return exercises.filter((exercise) =>
    exercise.requiredEquipmentIds.every((id) => available.has(id)),
  );
}
