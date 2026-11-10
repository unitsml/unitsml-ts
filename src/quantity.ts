// A quantity: an exact magnitude plus a parsed unit expression — the
// conversion/difference subset of unitsml-ruby Unitsml::Quantity
// (unitsml-ruby#82 R-A1/A2/A3/A4): exact arithmetic, structural unit
// composition (Compose::Builder), scale and dimension gates.
import { Unitsdb } from "unitsdb";
import {
  ConversionError,
  dimensionEntries,
  toCanonical,
  type Definitions,
} from "./conversion.js";
import { copyFormula, quantityProduct } from "./compose.js";
import { Dimension, Fenced, Formula, Number_, Sqrt, Unit, type ModelNode } from "./model.js";
import { Parser } from "./parser.js";
import { Rational } from "./rational.js";
import { units2dimensions } from "./utility.js";

/** unitsml-ruby Errors::DimensionMismatchError. */
export class DimensionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DimensionMismatchError";
  }
}

/** unitsml-ruby Errors::ScaleOperationError. */
export class ScaleOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaleOperationError";
  }
}

/** unitsml-ruby Errors::IndeterminateResultError. */
export class IndeterminateResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndeterminateResultError";
  }
}

/** unitsml-ruby Errors::InvalidUnitEntryError: value is the rejected entry
 * itself; field names the entry point (operand for * and /, unit for the
 * constructor). */
export class InvalidUnitEntryError extends Error {
  constructor(readonly value: unknown, readonly field: "operand" | "unit") {
    super(
      field === "operand"
        ? `[unitsml] Cannot compose with ${describeEntry(value)} — not a supported operand for this operator.`
        : `[unitsml] Invalid unit: ${describeEntry(value)} — expected a Unit or Formula.`,
    );
    this.name = "InvalidUnitEntryError";
  }
}

/** ratio, interval (absolute interval-scale value, e.g. 20 degC) or
 * difference (a difference of two quantities: converts without addends). */
export type QuantityScale = "ratio" | "interval" | "difference";

export type RationalInput = Rational | string | number | bigint;

/** A scalar operand of times/dividedBy (Ruby Numeric). Strings are not
 * operands there (Ruby rejects a String operand); scaledBy takes them. */
export type ScalarInput = Rational | number | bigint;

/** A bare Unit, Dimension or Formula composes as a magnitude-1 quantity. */
export type QuantityOperand = Quantity | Unit | Dimension | Formula;

export class Quantity {
  readonly value: Rational;
  readonly formula: Formula | undefined;
  readonly scale: QuantityScale;

  /** formula undefined is a pure number; a Unit is wrapped as a one-term
   * formula (Ruby unit: Unit). scale defaults to the scale derived from
   * the units' unitsdb scale_reference. */
  constructor(value: RationalInput, formula?: Formula | Unit, scale?: QuantityScale) {
    this.value = Rational.from(value);
    this.formula = buildFormula(formula);
    this.scale = scale ?? this.derivedScale();
  }

  /** Parse unitExpression (an AsciiUnits expression) and build the quantity. */
  static async parse(value: RationalInput, unitExpression: string): Promise<Quantity> {
    return new Quantity(value, await new Parser(unitExpression).parse());
  }

  /** Base-dimension exponents summed across the expression; undefined when
   * a unit has no decomposition path (legality then defers to conversion). */
  dimensionVector(): Map<string, number> | undefined {
    const list = this.rawDimensionList();
    if (list === undefined) return undefined;
    const vector = new Map<string, number>();
    for (const entry of list) {
      vector.set(entry.dimension, (vector.get(entry.dimension) ?? 0) + entry.exponent);
    }
    for (const [dimension, exponent] of vector) if (exponent === 0) vector.delete(dimension);
    return vector;
  }

  /** R-A4: sums are legal on ratio and interval scales; only the dimension
   * must match. */
  plus(other: Quantity): Quantity {
    quantityKind(other);
    this.gateDimension(other);
    return new Quantity(this.value.add(other.value), copyFormula(this.formula));
  }

  /** A difference is difference-typed: 20 degC - 15 degC converts to 5 K. */
  minus(other: Quantity): Quantity {
    quantityKind(other);
    this.gateDimension(other);
    return new Quantity(this.value.sub(other.value), copyFormula(this.formula), "difference");
  }

