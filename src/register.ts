// A validated caller register (unitsml-ruby Unitsml::Conversion::Register):
// per-unit factors (and affine offsets) to the canonical SI composition,
// supplied by the caller rather than read from UnitsDB. WORK-PACKAGES F02:
// "Use data or validated caller registers for factors/addends; preserve
// exact arithmetic and source provenance."
//
// Entry: { unit: id or symbol, factor: exact decimal/rational String,
// offset?: exact String, dimensions: { base dimension name: exponent } }.
// Semantics match the UnitsDB canonical_conversion: value_SI = value *
// factor + offset.
//
// Validation fails explicitly (InvalidUnitRegisterError): unknown fields,
// non-String or non-exact numbers, a factor that is not positive, declared
// dimensions that differ from the unit's own, and an entry that disagrees
// with the register's canonical_conversion for the same unit (the 1e-9
// relative tolerance conversion definitions use). An unknown unit is an
// UnknownUnitError. A later entry for the same unit replaces an earlier
// one. A register applies only inside withRegister; it never persists.
import { Unitsdb, type UnitRecord } from "unitsdb";
import { ConversionError } from "./conversion.js";
import { QuantityKind } from "./quantity-kind.js";
import { Rational } from "./rational.js";
import { swapRegister, type ActiveRegister, type RegisterEntry } from "./register-scope.js";
import { DIMS_VECTOR } from "./utility.js";

/** unitsml-ruby Errors::InvalidUnitRegisterError (a ConversionError). */
export class InvalidUnitRegisterError extends ConversionError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUnitRegisterError";
  }
}

/** unitsml-ruby Errors::UnknownUnitError. */
export class UnknownUnitError extends Error {
  constructor(readonly value: unknown) {
    super(`[unitsml] Unknown unit reference: ${JSON.stringify(value)} — expected a unit symbol id (e.g. "W").`);
    this.name = "UnknownUnitError";
  }
}

const FIELDS = ["unit", "factor", "offset", "dimensions"];
const EXACT = /^[+-]?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\d+\/\d+)$/;
const TOLERANCE = new Rational(10n ** 9n);

interface RegisterRecord {
  identifiers?: Array<{ type: string; id: string }>;
  symbols?: Array<{ id?: string }>;
  quantity_references?: Array<{ id: string; primary?: boolean | null }> | null;
  canonical_conversion?: { factor: string; offset?: string | null } | null;
}

export interface UnitRegisterEntryInput {
  unit: string;
  factor: string;
  offset?: string;
  dimensions: Record<string, string | number>;
}

class Entry implements RegisterEntry {
  constructor(
    readonly record: RegisterRecord,
    readonly factor: Rational,
    readonly offset: Rational,
    readonly vector: Map<string, Rational>,
  ) {}
}

export class Register implements ActiveRegister {
  private readonly entries = new Map<string, Entry>();

  constructor(entries: unknown) {
    if (!Array.isArray(entries)) {
      throw new InvalidUnitRegisterError(`a register is an Array of entries, got ${typeName(entries)}`);
    }
    for (const raw of entries) {
      const entry = buildEntry(raw);
      this.entries.set(identity(entry.record), entry);
    }
  }

  entryFor(record: unknown): Entry | undefined {
    if (!record || typeof record !== "object") return undefined;
    return this.entries.get(identity(record as RegisterRecord));
  }

  get empty(): boolean {
    return this.entries.size === 0;
  }
}

/** Applies a validated caller register (a Register, or the Array of
 * entries it validates) to every conversion inside fn, including the
 * operand alignment of Quantity#plus and #minus. The scope is the
 * synchronous extent of fn; it never persists. An async fn is refused: the
 * register would leak into unrelated work across awaits. */
export function withRegister<T>(register: Register | unknown, fn: (register: Register) => T): T {
  const active = register instanceof Register ? register : new Register(register);
  const previous = swapRegister(active);
  try {
    const out = fn(active);
    if (out && typeof (out as { then?: unknown }).then === "function") {
      throw new TypeError("withRegister needs a synchronous callback; the register scope cannot span awaits");
    }
    return out;
  } finally {
    swapRegister(previous);
  }
}

function typeName(value: unknown): string {
  if (value === null || value === undefined) return "NilClass";
  if (Array.isArray(value)) return "Array";
  if (typeof value === "object") return "Hash";
  return typeof value;
}

function identity(record: RegisterRecord): string {
  return (record.identifiers ?? [])
    .map((identifier) => `${identifier.type}:${identifier.id}`)
    .sort()
    .join("|");
}

