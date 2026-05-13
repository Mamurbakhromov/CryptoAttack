export type ForwardReturnStatus = 'pending' | 'ready' | 'missing_price' | 'missing_base_price' | 'missing_future_price' | 'expired' | 'error';

export interface ForwardReturnCalculationInput {
  basePrice: number | null;
  futurePrice: number | null;
  windowPrices?: number[];
}

export interface ForwardReturnCalculationResult {
  status: ForwardReturnStatus;
  returnPct: number | null;
  maxReturnPct: number | null;
  minReturnPct: number | null;
  errorMessage: string | null;
}

export function calculateForwardReturn(input: ForwardReturnCalculationInput): ForwardReturnCalculationResult {
  if (input.basePrice === null || !Number.isFinite(input.basePrice) || input.basePrice <= 0) {
    return missing('missing_base_price', 'Missing valid base price');
  }

  if (input.futurePrice === null || !Number.isFinite(input.futurePrice)) {
    return missing('missing_future_price', 'Missing valid future price');
  }

  const returnPct = percentReturn(input.basePrice, input.futurePrice);
  const validWindowPrices = (input.windowPrices ?? []).filter((price) => Number.isFinite(price) && price > 0);
  const windowReturns = validWindowPrices.length ? validWindowPrices.map((price) => percentReturn(input.basePrice as number, price)) : [returnPct];

  return {
    status: 'ready',
    returnPct,
    maxReturnPct: Math.max(...windowReturns),
    minReturnPct: Math.min(...windowReturns),
    errorMessage: null
  };
}

function missing(status: ForwardReturnStatus, errorMessage: string): ForwardReturnCalculationResult {
  return {
    status,
    returnPct: null,
    maxReturnPct: null,
    minReturnPct: null,
    errorMessage
  };
}

function percentReturn(basePrice: number, futurePrice: number): number {
  return ((futurePrice - basePrice) / basePrice) * 100;
}
