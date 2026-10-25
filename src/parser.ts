// Parse pipeline: a port of unitsml-ruby's Unitsml::Parser (extras,
// TreeMapper dispatch, build_formula, update_units_exponents, the
// trailing "-" only_instance rule).
import { parseShape, type AsciiUnitsTree } from "@unitsml/asciiunits-ts";
import {
  Dimension,
  Extender,
  Formula,
  Fenced,
  Number_,
  Prefix,
  Sqrt,
  Unit,
  type ModelNode,
  type NumericValue,
} from "./model.js";

export class ParseError extends Error {
  constructor(readonly input: string) {
    super(`failed to parse ${JSON.stringify(input)}`);
    this.name = "ParseError";
  }
}

type PlainTree = Record<string, unknown>;

export class Parser {
  readonly extras: Record<string, string> = {};
  readonly text: string;
  readonly origText: string;

  constructor(text: string) {
    this.text = postExtras(stripEquation(text), this.extras);
    this.origText = this.text;
    this.text = this.text.replace(/−/g, "-");
  }

  async parse(): Promise<Formula> {
    const tree = await parseShape(this.text);
    if (tree === null) throw new ParseError(this.text);
    const mapped = mapTree(tree as AsciiUnitsTree);
    const formula = buildFormula.call(this, mapped);
    updateUnitsExponents(formula.value, false);
    if (this.text.endsWith("-")) {
      const first = formula.value[0];
      if (first instanceof Prefix) first.onlyInstance = true;
    }
    return formula;
  }
}

function stripEquation(text: string): string {
  if (!text?.startsWith("unitsml(")) return text;
  return text.slice("unitsml(".length).replace(/\)$/, "");
}

function postExtras(text: string, extras: Record<string, string>): string {
  const regexp = /(quantity|name|symbol|multiplier):\s*/;
  if (!regexp.test(text)) return text;
  const parts = text.split(",").map((t) => t.trim());
  const head = parts.shift() ?? "";
  for (const part of parts) {
    if (!regexp.test(part)) continue;
    const [key, , value] = partition(part, ":");
    extras[key] ??= value.trim();
  }
  return head;
}

function partition(input: string, sep: string): [string, string, string] {
  const index = input.indexOf(sep);
  if (index === -1) return [input, "", ""];
  return [input.slice(0, index), sep, input.slice(index + sep.length)];
}

function buildFormula(this: { extras: Record<string, string>; origText: string; text: string }, mapped: ModelNode | PlainTree): Formula {
  const formulaValue = mapped instanceof Formula ? mapped.value : [mapped as ModelNode].flat();
  return new Formula(
    formulaValue,
    this.extras,
    true,
    this.origText,
    this.text,
  );
}

// A 1:1 port of unitsml-ruby's Unitsml::Parg::TreeMapper dispatch
// (sorted capture-key sets, bottom-up), building unitsml-ts nodes.
export function mapTree(tree: AsciiUnitsTree): ModelNode | PlainTree {
  return map(normalize(tree) as PlainTree);
}

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node !== null && typeof node === "object") {
    const out: PlainTree = {};
    for (const [key, value] of Object.entries(node)) out[key] = normalize(value);
    return out;
  }
  return node;
}

