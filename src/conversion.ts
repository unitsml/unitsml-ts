// Canonical unit conversion — the TypeScript port of unitsml-ruby
// Unitsml::Conversion (R-A3) and Unitsml::Conversion::Definition. Reference
// semantics live in unitsml-ruby; the shared unitsml-testsuite
// corpora/conversions vectors gate parity (npm run replay:conversions).
//
// A parsed unit expression reduces to its SI-referenced canonical
// composition using the unitsdb canonical_conversion data (schema 2.1.0+),
// prefix factors and si_derived_bases/root_units chains:
// value_canonical = value * factor + offset. The additive offset exists only
// for affine scales (temperature) and is permitted only when the whole
// expression is that single unit at power 1.
//
// Exact rational arithmetic throughout (BigInt Rational); register decimal
// strings and UnitsML lexical decimals parse exactly.
import { Unitsdb, type PrefixRecord, type UnitRecord } from "unitsdb";
import {
  Dimension,
  Extender,
  Fenced,
  Formula,
  Number_,
  Prefix,
  Sqrt,
  Unit,
  type ModelNode,
  type NumericValue,
} from "./model.js";
import { Rational } from "./rational.js";
import { U2D, snakeCase } from "./utility.js";

/** unitsml-ruby Errors::ConversionError. */
export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionError";
  }
}

/** Ruby String#inspect for the identifiers the messages quote. */
function inspect(value: string | undefined | null): string {
  return value === undefined || value === null ? "nil" : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Conversion definitions (UnitsML 1.0 Conversions)

export type ConversionKind =
  | "Float64ConversionFrom"
  | "SpecialConversionFrom"
  | "WSDLConversionFrom";

/** The lexical attributes of one UnitsML conversion element. Decimal
 * attributes stay strings ("273.15" never becomes a double). */
export interface ConversionModel {
  kind: ConversionKind;
  id?: string;
  initialUnit?: string;
  initialAddend?: string;
  multiplicand?: string;
  divisor?: string;
  finalAddend?: string;
  exact?: boolean;
  /** Every attribute as written, for fields this model does not type. */
  attributes: Record<string, string>;
}

/** XSD defaults of Float64ConversionFrom (a=0, b=1, c=1, d=0). */
const XSD_DEFAULTS = {
  initialAddend: "0",
  multiplicand: "1",
  divisor: "1",
  finalAddend: "0",
} as const;

type LexicalName = keyof typeof XSD_DEFAULTS;

const LEXICAL_ALIASES: Record<string, LexicalName> = {
  initial_addend: "initialAddend",
  initialAddend: "initialAddend",
  multiplicand: "multiplicand",
  divisor: "divisor",
  final_addend: "finalAddend",
  finalAddend: "finalAddend",
};

/** The lexical decimal attribute with the XSD default applied (Ruby
 * Float64ConversionFrom#lexical_decimal; snake_case or XML names). */
export function lexicalDecimal(model: ConversionModel, name: string): string {
  const key = LEXICAL_ALIASES[name];
  if (key === undefined) throw new RangeError(`not a lexical decimal attribute: ${name}`);
  return model[key] ?? XSD_DEFAULTS[key];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, ref: string) => {
    if (ref.startsWith("#x")) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? match;
  });
}

const ELEMENT =
  /<(?:[A-Za-z_][\w.-]*:)?(Float64ConversionFrom|SpecialConversionFrom|WSDLConversionFrom)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Read the first UnitsML conversion element (Float64ConversionFrom,
 * SpecialConversionFrom or WSDLConversionFrom) from an XML fragment — a
 * bare element or one inside Unit/Conversions. */
export function parseConversionXml(xml: string): ConversionModel {
  const element = ELEMENT.exec(xml);
  if (!element) {
    throw new ConversionError("no UnitsML conversion element in the given XML");
  }
  const attributes: Record<string, string> = {};
  for (const match of element[2].matchAll(ATTRIBUTE)) {
    attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? "");
  }
  const exact = attributes["exact"];
  return {
    kind: element[1] as ConversionKind,
    id: attributes["xml:id"] ?? attributes["id"],
    initialUnit: attributes["initialUnit"],
    initialAddend: attributes["initialAddend"],
    multiplicand: attributes["multiplicand"],
    divisor: attributes["divisor"],
    finalAddend: attributes["finalAddend"],
    exact: exact === undefined ? undefined : exact === "true" || exact === "1",
    attributes,
  };
}

