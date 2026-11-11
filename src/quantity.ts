// A quantity: an exact magnitude plus a parsed unit expression — the
// conversion/difference subset of unitsml-ruby Unitsml::Quantity
// (unitsml-ruby#82 R-A1/A2/A3/A4): exact arithmetic, structural unit
// composition (Compose::Builder), scale and dimension gates.
import { Unitsdb } from "unitsdb";
import {
  ConversionError,
  dimensionEntries,
  opaqueRoot,
  toCanonical,
  type Definitions,
} from "./conversion.js";
import { copyFormula, quantityProduct } from "./compose.js";
import { Dimension, Extender, Fenced, Formula, Number_, Sqrt, Unit, type ModelNode } from "./model.js";
import { Parser } from "./parser.js";
import { QuantityKind, QuantityKindMismatchError, UnknownQuantityKindError, type QuantityKindInput } from "./quantity-kind.js";
import { currentRegister } from "./register-scope.js";
import { Rational } from "./rational.js";
import { DIMS_VECTOR, dimId, units2dimensions } from "./utility.js";

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

/** A quantity kind source: a QuantityKind, a UnitsDB quantity identifier or
 * name, or QuantityKind.PRIMARY. */
export type QuantityKindSource = QuantityKindInput | typeof QuantityKind.PRIMARY | null;

export class Quantity {
  readonly value: Rational;
  readonly formula: Formula | undefined;
  readonly scale: QuantityScale;
  /** An optional data-declared quantity kind (unitsml-ruby Quantity#kind).
   * Untyped quantities (undefined) keep the dimension-only gating. */
  readonly kind: QuantityKind | undefined;

  /** formula undefined is a pure number; a Unit is wrapped as a one-term
   * formula (Ruby unit: Unit). scale defaults to the scale derived from
   * the units' unitsdb scale_reference. kind is a UnitsDB quantity
   * identifier or name, a QuantityKind, or QuantityKind.PRIMARY for the
   * primary quantity of a single unit; its dimension must match the unit's. */
  constructor(
    value: RationalInput,
    formula?: Formula | Unit,
    scale?: QuantityScale,
    kind?: QuantityKindSource,
  ) {
    this.value = Rational.from(value);
    this.formula = buildFormula(formula);
    this.scale = scale ?? this.derivedScale();
    this.kind = this.resolveKind(kind);
  }

  /** Parse unitExpression (an AsciiUnits expression) and build the quantity. */
  static async parse(
    value: RationalInput,
    unitExpression: string,
    options: { scale?: QuantityScale; kind?: QuantityKindSource } = {},
  ): Promise<Quantity> {
    return new Quantity(value, await new Parser(unitExpression).parse(), options.scale, options.kind);
  }

  /** The primary quantity of this quantity's unit, selected by the UnitsDB
   * primary flag (never positional order); undefined for pure numbers and
   * composite expressions, which name no single unit record. */
  primaryKind(): QuantityKind | undefined {
    const record = this.singleUnitRecord();
    return record ? QuantityKind.primaryFor(record as never) : undefined;
  }

  /** Canonical dimension identity (Ruby Quantity#dimension_id): the
   * unitsdb dimension id of the summed vector in DIMS_VECTOR order;
   * undefined when every exponent cancels (pure numbers, sqrt forms pinned
   * by the Ruby baseline) or when the vector itself is undefined. */
  dimensionId(): string | undefined {
    const vector = this.dimensionVector();
    if (vector === undefined) return undefined;
    const list = DIMS_VECTOR.filter((dimension) => (vector.get(dimension) ?? 0) !== 0).map((dimension) => ({
      dimension,
      exponent: vector.get(dimension)!,
    }));
    if (list.length === 0) return undefined;
    return dimId(list as Parameters<typeof dimId>[0]) ?? "1";
  }

