import type { Goal, GoalTemplate } from './types.js';

const GOAL_TEMPLATES: Record<Goal, GoalTemplate> = {
  strength: { sets: 4, reps: 4, restSeconds: 240 },
  hypertrophy: { sets: 3, reps: 10, restSeconds: 75 },
  endurance: { sets: 3, reps: 18, restSeconds: 40 },
  fat_loss: { sets: 3, reps: 12, restSeconds: 60 },
};

export function getGoalTemplate(goal: Goal): GoalTemplate {
  return GOAL_TEMPLATES[goal];
}
