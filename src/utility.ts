// XML assembly — a port of unitsml-ruby's Unitsml::Utility XML methods,
// emitting the UnitsML schema shapes directly (the Ruby side goes
// through lutaml-model; the byte shapes match its serializer output).
import {
  Dimension,
  Extender,
  Fenced,
  Formula,
  Number_,
  Prefix,
  Prefix as UnitsmlPrefix,
  Sqrt,
  Unit,
  type ModelNode,
  type NumericValue,
} from "./model.js";
import {
  Unitsdb,
  unitNistId,
  unitEnName,
  prefixNistId,
  prefixEnName,
  dimensionComponents,
  dimensionVector,
  type UnitRecord,
  type PrefixRecord,
} from "./unitsdb.js";
import { stringToHtmlEntity } from "./mathml.js";

export const U2D: Record<string, { dimension: string; order: number; symbol: string }> = {
  m: { dimension: "Length", order: 1, symbol: "L" },
  g: { dimension: "Mass", order: 2, symbol: "M" },
  kg: { dimension: "Mass", order: 2, symbol: "M" },
  s: { dimension: "Time", order: 3, symbol: "T" },
  A: { dimension: "ElectricCurrent", order: 4, symbol: "I" },
  K: { dimension: "ThermodynamicTemperature", order: 5, symbol: "Theta" },
  degK: { dimension: "ThermodynamicTemperature", order: 5, symbol: "Theta" },
  mol: { dimension: "AmountOfSubstance", order: 6, symbol: "N" },
  cd: { dimension: "LuminousIntensity", order: 7, symbol: "J" },
  deg: { dimension: "PlaneAngle", order: 8, symbol: "phi" },
};

export const DIM2D: Record<string, { dimension: string; order: number; symbol: string }> = {
  dim_L: U2D["m"],
  dim_M: U2D["g"],
  dim_T: U2D["s"],
  dim_I: U2D["A"],
  dim_Theta: U2D["K"],
  dim_N: U2D["mol"],
  dim_J: U2D["cd"],
  dim_phi: U2D["deg"],
};

export const DIMS_VECTOR = [
  "ThermodynamicTemperature",
  "AmountOfSubstance",
  "LuminousIntensity",
  "ElectricCurrent",
  "PlaneAngle",
  "Length",
  "Mass",
  "Time",
];

export const UNKNOWN = "unknown";

const UNITSML_NS = "https://schema.unitsml.org/unitsml/1.0";

const COMPONENT_ELEMENTS: Record<string, string> = {
  length: "Length",
  mass: "Mass",
  time: "Time",
  electric_current: "ElectricCurrent",
  thermodynamic_temperature: "ThermodynamicTemperature",
  amount_of_substance: "AmountOfSubstance",
  luminous_intensity: "LuminousIntensity",
  plane_angle: "PlaneAngle",
};

export interface UnitEntry {
  prefix?: Prefix | PrefixRecord | string | null;
  unit: Unit;
}

interface DimensionEntry {
  dimension?: string;
  unit: string;
  exponent: NumericValue | number;
  symbol?: string;
}

export function unitInstance(unit: string): UnitRecord | undefined {
  return Unitsdb.findUnitBySymbolId(unit);
}

export function units2dimensions(units: Unit[]): DimensionEntry[] | undefined {
  const norm = decomposeUnitsList(units);
  if (norm.some((u) => u.unit.unknownName || prefixNameOf(u.prefix) === UNKNOWN)) {
    return undefined;
  }
  return (norm as unknown as Array<{ unit: { unitName: string; powerNumerator?: NumericValue } }>)
    .map((u) => ({
      dimension: U2D[u.unit.unitName]?.dimension,
      unit: u.unit.unitName,
      exponent: u.unit.powerNumerator ?? 1,
      symbol: U2D[u.unit.unitName]?.symbol,
    }))
    .filter((e) => e.dimension !== undefined)
    .sort((a, b) => U2D[a.unit]!.order - U2D[b.unit]!.order);
}

