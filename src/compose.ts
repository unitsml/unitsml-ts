// Structural unit composition for quantity products and quotients — the
// port of unitsml-ruby Compose::Builder.quantity_product (build_terms,
// join_glyph, final_power, norm_leaves_text). Nothing is reparsed: terms
// are copied leaf by leaf, "/" negates the right operand's exponents
// lexically, and norm_text is the builder's flat leaf text ("m/s" for the
// simple quotient, otherwise leaves with powers joined by "*").
import { Dimension, Extender, Fenced, Formula, Number_, Prefix, Sqrt, Unit, type ModelNode, type NumericValue } from "./model.js";

type Power = NumericValue | number | undefined;

function powerString(power: Power): string | undefined {
  if (power === undefined || power === null) return undefined;
  if (typeof power === "number") {
    if (!Number.isInteger(power)) throw new RangeError(`non-integer power ${power}`);
    return String(power);
  }
  return String(power.rawValue);
}

function fencedRaw(power: Power): string | undefined {
  return power instanceof Fenced ? fencedRaw(power.value as NumericValue) : powerString(power);
}

function negateString(raw: string | undefined): string {
  if (raw === undefined) return "-1";
  if (/^-?0+$/.test(raw)) return raw;
  return raw.startsWith("-") ? raw.slice(1) : `-${raw}`;
}

function copyFencedPower(power: Fenced): Fenced {
  const inner = power.value instanceof Fenced ? copyFencedPower(power.value) : power.value;
  return new Fenced(power.openParen, inner, power.closeParen);
}

function finalPower(power: Power, invert: boolean): NumericValue | undefined {
  let raw: string | undefined;
  if (power instanceof Fenced) {
    if (!invert) return copyFencedPower(power);
    raw = fencedRaw(power);
  } else {
    raw = powerString(power);
  }
  if (!invert) return raw === undefined ? undefined : new Number_(raw);
  const negated = negateString(raw);
  return negated === "1" ? undefined : new Number_(negated);
}

function rebuildLeaf(leaf: ModelNode, invert: boolean): ModelNode {
  if (leaf instanceof Unit) {
    const prefix = leaf.prefix ? new Prefix(leaf.prefix.prefixName, leaf.prefix.onlyInstance) : undefined;
    return new Unit(leaf.unitName, finalPower(leaf.powerNumerator, invert), prefix);
  }
  if (leaf instanceof Dimension) {
    return new Dimension(leaf.dimensionName, finalPower(leaf.powerNumerator, invert));
  }
  if (leaf instanceof Extender) return new Extender(leaf.symbol);
  if (leaf instanceof Number_) return new Number_(leaf.value);
  return leaf;
}

/** TermTree.map_leaves: structure kept, leaves rebuilt. */
function mapLeaves(node: ModelNode, invert: boolean): ModelNode {
  if (node instanceof Formula) {
    return new Formula(node.value.map((child) => mapLeaves(child, invert)), node.explicitValue, node.root, node.origText, node.normText);
  }
  if (node instanceof Fenced) return new Fenced(node.openParen, mapLeaves(node.value, invert), node.closeParen);
  if (node instanceof Sqrt) return new Sqrt(node.value === undefined ? undefined : mapLeaves(node.value, invert));
  return rebuildLeaf(node, invert);
}

function eachLeaf(nodes: ModelNode[], visit: (leaf: ModelNode) => void): void {
  for (const node of nodes) {
    if (node instanceof Formula) eachLeaf(node.value, visit);
    else if (node instanceof Fenced) eachLeaf([node.value], visit);
    else if (node instanceof Sqrt) { if (node.value) eachLeaf([node.value], visit); }
    else visit(node);
  }
}

function decimalAsFraction(raw: string): string {
  const match = /^(-?)(\d+)\.(\d+)$/.exec(raw);
  if (!match) return raw;
  const numerator = `${match[2]}${match[3]}`.replace(/^0+(?=\d)/, "");
  return `${match[1]}${numerator}/${10n ** BigInt(match[3].length)}`;
}

function unitText(unit: Unit): string {
  return `${unit.prefix?.prefixName ?? ""}${unit.unitName}`;
}

function leafNormText(leaf: Unit | Dimension): string {
  const name = leaf instanceof Unit ? unitText(leaf) : leaf.dimensionName;
  const raw = leaf.powerNumerator === undefined ? undefined : fencedRaw(leaf.powerNumerator);
  return raw === undefined ? name : `${name}^(${decimalAsFraction(raw)})`;
}

function normLeavesText(terms: ModelNode[]): string {
  if (terms.length === 3) {
    const [numerator, glyph, denominator] = terms;
    if (
      numerator instanceof Unit && numerator.powerNumerator === undefined &&
      glyph instanceof Extender && glyph.symbol === "/" &&
      denominator instanceof Unit && denominator.powerNumerator instanceof Number_ &&
      denominator.powerNumerator.rawValue === "-1"
    ) {
      return `${unitText(numerator)}/${unitText(denominator)}`;
    }
  }
  const leaves: string[] = [];
  eachLeaf(terms, (leaf) => {
    if (leaf instanceof Unit || leaf instanceof Dimension) leaves.push(leafNormText(leaf));
    else if (leaf instanceof Number_) leaves.push(leaf.rawValue);
  });
  return leaves.join("*");
}

/** Units and dimensions cannot share one expression (Ruby MixedTermsError). */
export class MixedTermsError extends Error {
  constructor() {
    super("units and dimensions cannot be mixed in one expression");
    this.name = "MixedTermsError";
  }
}

/** Compose::Builder.quantity_product(left, right, operator). */
export function quantityProduct(
  left: Formula | undefined,
  right: Formula | undefined,
  operator: "*" | "/",
): Formula | undefined {
  if (!left && !right) return undefined;
  const leftTerms = (left?.value ?? []).map((term) => mapLeaves(term, false));
  const rightTerms = (right?.value ?? []).map((term) => mapLeaves(term, operator === "/"));
  const joiner =
    leftTerms.length === 0 || rightTerms.length === 0 || leftTerms.at(-1) instanceof Extender
      ? []
      : [new Extender(operator)];
  const terms = [...leftTerms, ...joiner, ...rightTerms];
  const kinds = new Set<string>();
  eachLeaf(terms, (leaf) => {
    if (leaf instanceof Unit) kinds.add("unit");
    if (leaf instanceof Dimension) kinds.add("dimension");
  });
  if (kinds.size > 1) throw new MixedTermsError();
  const text = normLeavesText(terms);
  return new Formula(terms, undefined, true, text, text);
}
