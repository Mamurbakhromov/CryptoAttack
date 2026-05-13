import { describe, expect, it } from 'vitest';

import { matchesCoinClassificationFilter } from './coinClassification';

describe('coin classification filters', () => {
  it('supports strict halal, either halal, haram, and unchecked modes', () => {
    expect(matchesCoinClassificationFilter('BTC', ['halal'])).toBe(true);
    expect(matchesCoinClassificationFilter('BTC', ['either_halal'])).toBe(true);
    expect(matchesCoinClassificationFilter('PEPE', ['haram'])).toBe(true);
    expect(matchesCoinClassificationFilter('ZZZ_UNKNOWN_TEST', ['unchecked'])).toBe(true);

    expect(matchesCoinClassificationFilter('PEPE', ['halal'])).toBe(false);
    expect(matchesCoinClassificationFilter('BTC', ['haram'])).toBe(false);
    expect(matchesCoinClassificationFilter('BTC', ['unchecked'])).toBe(false);
  });

  it('includes coins with at least one halal source and no doubtful or haram source in halal only', () => {
    expect(matchesCoinClassificationFilter('ETH', ['halal'])).toBe(true);
    expect(matchesCoinClassificationFilter('PEPE', ['halal'])).toBe(false);
  });

  it('matches any selected classification mode', () => {
    expect(matchesCoinClassificationFilter('BTC', ['haram', 'halal'])).toBe(true);
    expect(matchesCoinClassificationFilter('PEPE', ['unchecked', 'haram'])).toBe(true);
  });
});