export function dimId(dims: DimensionEntry[] | undefined): string | undefined {
  if (!dims || dims.length === 0) return undefined;
  const byDimension = new Map(dims.map((d) => [d.dimension ?? "", d]));
  const vector = DIMS_VECTOR.map((h) => {
    const entry = byDimension.get(h);
    // Ruby builds the vector with Array#join on the raw exponent objects —
    // Number#to_s is the value, Fenced#to_s is default object garbage —
    // so fenced exponents never match a unitsdb vector. Mirror that.
    return entry ? rubyToString(entry.exponent) : "";
  }).join(":");
  const found = Unitsdb.findDimensionByVector(vector);
  if (found?.id) return found.id;
  return (
    "D_" +
    dims
      .map((d) => {
        const symbol =
          U2D[d.unit]?.symbol ?? (d.dimension ? DIM2D[d.dimension]?.symbol : undefined) ?? "";
        const exp = toIValue(d.exponent);
        return symbol + (exp === 1 ? "" : floatToDisplay(d.exponent));
      })
      .join("")
  );
}

function rubyToString(exponent: NumericValue | number | undefined): string {
  // Only raw numbers ever match a unitsdb vector: parsed exponents are
  // model objects and Ruby's Array#join renders them as object garbage.
  return typeof exponent === "number" ? String(exponent) : String(exponent);
}

export function toIValue(object: NumericValue | number | undefined): number | undefined {
  if (typeof object === "number") return object;
  return object?.toInt();
}

export function decomposeUnitsList(units: Unit[]): UnitEntry[] {
  return gatherUnits(units.flatMap(decomposeUnit));
}

function decomposeUnit(u: Unit | undefined): UnitEntry[] {
  if (u === undefined) return [];
  const instance = u.instance;
  const systemType = snakeCase(u.systemType);
  if (u.unitName === "g" || systemType === "si_base") {
    return [{ unit: u, prefix: u.prefix }];
  }
  if (!u.siDerivedBases || u.siDerivedBases.length === 0) {
    return [{ unit: new Unit(UNKNOWN) }];
  }
  return u.siDerivedBases.map((k) => {
    const prefix = k.prefix_reference
      ? combinePrefixes(
          Unitsdb.findPrefixById(k.prefix_reference.id),
          u.prefix,
        )
      : u.prefix;
    const derivedUnit = findUnitById(k.unit_reference.id);
    const unitName = derivedUnit?.symbols?.[0]?.id ?? UNKNOWN;
    const exponent =
      (k.power !== null && k.power !== undefined ? Number(k.power) : 1) *
      powerToFloat(u.powerNumerator);
    return {
      prefix: prefix as Prefix | PrefixRecord | null | undefined,
      unit: new Unit(unitName, exponent, prefix as Prefix | undefined),
    };
  });
}

function gatherUnits(units: UnitEntry[]): UnitEntry[] {
  const sorted = [...units].sort((a, b) =>
    (a.unit?.unitName ?? "").localeCompare(b.unit?.unitName ?? ""),
  );
  const out: UnitEntry[] = [];
  for (const k of sorted) {
    const last = out.at(-1);
    if (out.length === 0 || last!.unit?.unitName !== k.unit?.unitName) {
      out.push(k);
    } else {
      last!.unit.powerNumerator = new Number_(
        String(numeratorValue(k, last!)),
      );
      out[out.length - 1] = {
        prefix: combinePrefixes(last!.prefix as Prefix | PrefixRecord | null, k.prefix as Prefix | PrefixRecord | null) as Prefix | PrefixRecord | null,
        unit: last!.unit,
      };
    }
  }
  return out;
}

function powerToFloat(power: Unit["powerNumerator"]): number {
  if (typeof power === "number") return power;
  return power?.toFloat() ?? 1;
}