  /** Base-dimension exponents summed across the expression; undefined when
   * a unit has no decomposition path (legality then defers to conversion)
   * or when an exponent is not an integer (sqrt(m) is Length^(1/2): see
   * exactDimensionVector; Ruby's integer truncation is not reproduced). */
  dimensionVector(): Map<string, number> | undefined {
    const exact = this.exactDimensionVector();
    if (exact === undefined) return undefined;
    const vector = new Map<string, number>();
    for (const [dimension, exponent] of exact) {
      if (!exponent.isInteger()) return undefined;
      vector.set(dimension, Number(exponent.toInteger()));
    }
    return vector;
  }

  /** The exact base-dimension exponents (rational for roots and fractional
   * powers); zero exponents are dropped. undefined when a unit has no
   * decomposition path. The dimension gates and equals compare this. */
  exactDimensionVector(): Map<string, Rational> | undefined {
    const list = this.rawDimensionList();
    if (list === undefined) return undefined;
    const vector = new Map<string, Rational>();
    for (const entry of list) {
      vector.set(entry.dimension, (vector.get(entry.dimension) ?? Rational.from(0)).add(entry.exponent));
    }
    for (const [dimension, exponent] of vector) if (exponent.isZero()) vector.delete(dimension);
    return vector;
  }

  /** R-A4: sums are legal on ratio and interval scales; only the dimension
   * must match. An operand in another unit is converted into this unit
   * first (1 km + 1 m is 1001/1000 km, not Ruby's unchecked 2 km). The sum
   * of two differences is a difference; adding a difference to an absolute
   * value leaves it absolute. */
  plus(other: Quantity): Quantity {
    quantityKind(other);
    this.gateKind(other);
    this.gateDimension(other);
    const scale = this.scale === "difference" && other.scale === "difference" ? "difference" : undefined;
    return new Quantity(this.value.add(this.alignedValue(other)), copyFormula(this.formula), scale, this.kind ?? other.kind);
  }

  /** A difference is difference-typed: 20 degC - 15 degC converts to 5 K.
   * Subtracting a difference from an absolute value leaves it absolute
   * (20 degC - 5 K of difference is 15 degC, converting to 288.15 K). The
   * operand is converted into this unit first, as for plus. */
  minus(other: Quantity): Quantity {
    quantityKind(other);
    this.gateKind(other);
    this.gateDimension(other);
    const scale = other.scale === "difference" && this.scale !== "difference" ? undefined : "difference";
    return new Quantity(this.value.sub(this.alignedValue(other)), copyFormula(this.formula), scale, this.kind ?? other.kind);
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
      return new Quantity(this.value.div(divisor), copyFormula(this.formula), this.scale, this.kind);
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
    return new Quantity(this.value.mul(Rational.from(number)), copyFormula(this.formula), this.scale, this.kind);
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
    return new Quantity(converted, targetFormula, this.scale === "difference" ? "difference" : undefined, this.kind);
  }