/** Executes a UnitsML Float64ConversionFrom linear equation: forward
 * y = d + ((b / c) (x + a)); inverse x = (c / b) (y - d) - a. Exact
 * arithmetic throughout. SpecialConversionFrom and WSDLConversionFrom are
 * refused, never approximated. */
export class ConversionDefinition {
  readonly model: ConversionModel;
  private readonly documentUnits: Record<string, unknown>;

  /** documentUnits: document-local unit ids (without '#') to anything the
   * caller can resolve, consulted for '#frag' initialUnit references before
   * the register. */
  constructor(model: ConversionModel, documentUnits: Record<string, unknown> = {}) {
    if (model.kind !== "Float64ConversionFrom") {
      throw new ConversionError(
        `ConversionDefinition needs a Float64ConversionFrom, got ${model.kind}`,
      );
    }
    this.model = model;
    this.documentUnits = documentUnits ?? {};
  }

  /** Ruby Definition.from_model: refuses non-linear and remote kinds. */
  static fromModel(
    model: ConversionModel,
    documentUnits: Record<string, unknown> = {},
  ): ConversionDefinition {
    switch (model.kind) {
      case "Float64ConversionFrom":
        return new ConversionDefinition(model, documentUnits);
      case "SpecialConversionFrom":
        throw new ConversionError(
          `SpecialConversionFrom ${inspect(model.id)} is not executable: ` +
            "non-linear conversions have no linear approximation",
        );
      case "WSDLConversionFrom":
        throw new ConversionError(
          `WSDLConversionFrom ${inspect(model.id)} is not executable: ` +
            "remote conversions are not evaluated",
        );
      default:
        throw new ConversionError(`unknown conversion definition ${String((model as ConversionModel).kind)}`);
    }
  }

  static fromXml(xml: string, documentUnits: Record<string, unknown> = {}): ConversionDefinition {
    return ConversionDefinition.fromModel(parseConversionXml(xml), documentUnits);
  }

  get exact(): boolean {
    return this.model.exact === true;
  }

  private get a(): Rational { return Rational.parse(lexicalDecimal(this.model, "initialAddend")); }
  private get b(): Rational { return Rational.parse(lexicalDecimal(this.model, "multiplicand")); }
  private get c(): Rational { return Rational.parse(lexicalDecimal(this.model, "divisor")); }
  private get d(): Rational { return Rational.parse(lexicalDecimal(this.model, "finalAddend")); }

  /** The linear coefficients [a, b, c, d] as exact rationals. */
  coefficients(): [Rational, Rational, Rational, Rational] {
    return [this.a, this.b, this.c, this.d];
  }

  /** Initial unit value → this unit: y = d + ((b / c) (x + a)). */
  forward(value: Rational | string | number | bigint): Rational {
    const x = Rational.from(value);
    return this.d.add(this.b.div(this.c).mul(x.add(this.a)));
  }

  /** This unit → initial unit value: x = (c / b) (y - d) - a. */
  inverse(value: Rational | string | number | bigint): Rational {
    const y = Rational.from(value);
    return this.c.div(this.b).mul(y.sub(this.d)).sub(this.a);
  }

  /** The '#fragment' without its '#', or the URI as given. */
  get initialUnitId(): string {
    const uri = this.model.initialUnit ?? "";
    return uri.startsWith("#") ? uri.slice(1) : uri;
  }

  /** The initial unit's register record. Fragment (and IRDI/URI-reference)
   * forms resolve through their fragment, plain http(s) URIs through the
   * register's external-reference index. */
  initialUnitRecord(): UnitRecord {
    const uri = this.model.initialUnit ?? "";
    let record: UnitRecord | undefined;
    if (uri.includes("#")) {
      record = Unitsdb.findUnitById(uri.slice(uri.indexOf("#") + 1));
    } else if (uri.startsWith("http")) {
      record = findUnitByReferenceUri(uri);
    } else {
      record = Unitsdb.findUnitById(uri);
    }
    if (record) return record;
    throw new ConversionError(
      `unresolvable initialUnit ${inspect(uri)}: not found in the register`,
    );
  }

  /** Document-local units first, then the register; unresolvable is a
   * ConversionError naming the URI. */
  resolveInitialUnit(): unknown {
    const uri = this.model.initialUnit ?? "";
    if (uri.startsWith("#")) {
      const fragment = this.initialUnitId;
      if (Object.prototype.hasOwnProperty.call(this.documentUnits, fragment)) {
        return this.documentUnits[fragment];
      }
    }
    return this.initialUnitRecord();
  }
}

