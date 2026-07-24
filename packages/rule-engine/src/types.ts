export type Goal = 'strength' | 'hypertrophy' | 'endurance' | 'fat_loss';

export interface Exercise {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPattern: string;
  isCompound: boolean;
  requiredEquipmentIds: string[];
}

export interface GenerationInput {
  exerciseLibrary: Exercise[];
  availableEquipmentIds: string[];
  targetMuscleGroups: string[];
  goal: Goal;
  targetExerciseCount: number;
}

export interface GoalTemplate {
  sets: number;
  reps: number;
  restSeconds: number;
}

export interface GeneratedExercise {
  exerciseId: string;
  order: number;
  targetSets: number;
  targetReps: number;
  restSeconds: number;
}

export interface GenerationResult {
  exercises: GeneratedExercise[];
  shortfall: number;
}
