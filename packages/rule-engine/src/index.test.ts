import { describe, expect, it } from 'vitest';
import { generate } from './index.js';

describe('rule-engine package public API', () => {
  it('exports generate from the package root', () => {
    expect(typeof generate).toBe('function');
  });
});