function buildEntry(raw: unknown): Entry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidUnitRegisterError(`a register entry is a Hash, got ${typeName(raw)}`);
  }
  const fields = raw as Record<string, unknown>;
  const extra = Object.keys(fields).filter((key) => !FIELDS.includes(key)).sort();
  if (extra.length > 0) {
    throw new InvalidUnitRegisterError(`unknown register entry field(s) ${JSON.stringify(extra)}`);
  }
  const record = resolveUnit(fields.unit);
  const factor = exact(fields.factor, "factor");
  if (factor.compare(Rational.ZERO) <= 0) {
    throw new InvalidUnitRegisterError(`register factor must be positive, got ${String(fields.factor)}`);
  }
  const offset = "offset" in fields ? exact(fields.offset, "offset") : Rational.ZERO;
  const vector = checkDimensions(record, fields.dimensions);
  checkCanonical(record, factor, offset);
  return new Entry(record, factor, offset, vector);
}

function resolveUnit(name: unknown): RegisterRecord {
  if (typeof name !== "string" || name.trim() === "") {
    throw new InvalidUnitRegisterError("register unit must be a non-empty String");
  }
  const record = (Unitsdb.findUnitById(name) ?? Unitsdb.findUnitByName(name)) as UnitRecord | undefined;
  if (record) return record as unknown as RegisterRecord;
  throw new UnknownUnitError(name);
}

function exact(value: unknown, field: string): Rational {
  if (typeof value !== "string" || !EXACT.test(value)) {
    throw new InvalidUnitRegisterError(
      `register ${field} must be an exact decimal or rational String, got ${JSON.stringify(value) ?? String(value)}`,
    );
  }
  return Rational.parse(value);
}

/** The declared dimensions must name the unit's own UnitsDB dimension: both
 * resolve to a dimension identity (by vector, and through the unit's
 * primary quantity), so no expression is reparsed. */
function checkDimensions(record: RegisterRecord, declared: unknown): Map<string, Rational> {
  if (!declared || typeof declared !== "object" || Array.isArray(declared) || Object.keys(declared).length === 0) {
    throw new InvalidUnitRegisterError("register dimensions must be a non-empty Hash");
  }
  const list: Array<{ dimension: string; exponent: Rational }> = [];
  for (const [name, exponent] of Object.entries(declared as Record<string, unknown>)) {
    const value = exact(String(exponent), "dimension exponent");
    if (value.isZero()) continue;
    if (!value.isInteger()) {
      throw new InvalidUnitRegisterError("register dimension exponents must be integers");
    }
    list.push({ dimension: name, exponent: value });
  }
  const wanted = registeredDimensionId(list);
  const actual = QuantityKind.primaryFor(record)?.dimensionId;
  if (actual !== undefined && wanted === actual) {
    return new Map(list.map((entry) => [entry.dimension, entry.exponent]));
  }
  throw new InvalidUnitRegisterError(
    `register dimensions ${JSON.stringify(declared)} (${JSON.stringify(wanted ?? null)}) ` +
      `differ from the unit's dimension ${JSON.stringify(actual ?? null)}`,
  );
}

/** Only dimensions the register itself names; an unnamed vector has no
 * identity to compare and is refused. */
function registeredDimensionId(list: Array<{ dimension: string; exponent: Rational }>): string | undefined {
  const vector = DIMS_VECTOR.map((name) => {
    const found = list.find((entry) => entry.dimension === name);
    return found ? found.exponent.toInteger().toString() : "";
  }).join(":");
  return Unitsdb.findDimensionByVector(vector)?.id ?? undefined;
}

function checkCanonical(record: RegisterRecord, factor: Rational, offset: Rational): void {
  const cc = record.canonical_conversion;
  if (!cc) return;
  const canonical = [Rational.parse(cc.factor), Rational.parse(cc.offset ?? "0")];
  const agreed = canonical.every((ours, index) => {
    const delta = ours.sub([factor, offset][index]).abs();
    return delta.isZero() || delta.compare(ours.abs().div(TOLERANCE)) <= 0;
  });
  if (agreed) return;
  throw new InvalidUnitRegisterError(
    `register entry (${factor.toRubyString()}, ${offset.toRubyString()}) disagrees with the canonical ` +
      `conversion (${canonical[0].toRubyString()}, ${canonical[1].toRubyString()}) for ` +
      `${JSON.stringify(record.symbols?.[0]?.id ?? null)}`,
  );
}
