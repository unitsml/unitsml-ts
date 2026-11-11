// The active caller register (unitsml-ruby Conversion.current_register).
// Kept in its own module so conversion.ts and quantity.ts can read the
// scope without importing the Register class (which itself depends on
// conversion.ts). JavaScript has no threads here: the scope is the
// synchronous extent of withRegister's callback.
import type { Rational } from "./rational.js";

export interface RegisterEntry {
  readonly factor: Rational;
  readonly offset: Rational;
  /** The declared base-dimension exponents (DIMS_VECTOR names). */
  readonly vector: Map<string, Rational>;
}

export interface ActiveRegister {
  entryFor(record: unknown): RegisterEntry | undefined;
}

let current: ActiveRegister | undefined;

export function currentRegister(): ActiveRegister | undefined {
  return current;
}

/** Internal: set the active register, returning the previous one. */
export function swapRegister(next: ActiveRegister | undefined): ActiveRegister | undefined {
  const previous = current;
  current = next;
  return previous;
}
