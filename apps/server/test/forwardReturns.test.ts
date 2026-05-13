import { describe, expect, it } from 'vitest';

import { calculateForwardReturn } from '../src/db/forwardReturns.js';

describe('calculateForwardReturn', () => {
  it('calculates positive, negative, and zero returns', () => {
    expect(calculateForwardReturn({ basePrice: 100, futurePrice: 112.5 })).toMatchObject({ status: 'ready', returnPct: 12.5 });
    expect(calculateForwardReturn({ basePrice: 100, futurePrice: 90 })).toMatchObject({ status: 'ready', returnPct: -10 });
    expect(calculateForwardReturn({ basePrice: 100, futurePrice: 100 })).toMatchObject({ status: 'ready', returnPct: 0 });
  });

  it('calculates max and min returns from the observed price window', () => {
    const result = calculateForwardReturn({ basePrice: 100, futurePrice: 108, windowPrices: [95, 100, 112, 108] });

    expect(result.status).toBe('ready');
    expect(result.returnPct).toBe(8);
    expect(result.maxReturnPct).toBe(12);
    expect(result.minReturnPct).toBe(-5);
  });

  it('marks missing base and future prices without fabricating returns', () => {
    expect(calculateForwardReturn({ basePrice: null, futurePrice: 120 })).toMatchObject({ status: 'missing_base_price', returnPct: null });
    expect(calculateForwardReturn({ basePrice: 0, futurePrice: 120 })).toMatchObject({ status: 'missing_base_price', returnPct: null });
    expect(calculateForwardReturn({ basePrice: 100, futurePrice: null })).toMatchObject({ status: 'missing_future_price', returnPct: null });
  });
});