  /** Equal magnitude and dimension vector, and compatible kinds (Ruby
   * Quantity#==). */
  equals(other: Quantity): boolean {
    if (!this.value.equals(other.value)) return false;
    if (!this.kindsCompatible(other)) return false;
    const mine = this.exactDimensionVector();
    const theirs = other.exactDimensionVector();
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

  private rawDimensionList(): Array<{ dimension: string; exponent: Rational }> | undefined {
    if (!this.formula) return [];
    // The canonical decomposition carries every unit power exactly through
    // derived units (Hz^(1/2) is Time^(-1/2)); the symbol-table path Ruby
    // uses drops powers on derived units and truncates fractional ones, so
    // it only answers when no canonical path exists.
    const canonical = dimensionEntries(this.formula);
    if (canonical !== undefined) {
      return canonical.map((entry) => ({ dimension: entry.dimension, exponent: entry.exponent }));
    }
    if (opaqueRoot(this.formula.value)) return undefined;
    const legacy = units2dimensions(extractUnits(this.formula.value));
    return legacy?.map((entry) => ({
      dimension: entry.dimension as string,
      exponent: exactExponent(entry.exponent),
    }));
  }

  /** The other operand's magnitude in this quantity's unit: unchanged for
   * the same normalized unit, otherwise an exact conversion keeping the
   * operand's own scale typing (a ConversionError when no path exists). */
  private alignedValue(other: Quantity): Rational {
    if (this.formula === undefined || other.formula === undefined) return other.value;
    if (this.formula.normText === other.formula.normText) return other.value;
    return other.convertToFormula(this.formula).value;
  }

  /** Ruby quantity_kind!: both typed operands must be the same quantity or
   * share a declared equivalence class. */
  private gateKind(other: Quantity): void {
    if (this.kindsCompatible(other)) return;
    throw new QuantityKindMismatchError(
      `${this.kind!.id} (${this.kind!.name}) and ${other.kind!.id} (${other.kind!.name}) are not ` +
        "interchangeable: no shared equivalence class",
    );
  }

  /** Both typed: same quantity or same declared equivalence class. An
   * untyped operand keeps the dimension-only gating. */
  private kindsCompatible(other: Quantity): boolean {
    return this.kind === undefined || other.kind === undefined || this.kind.compatible(other.kind);
  }

  private resolveKind(source: QuantityKindSource | undefined): QuantityKind | undefined {
    if (source === undefined || source === null) return undefined;
    let resolved: QuantityKind;
    if (source === QuantityKind.PRIMARY) {
      const primary = this.primaryKind();
      if (!primary) {
        throw new UnknownQuantityKindError(
          `${JSON.stringify(this.normText)} names no single unit with a primary quantity`,
        );
      }
      resolved = primary;
    } else {
      resolved = QuantityKind.resolve(source);
    }
    const ours = this.dimensionId();
    const theirs = resolved.dimensionId;
    if (ours !== undefined && theirs !== undefined && ours !== theirs) {
      throw new DimensionMismatchError(
        `quantity kind ${resolved.id} has dimension ${theirs}, the unit ${JSON.stringify(this.normText)} has ${ours}`,
      );
    }
    return resolved;
  }

  /** The UnitsDB record of a formula that is one unit at power 1 (a prefix
   * is allowed: km is still a length unit). */
  private singleUnitRecord(): unknown {
    if (!this.formula) return undefined;
    const terms = this.formula.value.filter((term) => !(term instanceof Extender));
    if (terms.length !== 1 || !(terms[0] instanceof Unit)) return undefined;
    const unit = terms[0];
    const power = unit.powerNumerator;
    if (power !== undefined && power !== null) {
      const text = typeof power === "number" ? String(power) : String(power.rawValue);
      if (text !== "1") return undefined;
    }
    return unit.instance;
  }

  /** The exact dimension vector, or, for a unit without a decomposition
   * path, the dimensions an active caller register declares for it. A
   * register makes such a unit convertible, so it must also make it
   * dimension-checked: otherwise 2 cwt (US) + 3 m would succeed. */
  private gatingVector(): Map<string, Rational> | undefined {
    const vector = this.exactDimensionVector();
    if (vector !== undefined) return vector;
    const record = this.singleUnitRecord();
    if (!record) return undefined;
    return currentRegister()?.entryFor(record)?.vector;
  }

  private gateDimension(other: Quantity): void {
    const mine = this.gatingVector();
    const theirs = other.gatingVector();
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

/** The exact value of a unit power (Number "0.5", fenced "(1/2)", a plain
 * number): Ruby truncates it with to_i, which makes sqrt(m) dimensionless
 * and m^(1/2) a length; the algebra keeps the rational. */
function exactExponent(exponent: unknown): Rational {
  if (typeof exponent === "number") return Rational.from(exponent);
  if (exponent instanceof Number_ || exponent instanceof Fenced) {
    let text = String(exponent.rawValue).trim();
    while (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1).trim();
    return Rational.parse(text);
  }
  return Rational.from(1);
}

function sameVector(a: Map<string, Rational>, b: Map<string, Rational>): boolean {
  if (a.size !== b.size) return false;
  for (const [dimension, exponent] of a) {
    const other = b.get(dimension);
    if (other === undefined || !other.equals(exponent)) return false;
  }
  return true;
}

function formatVector(vector: Map<string, Rational>): string {
  return `{${[...vector].map(([k, v]) => `${JSON.stringify(k)} => ${v.toString()}`).join(", ")}}`;
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
