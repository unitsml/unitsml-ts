export * from "./model.js";
export * from "@unitsml/unitsdb";
export { Parser, ParseError, mapTree, updateUnitsExponents } from "./parser.js";
export * from "./utility.js";
export { toXml } from "./render.js";
export { stringToHtmlEntity, htmlEntityToUnicode } from "./mathml.js";

import { Parser } from "./parser.js";
import type { Formula } from "./model.js";

/** Parse a UnitsML AsciiUnits expression (with optional unitsml(...) wrap
 * and extras) into a Formula — the unitsml-ruby `Unitsml.parse` entry. */
export async function parse(input: string): Promise<Formula> {
  return new Parser(input).parse();
}