function findUnitByReferenceUri(uri: string): UnitRecord | undefined {
  const finder = (Unitsdb as { findUnitByReferenceUri?: (uri: string) => UnitRecord | undefined })
    .findUnitByReferenceUri;
  if (finder) return finder(uri);
  // unitsdb packages before the reference projection carry no references.
  return Unitsdb.units.find((unit) =>
    ((unit as { references?: Array<{ uri: string }> | null }).references ?? []).some(
      (reference) => reference.uri === uri,
    ),
  );
}

// ---------------------------------------------------------------------------
// Canonical reduction

/** factor/offset of an expression's canonical SI-referenced composition. */
export interface ConversionResult {
  factor: Rational;
  offset: Rational;
}

/** Unit identifiers or symbols → definitions replacing that unit's
 * canonical data. Models are wrapped with ConversionDefinition.fromModel. */
export type Definitions = Record<string, ConversionDefinition | ConversionModel>;

interface CanonicalConversionData {
  factor: string;
  offset?: string;
  root_units?: Array<{ power?: number | null; unit_reference: { id: string } }>;
}
interface ChainEntry {
  power?: number | string | null;
  unit_reference: { id: string };
  prefix_reference?: { id: string } | null;
}
/** The unit record fields conversion reads. Declared here rather than
 * taken from UnitRecord so that unitsdb releases with and without the
 * schema 2.2.0 projection both type-check; absent data is a typed
 * ConversionError at use, never a silent default. */
interface ConversionRecord {
  identifiers?: Array<{ type: string; id: string }>;
  symbols?: Array<{ id?: string }>;
  unit_system_reference?: Array<{ id: string }>;
  si_derived_bases?: ChainEntry[] | null;
  canonical_conversion?: CanonicalConversionData;
  root_units?: ChainEntry[] | null;
}
function conversionRecord(record: UnitRecord | undefined): ConversionRecord | undefined {
  return record as unknown as ConversionRecord | undefined;
}

const ONE = Rational.ONE;
const ZERO = Rational.ZERO;

function result(factor: Rational, offset: Rational = ZERO): ConversionResult {
  return { factor, offset };
}

/** Reduce a parsed expression to its canonical factor/offset. definitions
 * replace the canonical data of their unit (never applied in sequence);
 * where the register also has canonical data the two must agree. */
export function toCanonical(formula: ModelNode, definitions?: Definitions): ConversionResult {
  return walk(formula, definitions);
}

function walk(node: ModelNode | undefined, definitions?: Definitions): ConversionResult {
  if (node instanceof Formula) {
    // The parser already normalizes "/" and "//" by inverting the following
    // exponents, so the tree walks multiplicatively.
    return node.value.reduce<ConversionResult>(
      (acc, part) => (part instanceof Extender ? acc : merge(acc, walk(part, definitions))),
      result(ONE),
    );
  }
  if (node instanceof Fenced) return walk(node.value, definitions);
  if (node instanceof Sqrt) {
    const sub = walk(node.value, definitions);
    return result(sqrtRational(sub.factor), sub.offset);
  }
  if (node instanceof Unit) return unitResult(node, definitions);
  if (
    node instanceof Extender ||
    node instanceof Dimension ||
    node instanceof Number_ ||
    node instanceof Prefix
  ) {
    return result(ONE);
  }
  throw new ConversionError(
    `cannot convert ${node === undefined ? "NilClass" : (node as object).constructor.name} node`,
  );
}

function merge(left: ConversionResult, right: ConversionResult): ConversionResult {
  if (
    (!left.offset.isZero() && !right.factor.equals(ONE)) ||
    (!right.offset.isZero() && !left.factor.equals(ONE))
  ) {
    throw new ConversionError("affine unit inside a composite expression");
  }
  return result(left.factor.mul(right.factor), left.offset.add(right.offset));
}

/** base ** exponent, exact. Integer exponents always; a half-integer
 * exponent only when the root is rational (as for Sqrt nodes). */
function powExact(base: Rational, exponent: Rational): Rational {
  if (exponent.isInteger()) return base.pow(exponent.numerator);
  if (exponent.denominator === 2n) {
    const root = base.sqrt();
    if (root) return root.pow(exponent.numerator);
  }
  throw new ConversionError(
    `${base.toRubyString()} raised to ${exponent.toRubyString()} is not rational`,
  );
}

function nodePower(numerator: NumericValue | number | undefined): Rational {
  if (numerator === undefined || numerator === null) return ONE;
  if (typeof numerator === "number") return Rational.from(numerator);
  return Rational.parse(String(numerator.rawValue));
}