function numeratorValue(unitHash: UnitEntry, unitArray: UnitEntry): number {
  return (
    powerToFloat(unitHash.unit?.powerNumerator) +
    powerToFloat(unitArray.unit?.powerNumerator)
  );
}

export function combinePrefixes(
  p1: Prefix | PrefixRecord | null | undefined,
  p2: Prefix | PrefixRecord | null | undefined,
): Prefix | PrefixRecord | string | null {
  const a1 = wrapPrefix(p1);
  const a2 = wrapPrefix(p2);
  if (a1 === null && a2 === null) return null;
  if (a2 === null) return symbolIdOf(p1) ?? UNKNOWN;
  if (a1 === null) return symbolIdOf(p2) ?? UNKNOWN;
  if (baseOf(p1) === undefined || baseOf(p2) === undefined) return UNKNOWN;
  if (baseOf(p1) !== baseOf(p2)) return UNKNOWN;
  const targetPower = powerOf(p1)! + powerOf(p2)!;
  for (const prefixName of Unitsdb.prefixSymbolNames()) {
    const candidate = Unitsdb.findPrefixBySymbolName(prefixName);
    if (candidate?.base === baseOf(p1) && candidate?.power === targetPower) {
      return candidate;
    }
  }
  return UNKNOWN;
}

function wrapPrefix(prefix: Prefix | PrefixRecord | string | null | undefined): Prefix | PrefixRecord | null {
  if (prefix === null || prefix === undefined) return null;
  if (typeof prefix === "string") {
    return Unitsdb.findPrefixBySymbolName(prefix) ?? null;
  }
  return prefix;
}

function baseOf(p: Prefix | PrefixRecord | string | null | undefined): number | undefined {
  const wrapped = wrapPrefix(p);
  if (!wrapped) return undefined;
  if (wrapped instanceof UnitsmlPrefix) return wrapped.base;
  return (wrapped as PrefixRecord).base;
}

function powerOf(p: Prefix | PrefixRecord | string | null | undefined): number | undefined {
  const wrapped = wrapPrefix(p);
  if (!wrapped) return undefined;
  if (wrapped instanceof UnitsmlPrefix) return wrapped.power;
  return (wrapped as PrefixRecord).power;
}

function symbolIdOf(p: Prefix | PrefixRecord | string | null | undefined): string | undefined {
  const wrapped = wrapPrefix(p);
  if (!wrapped) return undefined;
  if (wrapped instanceof UnitsmlPrefix) return wrapped.symbolid;
  return (wrapped as PrefixRecord).symbols?.at(0)?.ascii;
}

function prefixNameOf(p: Prefix | PrefixRecord | string | null | undefined): string | undefined {
  if (!p || typeof p === "string") return p || undefined;
  if (p instanceof UnitsmlPrefix) return p.prefixName;
  return symbolIdOf(p);
}

export function floatToDisplay(value: NumericValue | number | undefined | null): string {
  if (typeof value === "number") {
    return String(Math.round(value * 10) / 10).replace(/\.0$/, "");
  }
  if (value instanceof Number_ || value instanceof Fenced) return value.floatToDisplay();
  return "";
}

// ---- XML emission ----

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function unitXml(
  units: Unit[],
  formula: Formula,
  dims: DimensionEntry[] | undefined,
  normText: string,
  name: string | undefined,
  options: Record<string, unknown>,
): string {
  const idAttr = ` xml:id="${esc(unitId(normText))}"`;
  const dimUrl = dims ? ` dimensionURL="#${dimId(dims)}"` : "";
  void idAttr;
  const systems = unitSystemXml(units);
  const unitNameXml = `  <UnitName xml:lang="en">${esc(name ?? unitEnName(unitInstance(normText) ?? {}) ?? normText)}</UnitName>`;
  const symbols = unitsymbolsXml(formula, options);
  const roots = rootUnitsXml(units);
  return `<Unit xmlns="${UNITSML_NS}"${dimUrl}${idAttr}>\n${systems}${unitNameXml}\n${symbols}${roots}\n</Unit>`;
}

