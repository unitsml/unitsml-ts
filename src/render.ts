// Formula#to_xml — a port of unitsml-ruby's Formula#units / #prefixes /
import { Formula, Unit, Prefix, type ModelNode } from "./model.js";
import {
  dimId,
  dimensionComponentsXml,
  dimensionXml,
  prefixesXml,
  quantityXml,
  unitId,
  unitXml,
  units2dimensions,
  unitInstance,
  floatToDisplay,
} from "./utility.js";

export function toXml(formula: Formula, options: Record<string, unknown> = {}): string {
  const updated = formula.updateOptions(options);
  const dimensions = formula.extractDimensions(formula.value);
  if (dimensions.length > 0) {
    return dimensionsXml(formula, dimensions);
  }
  if (/-$/u.test(formula.origText ?? "")) {
    return prefixesOnlyXml(formula);
  }
  return unitsXml(formula, updated);
}

function unitsXml(formula: Formula, options: Record<string, unknown>): string {
  const allUnits = formula.extractUnits(formula.value);
  const normText = allUnits.map((u) => u.xmlPostprocessName).join("*");
  // Ruby runs units2dimensions over a second extract — its dups absorb
  // the decomposition's power mutations, keeping render units clean.
  const dims = units2dimensions(formula.extractUnits(formula.value));
  const main = unitXml(
    allUnits,
    formula,
    dims,
    normText,
    formula.explicitValue?.["name"],
    options,
  );
  const prefixPart = prefixesXml(allUnits, options);
  const dimParts = [dimensionXml(normText), dimensionComponentsXml(dims)]
    .filter((x): x is string => Boolean(x));
  const uniqueDims = [...new Set(dimParts)];
  const quantity = quantityXml(normText, formula.explicitValue?.["quantity"]);
  return [main, prefixPart, ...uniqueDims, quantity]
    .filter((part) => part !== undefined && part !== "")
    .join("\n\n");
}

function prefixesOnlyXml(formula: Formula, options: Record<string, unknown> = {}): string {
  const normText = (formula.normText ?? formula.origText ?? "").split("-")[0];
  const prefixObject = new Unit("", undefined, new Prefix(normText));
  return [
    prefixesXml([prefixObject], options),
    dimensionXml(normText),
    quantityXml(normText, formula.explicitValue?.["quantity"]),
  ]
    .filter((part) => part !== undefined && part !== "")
    .join("\n\n");
}

function dimensionsXml(formula: Formula, dims: ModelNode[]): string {
  const sorted = [...dims].sort((a, b) => {
    const nameOf = (d: ModelNode) =>
      (d as unknown as { dimensionName: string }).dimensionName ?? "";
    const orderOf = (name: string) => U2D_ORDER[name] ?? 99;
    return orderOf(nameOf(a)) - orderOf(nameOf(b));
  });
  const dimIdValue = sorted
    .map((d) => (d as { generateId?: string }).generateId ?? "")
    .join("");
  const lines = sorted.map((d) => {
      const name = (d as unknown as { dimensionName: string }).dimensionName;
      const symbol = name.split("_").at(-1);
      const power = (d as unknown as { powerNumerator?: { rawValue?: string } }).powerNumerator?.rawValue ?? 1;
      return `  <${elementFor(name)} symbol="${symbol}" powerNumerator="${power}"/>`;
    });
  return `<Dimension xmlns="https://schema.unitsml.org/unitsml/1.0" xml:id="D_${dimIdValue}">\n${lines.join("\n")}\n</Dimension>`;
}

const U2D_ORDER: Record<string, number> = {
  dim_L: 1, dim_M: 2, dim_T: 3, dim_I: 4, dim_Theta: 5, dim_N: 6, dim_J: 7, dim_phi: 8,
};

function elementFor(dimensionName: string): string {
  const map: Record<string, string> = {
    dim_L: "Length",
    dim_M: "Mass",
    dim_T: "Time",
    dim_I: "ElectricCurrent",
    dim_Theta: "ThermodynamicTemperature",
    dim_N: "AmountOfSubstance",
    dim_J: "LuminousIntensity",
    dim_phi: "PlaneAngle",
  };
  return map[dimensionName] ?? dimensionName;
}

export { unitId, floatToDisplay, unitInstance, dimId };