function prefixFactor(prefix: Prefix | PrefixRecord | undefined): Rational {
  if (prefix === undefined) return ONE;
  const base = prefix.base;
  const power = prefix.power;
  if (base === undefined || power === undefined) {
    throw new ConversionError(
      `unknown prefix ${inspect(prefix instanceof Prefix ? prefix.prefixName : undefined)}`,
    );
  }
  return Rational.from(base).pow(power);
}

function unitResult(unit: Unit, definitions?: Definitions): ConversionResult {
  const prefix = unit.prefix ? prefixFactor(unit.prefix) : ONE;
  const power = nodePower(unit.powerNumerator);
  const record = conversionRecord(unit.instance);
  if (!record) throw new ConversionError(`unknown unit ${inspect(unit.unitName)}`);

  // A supplied definition replaces the canonical factor/offset for its unit.
  const definition = definitionFor(record, definitions);
  if (definition) {
    const [factor, offset] = definitionResult(definition, power, record);
    return result(factor.mul(powExact(prefix, power)), offset);
  }

  // The prefix scales with the unit power: 1 km2 = 1 000 000 m2.
  const [factor, offset] = recordFactor(record, power);
  return result(factor.mul(powExact(prefix, power)), offset);
}

function definitionFor(
  record: ConversionRecord,
  definitions?: Definitions,
): ConversionDefinition | undefined {
  if (!definitions) return undefined;
  const keys = [
    ...(record.identifiers ?? []).map((identifier) => identifier.id),
    ...(record.symbols ?? []).map((symbol) => symbol.id),
  ];
  for (const key of keys) {
    if (key === undefined || !Object.prototype.hasOwnProperty.call(definitions, key)) continue;
    const entry = definitions[key];
    return entry instanceof ConversionDefinition ? entry : ConversionDefinition.fromModel(entry);
  }
  return undefined;
}

/** The definition as a canonical Result for the unit carrying it:
 * value_SI = f_i((c / b)^p value - d) - f_i a + o_i over the initial unit's
 * canonical (f_i, o_i). Affine definitions are legal only at power 1. */
function definitionResult(
  definition: ConversionDefinition,
  power: Rational,
  record: ConversionRecord,
): [Rational, Rational] {
  const [a, b, c, d] = definition.coefficients();
  if ((!a.isZero() || !d.isZero()) && !power.equals(ONE)) {
    throw new ConversionError(`affine unit raised to power ${power.toRubyString()}`);
  }
  const ratio = c.div(b);
  const factor = powExact(ratio, power);
  const offset = a.isZero() && d.isZero() ? ZERO : ratio.neg().mul(d).sub(a);
  const initial = conversionRecord(definition.initialUnitRecord())!;
  const [initialFactor, initialOffset] = recordFactor(initial, ONE);
  const computed: [Rational, Rational] = [
    initialFactor.mul(factor),
    initialOffset.mul(factor).add(offset),
  ];
  agree(record, definition, power, computed);
  return computed;
}

/** A definition and the register's canonical data for the same unit must
 * agree (at the same power) within the importer's 1e-9 relative tolerance;
 * disagreement is a diagnostic, not a silent choice. */
function agree(
  record: ConversionRecord,
  definition: ConversionDefinition,
  power: Rational,
  computed: [Rational, Rational],
): void {
  if (!record.canonical_conversion) return;
  const [factor, offset] = recordFactor(record, power);
  const tolerance = new Rational(10n ** 9n);
  const agreed = [factor, offset].every((ours, index) => {
    const delta = ours.sub(computed[index]).abs();
    return delta.isZero() || delta.compare(ours.abs().div(tolerance)) <= 0;
  });
  if (agreed) return;
  throw new ConversionError(
    `conversion definition ${inspect(definition.model.id)} disagrees with canonical data for ` +
      `${inspect(record.symbols?.[0]?.id)}: canonical (${factor.toRubyString()}, ` +
      `${offset.toRubyString()}) vs definition (${computed[0].toRubyString()}, ` +
      `${computed[1].toRubyString()})`,
  );
}

