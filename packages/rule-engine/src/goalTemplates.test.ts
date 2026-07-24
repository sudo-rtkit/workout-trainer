import { describe, expect, it } from 'vitest';
import { getGoalTemplate } from './goalTemplates.js';

describe('getGoalTemplate', () => {
  it('returns a low-rep, long-rest template for strength', () => {
    const template = getGoalTemplate('strength');
    expect(template.reps).toBeLessThanOrEqual(6);
    expect(template.restSeconds).toBeGreaterThanOrEqual(180);
  });

  it('returns a high-rep, short-rest template for endurance', () => {
    const template = getGoalTemplate('endurance');
    expect(template.reps).toBeGreaterThanOrEqual(15);
    expect(template.restSeconds).toBeLessThanOrEqual(60);
  });

  it('returns a template for every goal', () => {
    for (const goal of ['strength', 'hypertrophy', 'endurance', 'fat_loss'] as const) {
      const template = getGoalTemplate(goal);
      expect(template.sets).toBeGreaterThan(0);
      expect(template.reps).toBeGreaterThan(0);
      expect(template.restSeconds).toBeGreaterThan(0);
    }
  });
});
