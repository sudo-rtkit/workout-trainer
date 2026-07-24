import type { GenerationInput, GenerationResult } from './types.js';
import { filterByEquipment } from './filterByEquipment.js';
import { selectWithDegradationLadder } from './degradationLadder.js';
import { getGoalTemplate } from './goalTemplates.js';

export function generate(input: GenerationInput): GenerationResult {
  const equipmentFiltered = filterByEquipment(input.exerciseLibrary, input.availableEquipmentIds);
  const { exercises, shortfall } = selectWithDegradationLadder(
    equipmentFiltered,
    input.targetMuscleGroups,
    input.targetExerciseCount,
  );

  const template = getGoalTemplate(input.goal);

  return {
    exercises: exercises.map((exercise, index) => ({
      exerciseId: exercise.id,
      order: index + 1,
      targetSets: template.sets,
      targetReps: template.reps,
      restSeconds: template.restSeconds,
    })),
    shortfall,
  };
}
