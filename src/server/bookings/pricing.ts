import "server-only";

export interface PriceInput {
  /** Adult price, minor units. */
  priceAdult: number;
  /** Child price as a percentage of the adult price (0–100). */
  childPricePercent: number;
  adults: number;
  children: number;
}

export interface PriceBreakdown {
  unitPriceAdult: number;
  unitPriceChild: number;
  baseAmount: number;
}

const isCount = (value: number) => Number.isInteger(value) && value >= 0;

/**
 * Price before discount, in integer minor units. The child unit price is
 * rounded half-up once, then multiplied, so the total always equals the sum
 * of the unit prices shown to the customer.
 */
export function priceBooking(input: PriceInput): PriceBreakdown {
  const { priceAdult, childPricePercent, adults, children } = input;
  if (!isCount(priceAdult) || !isCount(adults) || !isCount(children)) {
    throw new RangeError("Prices and party sizes must be non-negative integers.");
  }
  if (!Number.isFinite(childPricePercent) || childPricePercent < 0 || childPricePercent > 100) {
    throw new RangeError("Child price percent must be between 0 and 100.");
  }
  const unitPriceChild = Math.round((priceAdult * childPricePercent) / 100);
  return {
    unitPriceAdult: priceAdult,
    unitPriceChild,
    baseAmount: adults * priceAdult + children * unitPriceChild,
  };
}
