// UnitsDB data access for the unitsml model: finders and record
// accessors over the vendored dataset (built from unitsml/unitsdb
// releases; see data/README in the unitsdb repo for the schema).
import dataset from "./data/unitsdb.json" with { type: "json" };

export interface Identifier {
  type: string;
  id: string;
}
export interface LocalizedString {
  lang: string;
  value: string;
}
export interface UnitSymbol {
  id?: string;
  ascii?: string;
  unicode?: string;
  latex?: string;
  html?: string;
  mathml?: string;
}
export interface DerivedBase {
  unit_reference: { id: string };
  prefix_reference: { id: string } | null;
  power: string | number | null;
}
export interface UnitRecord {
  identifiers?: Identifier[];
  names?: LocalizedString[];
  symbols?: UnitSymbol[];
  unit_system_reference?: Identifier[];
  si_derived_bases?: DerivedBase[];
  dimension_reference?: { id: string } | null;
  quantity_references?: Identifier[];
}
export interface PrefixRecord {
  identifiers?: Identifier[];
  names?: LocalizedString[];
  symbols?: UnitSymbol[];
  base?: number;
  power?: number;
}
export interface DimensionRecord {
  id: string | null;
  [component: string]: unknown;
}
export interface QuantityRecord {
  id: string | null;
  names?: LocalizedString[];
  dimension_reference?: { id: string } | null;
  quantityType?: string;
}

const units = dataset.units as UnitRecord[];
const prefixes = dataset.prefixes as PrefixRecord[];
const dimensions = dataset.dimensions as DimensionRecord[];
const quantities = dataset.quantities as QuantityRecord[];

const unitsBySymbolId = new Map<string, UnitRecord>();
for (const unit of units) {
  for (const symbol of unit.symbols ?? []) {
    if (symbol.id !== undefined && symbol.id !== null) {
      unitsBySymbolId.set(symbol.id, unit);
    }
  }
}
// Ruby find_first_through — FIRST record wins on identifier collisions.
const unitsByIdentifier = new Map<string, UnitRecord>();
for (const unit of units) {
  for (const identifier of unit.identifiers ?? []) {
    if (!unitsByIdentifier.has(identifier.id)) {
      unitsByIdentifier.set(identifier.id, unit);
    }
  }
}
const prefixesBySymbolName = new Map<string, PrefixRecord>();
for (const prefix of prefixes) {
  for (const symbol of prefix.symbols ?? []) {
    if (symbol.ascii) prefixesBySymbolName.set(symbol.ascii, prefix);
  }
}
const prefixesByIdentifier = new Map<string, PrefixRecord>();
for (const prefix of prefixes) {
  for (const identifier of prefix.identifiers ?? []) {
    if (!prefixesByIdentifier.has(identifier.id)) {
      prefixesByIdentifier.set(identifier.id, prefix);
    }
  }
}
const prefixSymbolNames: string[] = [...prefixesBySymbolName.keys()].sort(
  (a, b) => a.length - b.length,
);
const dimensionsById = new Map<string, DimensionRecord>();
for (const dim of dimensions) {
  if (dim.id) dimensionsById.set(dim.id, dim);
}
const quantitiesById = new Map<string, QuantityRecord>();
for (const quantity of quantities) {
  if (quantity.id) quantitiesById.set(quantity.id, quantity);
}
const quantitiesByIdentifier = new Map<string, QuantityRecord>();
for (const quantity of quantities) {
  for (const identifier of (quantity as unknown as { identifiers?: Identifier[] }).identifiers ?? []) {
    if (!quantitiesByIdentifier.has(identifier.id)) {
      quantitiesByIdentifier.set(identifier.id, quantity);
    }
  }
}

export const Unitsdb = {
  units,

  /** unitsml-ruby `Unitsdb.units.find_by_symbol_id` */
  findUnitBySymbolId(symbolId: string): UnitRecord | undefined {
    return unitsBySymbolId.get(symbolId);
  },

  /** unitsml-ruby `Unitsdb.units.find_by_name` (via symbols) */
  findUnitByName(name: string): UnitRecord | undefined {
    return unitsBySymbolId.get(name);
  },

  /** unitsml-ruby `Unitsdb.units.find_by_id` (via identifiers) */
  findUnitById(id: string): UnitRecord | undefined {
    return unitsByIdentifier.get(id);
  },

  prefixes,

  /** unitsml-ruby `Unitsdb.prefixes.find_by_symbol_name` */
  findPrefixBySymbolName(ascii: string): PrefixRecord | undefined {
    return prefixesBySymbolName.get(ascii);
  },

  /** unitsml-ruby `Unitsdb.prefixes.find_by_id` */
  findPrefixById(id: string): PrefixRecord | undefined {
    return prefixesByIdentifier.get(id);
  },

  /** unitsml-ruby `Unitsdb.prefixes_array` (ascii symbols, length-sorted) */
  prefixSymbolNames(): string[] {
    return prefixSymbolNames;
  },

  dimensions,

  findDimensionById(id: string): DimensionRecord | undefined {
    return dimensionsById.get(id);
  },

  /** unitsml-ruby `Unitsdb.dimensions.find_by_vector` (exponent vector) */
  findDimensionByVector(vector: string): DimensionRecord | undefined {
    return dimensions.find((dim) => dimensionVector(dim) === vector);
  },

  quantities,

  findQuantityById(id: string): QuantityRecord | undefined {
    return quantitiesById.get(id) ?? quantitiesByIdentifier.get(id);
  },
};

// DIMS_VECTOR order (unitsml-ruby Utility::DIMS_VECTOR) — the vector
// string fed to unitsdb dimension lookups depends on it.
const DIM_COMPONENT_KEYS = [
  "thermodynamic_temperature",
  "amount_of_substance",
  "luminous_intensity",
  "electric_current",
  "plane_angle",
  "length",
  "mass",
  "time",
];

/** The DIMS_VECTOR-ordered exponent string unitsml-ruby uses for lookups. */
export function dimensionVector(dim: DimensionRecord): string {
  return DIM_COMPONENT_KEYS.map((key) => {
    const component = dim[key] as { power?: unknown } | undefined;
    return component?.power ?? "";
  }).join(":");
}

/** Components in the RECORD's own key order (the unitsdb YAML order,
 * which is what unitsml-ruby's processed_keys preserves). */
export function dimensionComponents(
  dim: DimensionRecord,
): Array<[string, { symbol?: string; power?: unknown }]> {
  return Object.keys(dim)
    .filter((key) => key !== "id" && dim[key] !== undefined)
    .map((key) => [key, dim[key] as { symbol?: string; power?: unknown }]);
}

export function unitNistId(unit: UnitRecord): string | undefined {
  return unit.identifiers?.find((i) => i.type === "nist")?.id;
}

export function unitEnName(unit: UnitRecord): string | undefined {
  return unit.names?.find((n) => n.lang === "en")?.value;
}

export function prefixNistId(prefix: PrefixRecord): string | undefined {
  return prefix.identifiers?.find((i) => i.type === "nist")?.id;
}

export function prefixEnName(prefix: PrefixRecord): string | undefined {
  return prefix.names?.find((n) => n.lang === "en")?.value;
}
