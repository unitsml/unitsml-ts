export * from "./model.js";
export * from "unitsdb";
export { Parser, ParseError, mapTree, updateUnitsExponents } from "./parser.js";
export * from "./utility.js";
export { toXml } from "./render.js";
export { Rational } from "./rational.js";
export {
  ConversionError,
  InexactPowerError,
  ConversionDefinition,
  parseConversionXml,
  lexicalDecimal,
  toCanonical,
  dimensionEntries,
} from "./conversion.js";
export type {
  ConversionKind,
  ConversionModel,
  ConversionResult,
  Definitions,
  CanonicalDimensionEntry,
} from "./conversion.js";
export {
  Quantity,
  DimensionMismatchError,
  ScaleOperationError,
  IndeterminateResultError,
  InvalidUnitEntryError,
  quantityOperand,
} from "./quantity.js";
export { copyFormula, quantityProduct, MixedTermsError } from "./compose.js";
export {
  QuantityKind,
  QuantityKindMismatchError,
  UnknownQuantityKindError,
  PrimaryQuantityError,
} from "./quantity-kind.js";
export type { QuantityKindInput, PrimaryUnitRecord } from "./quantity-kind.js";
export {
  Register,
  withRegister,
  InvalidUnitRegisterError,
  UnknownUnitError,
} from "./register.js";
export type { UnitRegisterEntryInput } from "./register.js";
export { currentRegister } from "./register-scope.js";
export type { QuantityOperand, QuantityScale, RationalInput, ScalarInput, QuantityKindSource } from "./quantity.js";
export { stringToHtmlEntity, htmlEntityToUnicode } from "./mathml.js";

import { Parser } from "./parser.js";
import type { Formula } from "./model.js";

/** Parse a UnitsML AsciiUnits expression (with optional unitsml(...) wrap
 * and extras) into a Formula — the unitsml-ruby `Unitsml.parse` entry. */
export async function parse(input: string): Promise<Formula> {
  return new Parser(input).parse();
}