function unitSystemXml(units: Unit[]): string {
  const parts: string[] = [];
  const anyNonSi = units.some((u) => !u.siSystemType);
  const anySi = units.some((u) => u.siSystemType);
  if (anyNonSi) {
    parts.push(`  <UnitSystem name="not_SI" type="not_SI" xml:lang="en"/>`);
  }
  if (anySi) {
    let base = false;
    if (units.length === 1) {
      base = units[0].downcaseSystemType === "si_base";
      if (units[0].unitName === "g" && units[0].prefixName === "k") base = true;
    }
    parts.push(`  <UnitSystem name="SI" type="${base ? "SI_base" : "SI_derived"}" xml:lang="en"/>`);
  }
  return parts.join("\n") + (parts.length ? "\n" : "");
}

function unitsymbolsXml(formula: Formula, options: Record<string, unknown>): string {
  const html = `  <UnitSymbol type="HTML">${formula.toHtml(options as never)}</UnitSymbol>`;
  const mathml = `  <UnitSymbol type="MathMl">\n${formula.mathmlString(options as never)}\n  </UnitSymbol>`;
  return `${html}\n${mathml}\n`;
}

function rootUnitsXml(units: Unit[]): string {
  if (units.length === 1 && !units[0].prefix) return "";
  const entries = units.map((unit) => {
    let attrs = ` unit="${esc(unit.enumeratedName ?? unit.unitName)}"`;
    if (unit.prefix) attrs += ` prefix="${esc(unit.prefixName!)}"`;
    const power = unit.powerNumerator;
    const rawPower = typeof power === "number" ? String(power) : power?.rawValue;
    if (rawPower !== undefined && rawPower !== "1") {
      attrs += ` powerNumerator="${esc(String(rawPower))}"`;
    }
    return `    <EnumeratedRootUnit${attrs}/>`;
  });
  return `  <RootUnits>\n${entries.join("\n")}\n  </RootUnits>`;
}

export function prefixesXml(units: Unit[], options: Record<string, unknown>): string {
  const seen = new Set<string>();
  const uniq: Prefix[] = [];
  for (const unit of units) {
    if (unit.prefix && !seen.has(unit.prefix.prefixName)) {
      seen.add(unit.prefix.prefixName);
      uniq.push(unit.prefix);
    }
  }
  return uniq.map((p) => prefixXml(p, options)).join("\n");
}

export function prefixXml(prefix: Prefix, options: Record<string, unknown>): string {
  const record = prefix.instance;
  const base = prefix.base ?? 10;
  const power = prefix.power ?? 0;
  const id = prefix.id ?? prefixNistId(record ?? {}) ?? "";
  const name = prefix.name ?? prefixEnName(record ?? {}) ?? "";
  const syms = record?.symbols?.at(-1) ?? {};
  return (
    `<Prefix xmlns:xml="http://www.w3.org/XML/1998/namespace" xmlns="${UNITSML_NS}" prefixBase="${base}" prefixPower="${power}" xml:id="${esc(id)}">\n` +
    `  <PrefixName xml:lang="en">${esc(name)}</PrefixName>\n` +
    ["ASCII", "unicode", "LaTeX", "HTML"]
      .map((type) => {
        const key = type.toLowerCase() as "ascii" | "unicode" | "latex" | "html";
        // Ruby emits prefix symbol content verbatim (entity forms intact).
        return `  <PrefixSymbol type="${type}">${syms[key] ?? ""}</PrefixSymbol>`;
      })
      .join("\n") +
    `\n</Prefix>`
  );
}

export function unitId(text: string): string {
  const stripped = text?.replace(/[()]/g, "") ?? "";
  const unit = unitInstance(stripped);
  return `U_${formatUnitId(unit, stripped)}`;
}

