import { describe, expect, it } from 'vitest';
import { RULE_ENGINE_VERSION } from './index.js';

describe('rule-engine package', () => {
  it('exposes a version string, proving the build/test harness is wired up', () => {
    expect(typeof RULE_ENGINE_VERSION).toBe('string');
  });
});
