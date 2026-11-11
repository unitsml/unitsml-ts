// Data-declared quantity kinds: one UnitsDB quantity record (unitsml-ruby
// Unitsml::QuantityKind, F40 feature "data-declared kind compatibility").
//
// Kind compatibility comes from the register, never from code: the
// quantities schema's equivalence_class is "L1 equivalence class:
// quantities in the same class are interchangeable for addition/subtraction
// arithmetic (work, energy and heat share the energy class). Absent means
// identity-only gating." (unitsdb schemas/quantities-schema.yaml:47-49). So
// work + heat is legal while torque + energy is refused although both have
// dimension L2MT-2.
import { Unitsdb } from "unitsdb";

/** unitsml-ruby Errors::QuantityKindMismatchError: data-declared kinds of
 * the same dimension that the register does not make interchangeable. */
export class QuantityKindMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuantityKindMismatchError";
  }
}

/** unitsml-ruby Errors::UnknownQuantityKindError. */
export class UnknownQuantityKindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownQuantityKindError";
  }
}

/** unitsml-ruby Errors::PrimaryQuantityError: a unit record whose quantity
 * references do not identify exactly one primary quantity. */
export class PrimaryQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrimaryQuantityError";
  }
}

/** The quantity record fields kinds read. Declared locally so unitsdb
 * releases with and without the equivalence_class projection type-check. */
interface KindRecord {
  id?: string | null;
  identifiers?: Array<{ type: string; id: string }>;
  names?: Array<{ lang?: string; value: string }>;
  dimension_reference?: { id: string } | null;
  equivalence_class?: string | null;
  short?: string | null;
}

/** The unit record fields primary selection reads. */
export interface PrimaryUnitRecord {
  identifiers?: Array<{ type: string; id: string }>;
  quantity_references?: Array<{ id: string; primary?: boolean | null }> | null;
}

/** Ruby Utility.quantity_instance: a quantity by identifier, else by name. */
function quantityInstance(text: string): KindRecord | undefined {
  if (text.trim() === "") return undefined;
  const byId = Unitsdb.findQuantityById(text) as KindRecord | undefined;
  if (byId) return byId;
  return (Unitsdb.quantities as unknown as KindRecord[]).find((record) =>
    (record.names ?? []).some((name) => name.value === text),
  );
}

export type QuantityKindInput = QuantityKind | string;

export class QuantityKind {
  /** Pass as a Quantity kind to select the primary quantity of the
   * quantity's single unit (Ruby kind: :primary). */
  static readonly PRIMARY: unique symbol = Symbol.for("unitsml.QuantityKind.PRIMARY");

  readonly record: KindRecord;

  constructor(record: KindRecord) {
    this.record = record;
  }

  /** A QuantityKind, or a String quantity identifier or name ("NISTq18",
   * "work"). Anything else, or an unknown String, is an
   * UnknownQuantityKindError. */
  static resolve(kind: unknown): QuantityKind {
    if (kind instanceof QuantityKind) return kind;
    if (typeof kind === "string") {
      const record = quantityInstance(kind);
      if (!record) throw new UnknownQuantityKindError(`unknown quantity kind ${JSON.stringify(kind)}`);
      return new QuantityKind(record);
    }
    const type = kind === null ? "nil" : typeof kind;
    throw new UnknownQuantityKindError(`a quantity kind is a String identifier or name, got ${type}`);
  }

  /** The primary quantity of a UnitsDB unit record. The units schema marks
   * it explicitly: "True for the primary quantity of this unit ... Consumers
   * select this reference instead of positional order." (unitsdb
   * schemas/units-schema.yaml:147-149). Selection reads the flag only, so
   * the result does not depend on the order of quantity_references.
   *
   * A sole reference with the flag ABSENT is the unit's quantity: the
   * schema leaves the field optional, and the release that introduced it
   * flags only multi-reference units ("96 multi-reference units flagged,
   * exactly one primary each", unitsdb 6f3d156, schema 2.2.0). That
   * inference is not stated in the schema text itself. A reference marked
   * primary: false is never promoted, even when it is the only one
   * (unitsml-ruby c4821ee). Several references with no true flag, or more
   * than one, is a register defect and fails explicitly. */
  static primaryFor(unitRecord: PrimaryUnitRecord | undefined | null): QuantityKind | undefined {
    const refs = unitRecord?.quantity_references ?? [];
    if (refs.length === 0) return undefined;
    const flagged = refs.filter((ref) => ref.primary === true);
    let chosen;
    if (flagged.length === 1) {
      chosen = flagged[0];
    } else if (flagged.length === 0) {
      chosen = soleUnflagged(unitRecord!, refs);
    } else {
      throw new PrimaryQuantityError(
        `unit ${unitLabel(unitRecord!)} marks ${flagged.length} quantity references primary`,
      );
    }
    return QuantityKind.resolve(chosen.id);
  }

  get id(): string | undefined {
    const ids = this.record.identifiers ?? [];
    return ids.find((identifier) => identifier.type === "nist")?.id ?? ids[0]?.id ?? this.record.id ?? undefined;
  }

  get name(): string | undefined {
    const names = this.record.names ?? [];
    return names.find((name) => name.lang === "en")?.value ?? names[0]?.value;
  }

  get equivalenceClass(): string | null {
    return this.record.equivalence_class ?? null;
  }

  get dimensionId(): string | undefined {
    return this.record.dimension_reference?.id ?? undefined;
  }

  /** Same quantity, or both in the same declared equivalence class. An
   * absent class means identity-only gating. */
  compatible(other: QuantityKind): boolean {
    if (this.id === other.id) return true;
    return this.equivalenceClass !== null && this.equivalenceClass === other.equivalenceClass;
  }

  equals(other: unknown): boolean {
    return other instanceof QuantityKind && this.id === other.id;
  }

  toString(): string {
    return String(this.id);
  }
}

/** The only reference, taken only when its flag is absent (undefined or
 * null, Ruby nil); an explicit primary: false is never promoted. */
function soleUnflagged(
  unitRecord: PrimaryUnitRecord,
  refs: Array<{ id: string; primary?: boolean | null }>,
): { id: string } {
  if (refs.length > 1) {
    throw new PrimaryQuantityError(
      `unit ${unitLabel(unitRecord)} has ${refs.length} quantity references and none is marked primary`,
    );
  }
  const [sole] = refs;
  if (sole.primary === undefined || sole.primary === null) return sole;
  throw new PrimaryQuantityError(`unit ${unitLabel(unitRecord)} marks its only quantity reference primary: false`);
}

function unitLabel(record: PrimaryUnitRecord): string {
  return JSON.stringify(record.identifiers?.[0]?.id ?? null);
}