function formatUnitId(unit: UnitRecord | undefined, text: string): string {
  if (unit) return (unitNistId(unit) ?? "").replace(/'/g, "_");
  return text.replace(/\*/g, ".").replace(/\^/g, "");
}

export function dimensionXml(normText: string): string | undefined {
  const dimIdValue = unitDimensionId(unitInstance(normText));
  if (!dimIdValue) return undefined;
  const attrs: string[] = [` xml:id="${esc(dimIdValue)}"`];
  const components = dimIdToDimensions(dimIdValue) ?? [];
  for (const component of components) {
    if (!component) continue;
    const element = COMPONENT_ELEMENTS[component.key];
    if (!element) continue;
    attrs.push(
      `  <${element} symbol="${esc(component.symbol ?? "")}" powerNumerator="${floatToDisplay(component.exponent as number)}"/>`,
    );
  }
  if (attrs.length === 1) {
    return `<Dimension xmlns="${UNITSML_NS}"${attrs[0]}/>`;
  }
  return `<Dimension xmlns="${UNITSML_NS}"${attrs[0]}>\n${attrs.slice(1).join("\n")}\n</Dimension>`;
}

export function dimensionComponentsXml(dims: DimensionEntry[] | undefined): string | undefined {
  if (!dims || dims.length === 0) return undefined;
  const id = dimId(dims);
  const lines = dims.map(
    (d) =>
      `  <${COMPONENT_ELEMENTS[snakeCase(d.dimension)!]} symbol="${esc(d.symbol ?? "")}" powerNumerator="${floatToDisplay(d.exponent)}"/>`,
  );
  return `<Dimension xmlns="${UNITSML_NS}" xml:id="${esc(id!)}">\n${lines.join("\n")}\n</Dimension>`;
}

interface DimComponent {
  key: string;
  symbol?: string;
  exponent?: unknown;
}

function dimIdToDimensions(dimIdValue: string): DimComponent[] | undefined {
  const dims = Unitsdb.findDimensionById(dimIdValue);
  if (!dims) return undefined;
  return dimensionComponents(dims).map(([key, component]) => ({
    key,
    symbol: (component as { symbol?: string }).symbol,
    exponent: (component as { power?: unknown }).power,
  }));
}

export function unitDimensionId(unit: UnitRecord | undefined): string | undefined {
  if (!unit) return undefined;
  if (unit.dimension_reference?.id) return unit.dimension_reference.id;
  const quantityId = unit.quantity_references?.[0]?.id;
  const quantity = quantityInstance(quantityId);
  return quantity?.dimension_reference?.id;
}

export function quantityInstance(id: string | undefined) {
  return id ? Unitsdb.findQuantityById(id) : undefined;
}

export function quantityXml(normText: string, instance: string | undefined): string | undefined {
  const unit = unitInstance(normText);
  const quantityId = instance || unit?.quantity_references?.[0]?.id;
  if (!(unit && unit.quantity_references?.length === 1) && !quantityInstance(instance)) {
    return undefined;
  }
  const dimUrl = `#${unitDimensionId(unit)}`;
  const quantity = quantityInstance(quantityId);
  const id = quantity?.id ?? quantityId;
  // unitsml-ruby's Model::Quantity defaults quantity_type to "base" and
  // Utility never sets it — the attribute is constant.
  const enNames = (quantity?.names ?? [])
    .filter((n) => n.lang === "en")
    .map((n) => `  <QuantityName xml:lang="en">${esc(n.value)}</QuantityName>`);
  return (
    `<Quantity xmlns:xml="http://www.w3.org/XML/1998/namespace" xmlns="${UNITSML_NS}" xml:id="${esc(id!)}" quantityType="base" dimensionURL="${esc(dimUrl)}">\n` +
    `${enNames.join("\n")}\n</Quantity>`
  );
}

export function snakeCase(input: string | undefined): string | undefined {
  return input
    ?.replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

function findUnitById(id: string) {
  return Unitsdb.findUnitById(id);
}

function findQuantityById(id: string | undefined) {
  return Unitsdb.findQuantityById(id!);
}