  /** Ruby Quantity#*: a number scales (gated on interval scales); a
   * quantity, or a bare Unit/Dimension/Formula as a magnitude-1 quantity,
   * multiplies values and composes units structurally. */
  times(other: QuantityOperand | ScalarInput): Quantity {
    if (isScalar(other)) return this.scaledBy(other);
    const operand = quantityOperand(other);
    this.scaleRatioGate(operand, "multiplication");
    return new Quantity(this.value.mul(operand.value), quantityProduct(this.formula, operand.formula, "*"));
  }

  /** Ruby Quantity#/: division by zero is an IndeterminateResultError. */
  dividedBy(other: QuantityOperand | ScalarInput): Quantity {
    if (isScalar(other)) {
      const divisor = Rational.from(other);
      if (divisor.isZero()) {
        throw new IndeterminateResultError("division by a zero quantity is indeterminate");
      }
      this.gateScaling();
      // A scaled difference stays a difference (see scaledBy).
      return new Quantity(this.value.div(divisor), copyFormula(this.formula), this.scale);
    }
    const operand = quantityOperand(other);
    this.scaleRatioGate(operand, "division");
    if (operand.value.isZero()) {
      throw new IndeterminateResultError("division by a zero quantity is indeterminate");
    }
    return new Quantity(this.value.div(operand.value), quantityProduct(this.formula, operand.formula, "/"));
  }

  /** The normalized unit expression; the value for pure numbers. */
  get normText(): string {
    return this.formula?.normText ?? this.value.toString();
  }

  /** Scaling by a number: legal on ratio scales and differences, a
   * ScaleOperationError on an absolute interval-scale value. */
  scaledBy(number: RationalInput): Quantity {
    this.gateScaling();
    return new Quantity(this.value.mul(Rational.from(number)), copyFormula(this.formula), this.scale);
  }

  /** R-A3: convert to another dimension-compatible unit through unitsdb
   * canonical data, or caller-supplied conversion definitions (unit ids or
   * symbols → ConversionDefinition / conversion model). Exact throughout. */
  async convertTo(
    target: string | Formula,
    options: { definitions?: Definitions } = {},
  ): Promise<Quantity> {
    const targetFormula = typeof target === "string" ? await new Parser(target).parse() : target;
    return this.convertToFormula(targetFormula, options);
  }

  /** convertTo for an already-parsed target (synchronous). */
  convertToFormula(targetFormula: Formula, options: { definitions?: Definitions } = {}): Quantity {
    this.gateDimension(new Quantity(0, targetFormula));
    if (this.formula === undefined) {
      throw new ConversionError("cannot convert a pure number to a unit");
    }
    const src = toCanonical(this.formula, options.definitions);
    const dst = toCanonical(targetFormula, options.definitions);
    const converted =
      this.scale === "difference"
        ? this.value.mul(src.factor).div(dst.factor)
        : this.value.mul(src.factor).add(src.offset).sub(dst.offset).div(dst.factor);
    // a converted difference is still a difference
    return new Quantity(converted, targetFormula, this.scale === "difference" ? "difference" : undefined);
  }

  /** Equal magnitude and dimension vector (Ruby Quantity#==). */
  equals(other: Quantity): boolean {
    if (!this.value.equals(other.value)) return false;
    const mine = this.dimensionVector();
    const theirs = other.dimensionVector();
    if (mine === undefined || theirs === undefined) return mine === theirs;
    return sameVector(mine, theirs);
  }

  private derivedScale(): QuantityScale {
    if (!this.formula) return "ratio";
    const interval = extractUnits(this.formula.value).some((unit) => {
      const record = Unitsdb.findUnitBySymbolId(unit.unitName) as
        | { scale_reference?: { id?: string } | null }
        | undefined;
      return (record?.scale_reference?.id ?? "").includes("interval");
    });
    return interval ? "interval" : "ratio";
  }