/** [factor, offset] for one unit record at the given power. */
function recordFactor(record: ConversionRecord, power: Rational): [Rational, Rational] {
  const cc = record.canonical_conversion;
  if (cc) return conversionFactor(cc, power);

  let bases: ChainEntry[] | null | undefined = record.si_derived_bases;
  if (!bases || bases.length === 0) bases = record.root_units;
  if (!bases || bases.length === 0) {
    const system = record.unit_system_reference?.[0]?.id ?? "";
    if (snakeCase(system) === "si_base") return [ONE, ZERO];
    throw new ConversionError(
      `no canonical conversion path for ${inspect(record.symbols?.[0]?.id)}`,
    );
  }

  let factor = ONE;
  for (const base of bases) {
    const basePower = Rational.from(base.power ?? 1).mul(power);
    const prefix = prefixFactorFromReference(base.prefix_reference);
    const [subFactor, subOffset] = baseFactor(base.unit_reference, basePower);
    if (!subOffset.isZero()) {
      throw new ConversionError("affine unit inside a derived composition");
    }
    factor = factor.mul(powExact(prefix, basePower)).mul(subFactor);
  }
  return [factor, ZERO];
}

function conversionFactor(cc: CanonicalConversionData, power: Rational): [Rational, Rational] {
  if (cc.offset && cc.offset !== "0" && !power.equals(ONE)) {
    throw new ConversionError(`affine unit raised to power ${power.toRubyString()}`);
  }
  return [powExact(Rational.parse(cc.factor), power), Rational.parse(cc.offset ?? "0")];
}

function baseFactor(reference: { id: string }, power: Rational): [Rational, Rational] {
  const record = conversionRecord(Unitsdb.findUnitById(reference.id));
  if (!record) throw new ConversionError("unknown conversion target");
  return recordFactor(record, power);
}

function prefixFactorFromReference(reference: { id: string } | null | undefined): Rational {
  if (!reference) return ONE;
  const record = Unitsdb.findPrefixById(reference.id);
  if (!record || record.base === undefined || record.power === undefined) return ONE;
  return Rational.from(record.base).pow(record.power);
}

function sqrtRational(value: Rational): Rational {
  const root = value.sqrt();
  if (root) return root;
  throw new ConversionError(`square root of ${value.toRubyString()} is not rational`);
}

// ---------------------------------------------------------------------------
// Dimension decomposition from canonical data

export interface CanonicalDimensionEntry {
  dimension: string;
  symbol: string;
  exponent: Rational;
}

/** Dimension-only decomposition through canonical data (Ruby
 * Conversion.dimension_entries); undefined when any unit has no path. */
export function dimensionEntries(formula: Formula): CanonicalDimensionEntry[] | undefined {
  const entries: CanonicalDimensionEntry[] = [];
  for (const unit of collectUnits(formula.value)) {
    const dims = unitDimensions(
      conversionRecord(unit.instance),
      nodePower(unit.powerNumerator),
      [],
    );
    if (dims === undefined) return undefined;
    entries.push(...dims);
  }
  const summed = new Map<string, CanonicalDimensionEntry>();
  for (const entry of entries) {
    const existing = summed.get(entry.dimension);
    if (existing) existing.exponent = existing.exponent.add(entry.exponent);
    else summed.set(entry.dimension, { ...entry });
  }
  return [...summed.values()];
}

function collectUnits(value: ModelNode[]): Unit[] {
  return value.flatMap((node) => {
    if (node instanceof Unit) return [node];
    if (node instanceof Formula) return collectUnits(node.value);
    if (node instanceof Fenced) return collectUnits([node.value]);
    if (node instanceof Sqrt) return node.value instanceof Unit ? [node.value] : [];
    return [];
  });
}

function unitDimensions(
  record: ConversionRecord | undefined,
  power: Rational,
  visited: ConversionRecord[],
): CanonicalDimensionEntry[] | undefined {
  if (record === undefined || visited.includes(record)) return undefined;
  const seen = [...visited, record];
  const symbol = record.symbols?.[0]?.id;
  const u2d = symbol === undefined ? undefined : U2D[symbol];
  if (u2d) return [{ dimension: u2d.dimension, symbol: u2d.symbol, exponent: power }];

  const chains: Array<{ power?: number | string | null; unit_reference: { id: string } }> | null | undefined =
    record.canonical_conversion
      ? record.canonical_conversion.root_units ?? []
      : record.si_derived_bases && record.si_derived_bases.length > 0
        ? record.si_derived_bases
        : record.root_units;
  if (!record.canonical_conversion && (!chains || chains.length === 0)) return undefined;

  const dims: CanonicalDimensionEntry[] = [];
  for (const base of chains ?? []) {
    const target = conversionRecord(Unitsdb.findUnitById(base.unit_reference.id));
    const sub = unitDimensions(target, Rational.from(base.power ?? 1).mul(power), seen);
    if (sub === undefined) return undefined;
    dims.push(...sub);
  }
  return dims;
}