function map(node: PlainTree): ModelNode | PlainTree {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return node as unknown as ModelNode;
  }
  const mapped: PlainTree = {};
  for (const [key, value] of Object.entries(node)) {
    mapped[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? map(value as PlainTree)
        : value;
  }
  const keys = Object.keys(mapped).sort();
  const text = (key: string): string =>
    typeof mapped[key] === "object" && mapped[key] !== null
      ? ((mapped[key] as PlainTree)["value"] as string)
      : String(mapped[key]);
  const child = (key: string): ModelNode => mapped[key] as unknown as ModelNode;

  switch (keys.join(" ")) {
    case "dimension":
      return new Dimension(text("dimension"));
    case "dimension extender power_numerator sequence":
      return new Formula([
        new Dimension(text("dimension"), mapped["power_numerator"] as NumericValue),
        new Extender(text("extender")),
        child("sequence"),
      ]);
    case "dimension extender sequence":
      return new Formula([
        new Dimension(text("dimension")),
        new Extender(text("extender")),
        child("sequence"),
      ]);
    case "dimension power_numerator":
      return new Dimension(text("dimension"), mapped["power_numerator"] as NumericValue);
    case "extender first_set second_set":
      return new Formula([child("first_set"), new Extender(text("extender")), child("second_set")]);
    case "extender implicit_extended sequence":
      return new Formula([child("implicit_extended"), new Extender(text("extender")), child("sequence")]);
    case "extender int_exp sequence":
      return new Formula([child("int_exp"), new Extender(text("extender")), child("sequence")]);
    case "extender power_numerator sequence unit":
      return new Formula([
        new Unit(text("unit"), mapped["power_numerator"] as NumericValue),
        new Extender(text("extender")),
        child("sequence"),
      ]);
    case "extender power_numerator prefix sequence unit":
      return new Formula([
        new Unit(text("unit"), mapped["power_numerator"] as NumericValue, new Prefix(text("prefix"))),
        new Extender(text("extender")),
        child("sequence"),
      ]);
    case "extender prefix sequence unit":
      return new Formula([
        new Unit(text("unit"), undefined, new Prefix(text("prefix"))),
        new Extender(text("extender")),
        child("sequence"),
      ]);
    case "extender sequence unit":
      return new Formula([new Unit(text("unit")), new Extender(text("extender")), child("sequence")]);
    case "first_int_exp_set second_int_exp_set":
      return new Formula([setToFence(mapped["first_int_exp_set"]), setToFence(mapped["second_int_exp_set"])]);
    case "first_int_exp_set second_set":
      return new Formula([setToFence(mapped["first_int_exp_set"]), child("second_set")]);
    case "first_set second_int_exp_set":
      return new Formula([child("first_set"), setToFence(mapped["second_int_exp_set"])]);
    case "first_set second_set":
      return new Formula([child("first_set"), child("second_set")]);
    case "implicit_extended":
      return child("implicit_extended");
    case "int_exp":
      return child("int_exp");
    case "int_exp sequence":
      return new Formula([child("int_exp"), child("sequence")]);
    case "integer":
      return new Number_(text("integer"));
    case "close_paren integer open_paren":
      return new Fenced(text("open_paren"), new Number_(text("integer")), text("close_paren"));
    case "close_paren int_exp open_paren":
      return new Fenced(text("open_paren"), child("int_exp"), text("close_paren"));
    case "power_numerator unit":
      return new Unit(text("unit"), mapped["power_numerator"] as NumericValue);
    case "power_numerator prefix unit":
      return new Unit(text("unit"), mapped["power_numerator"] as NumericValue, new Prefix(text("prefix")));
    case "prefix":
      return new Prefix(text("prefix"));
    case "prefix unit":
      return new Unit(text("unit"), undefined, new Prefix(text("prefix")));
    case "sqrt":
      return new Sqrt(child("sqrt"));
    case "unit":
      return new Unit(text("unit"));
    default:
      return mapped;
  }
}

function setToFence(set: unknown): ModelNode {
  if (set instanceof Fenced) return set;
  return new Fenced("(", set as ModelNode, ")");
}

// unitsml-ruby Parser#update_units_exponents: sqrt -> 0.5 powers,
// "/" and "//" invert the following exponents.
export function updateUnitsExponents(
  array: ModelNode[],
  inverse: boolean,
  sqrt = false,
): void {
  for (let object of array) {
    if (object instanceof Sqrt) {
      const inner = object.value!;
      if (inner instanceof Unit) {
        inner.powerNumerator = new Number_("0.5");
        object = inner;
      } else {
        updateUnitsExponents([inner], inverse, true);
        object = inner;
      }
    }
    if (object instanceof Unit) {
      if (sqrt) {
        object.powerNumerator = new Number_("0.5");
        continue;
      }
      if (inverse) object.inversePowerNumerator;
    } else if (object instanceof Dimension) {
      if (sqrt) object.powerNumerator = new Number_("0.5");
    } else if (object instanceof Extender) {
      if (object.symbol === "/" || object.symbol === "//") inverse = !inverse;
    } else if (object instanceof Formula) {
      updateUnitsExponents(object.value, inverse);
    } else if (object instanceof Fenced) {
      updateUnitsExponents([object.value], inverse, sqrt);
    }
  }
}