  private rawDimensionList(): Array<{ dimension: string; exponent: number }> | undefined {
    if (!this.formula) return [];
    const units = extractUnits(this.formula.value);
    const legacy = units2dimensions(units);
    if (legacy !== undefined) {
      return legacy.map((entry) => ({
        dimension: entry.dimension as string,
        exponent: truncateExponent(entry.exponent),
      }));
    }
    const canonical = dimensionEntries(this.formula);
    return canonical?.map((entry) => ({
      dimension: entry.dimension,
      exponent: Number(entry.exponent.toInteger()),
    }));
  }

  private gateDimension(other: Quantity): void {
    const mine = this.dimensionVector();
    const theirs = other.dimensionVector();
    if (mine === undefined || theirs === undefined) return;
    if (sameVector(mine, theirs)) return;
    throw new DimensionMismatchError(
      `dimension mismatch: ${formatVector(mine)} vs ${formatVector(theirs)}`,
    );
  }

  private scaleRatioGate(other: Quantity, operation: string): void {
    if (this.scale !== "interval" && other.scale !== "interval") return;
    throw new ScaleOperationError(
      `${operation} is not legal between ${this.scale} and ${other.scale} scale quantities`,
    );
  }

  private gateScaling(): void {
    if (this.scale === "ratio" || this.scale === "difference") return;
    throw new ScaleOperationError(`scaling is not legal on a ${this.scale} scale quantity`);
  }
}

function isScalar(value: unknown): value is ScalarInput {
  return typeof value === "number" || typeof value === "bigint" || value instanceof Rational;
}

/** Compose.quantity_operand: a Quantity passes through; a Formula, or a
 * bare Unit/Dimension wrapped as one term, becomes a magnitude-1 quantity
 * (nothing is parsed). Anything else is a typed operand error. */
export function quantityOperand(value: unknown): Quantity {
  if (value instanceof Quantity) return value;
  if (value instanceof Formula) return new Quantity(1, value);
  if (value instanceof Unit || value instanceof Dimension) return new Quantity(1, fromTerm(value));
  throw new InvalidUnitEntryError(value, "operand");
}

/** Builder.from_terms([leaf]): a root formula holding a copy of the leaf. */
function fromTerm(leaf: Unit | Dimension): Formula {
  return quantityProduct(undefined, new Formula([leaf]), "*") as Formula;
}

function buildFormula(source: unknown): Formula | undefined {
  if (source === undefined || source === null) return undefined;
  if (source instanceof Formula) return source;
  if (source instanceof Unit) return fromTerm(source);
  throw new InvalidUnitEntryError(source, "unit");
}

/** Ruby quantity_kind!: + and - take only quantities. */
function quantityKind(other: unknown): void {
  if (!(other instanceof Quantity)) {
    throw new TypeError(`${describeEntry(other)} is not a Unitsml::Quantity`);
  }
}

function describeEntry(value: unknown): string {
  if (value === null) return "nil";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return `a ${(value as object).constructor?.name ?? "Object"}`;
  return String(value);
}

/** Ruby Integer conversion of an exponent (raw_value.to_i / to_i): truncation. */
function truncateExponent(exponent: unknown): number {
  if (typeof exponent === "number") return Math.trunc(exponent);
  if (exponent instanceof Number_ || exponent instanceof Fenced) {
    const parsed = Number.parseInt(String(exponent.rawValue), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function sameVector(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [dimension, exponent] of a) if (b.get(dimension) !== exponent) return false;
  return true;
}

function formatVector(vector: Map<string, number>): string {
  return `{${[...vector].map(([k, v]) => `${JSON.stringify(k)} => ${v}`).join(", ")}}`;
}

/** Ruby Quantity#extract_units: units with sqrt mapped to power 0.5. */
function extractUnits(value: ModelNode[]): Unit[] {
  return value.flatMap((term) => {
    if (term instanceof Unit) return [new Unit(term.unitName, term.powerNumerator, term.prefix)];
    if (term instanceof Formula) return extractUnits([...term.value]);
    if (term instanceof Sqrt) {
      if (!(term.value instanceof Unit)) return [];
      return [new Unit(term.value.unitName, new Number_("0.5"), term.value.prefix)];
    }
    if (term instanceof Fenced) {
      return term.value instanceof Formula ? extractUnits([...term.value.value]) : extractUnits([term.value]);
    }
    return [];
  });
}
