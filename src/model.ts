// The unitsml model: a 1:1 port of unitsml-ruby's model classes
// (lib/unitsml/{formula,unit,prefix,dimension,number,fenced,sqrt,
// extender}.rb), including their render methods.
import { Unitsdb, unitNistId, prefixNistId, type UnitRecord, type PrefixRecord, type DimensionRecord, type UnitSymbol, type DerivedBase, dimensionComponents } from "./unitsdb.js";
import { serializeMathml, mathTag, stringToHtmlEntity, escapeNonAscii, type MathmlNode } from "./mathml.js";



export interface FormulaOptions {
  multiplier?: string;
  explicit_parenthesis?: boolean;
  [key: string]: unknown;
}

function numeric(
  power: NumericValue | number,
  method: "toLatex" | "toAsciimath" | "toHtml" | "toUnicode",
  options: FormulaOptions,
): string {
  if (typeof power === "number") return String(power);
  return power[method](options);
}

function numericMathml(
  power: NumericValue | number,
  options: FormulaOptions,
): MathmlNode {
  if (typeof power === "number") {
    return new Number_(String(power)).toMathml(options);
  }
  return power.toMathml(options) as MathmlNode;
}

function snakeCase(input: string | undefined): string | undefined {
  return input
    ?.replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

export abstract class BaseModel {
  abstract toMathml(options: FormulaOptions): MathmlNode | MathmlNode[];
  abstract toLatex(options: FormulaOptions): string;
  abstract toAsciimath(options: FormulaOptions): string;
  abstract toHtml(options: FormulaOptions): string;
  abstract toUnicode(options: FormulaOptions): string;
}

export class Number_ extends BaseModel {
  constructor(public value: string) {
    super();
  }

  get rawValue(): string {
    return this.value;
  }

  get negative(): boolean {
    return this.value.startsWith("-");
  }

  updateNegativeSign(): this {
    this.value = this.negative ? this.value.slice(1) : `-${this.value}`;
    return this;
  }

  toInt(): number {
    return parseInt(this.value, 10);
  }

  toFloat(): number {
    return parseFloat(this.value);
  }

  floatToDisplay(): string {
    if (this.value === null || this.value === undefined) return "";
    const rounded = Math.round(this.toFloat() * 10) / 10;
    return String(rounded).replace(/\.0$/, "");
  }

  override toMathml(_options: FormulaOptions): MathmlNode {
    const matched = this.value?.match(/-?(.+)/);
    const mnValue = matched ? matched[1] : this.value;
    const mn: MathmlNode = { method: "mn", value: mnValue };
    return this.negative
      ? { method: "mrow", children: [{ method: "mo", value: "&#x2212;" }, mn] }
      : mn;
  }

  override toHtml(_options: FormulaOptions): string {
    return this.value.replace("-", "&#x2212;");
  }

  override toLatex(_options: FormulaOptions): string {
    return this.value;
  }

  override toAsciimath(_options: FormulaOptions): string {
    return this.value;
  }

  override toUnicode(_options: FormulaOptions): string {
    return this.value;
  }
}

export class Fenced extends BaseModel {
  constructor(
    public openParen: string,
    public value: ModelNode,
    public closeParen: string,
  ) {
    super();
  }

  get rawValue(): string | number {
    return this.value instanceof Number_ || this.value instanceof Fenced
      ? this.value.rawValue
      : "";
  }

  get negative(): boolean {
    return this.value instanceof Number_ || this.value instanceof Fenced
      ? this.value.negative
      : false;
  }

  updateNegativeSign(): this {
    if (this.value instanceof Number_ || this.value instanceof Fenced) {
      this.value.updateNegativeSign();
    }
    return this;
  }

  floatToDisplay(): string {
    return this.value instanceof Number_ || this.value instanceof Fenced
      ? this.value.floatToDisplay()
      : "";
  }

  toInt(): number {
    return this.value instanceof Number_ || this.value instanceof Fenced
      ? this.value.toInt()
      : NaN;
  }

  toFloat(): number {
    return this.value instanceof Number_ || this.value instanceof Fenced
      ? this.value.toFloat()
      : NaN;
  }

  dimensionsExtraction(): Dimension[] {
    if (this.value instanceof Dimension) return [this.value];
    if (this.value instanceof Formula || this.value instanceof Fenced) {
      return this.value.dimensionsExtraction();
    }
    return [];
  }

  override toMathml(options: FormulaOptions): MathmlNode | MathmlNode[] {
    const mathml = this.value.toMathml(options);
    if (!options["explicit_parenthesis"]) return mathml;
    const children: MathmlNode[] = [
      { method: "mo", value: this.openParen },
      ...(Array.isArray(mathml) ? mathml : [mathml]),
      { method: "mo", value: this.closeParen },
    ];
    return { method: "mrow", children };
  }

  override toHtml(options: FormulaOptions): string {
    return this.fencedConversionFor("html", options);
  }

  override toLatex(options: FormulaOptions): string {
    return this.fencedConversionFor("latex", options);
  }

  override toAsciimath(options: FormulaOptions): string {
    return this.fencedConversionFor("asciimath", options);
  }

  override toUnicode(options: FormulaOptions): string {
    return this.fencedConversionFor("unicode", options);
  }

  private fencedConversionFor(
    lang: "asciimath" | "latex" | "html" | "unicode",
    options: FormulaOptions,
  ): string {
    const langValue = this.value[`to${lang[0].toUpperCase()}${lang.slice(1)}` as keyof ModelNode](options) as string;
    if (!options["explicit_parenthesis"]) return langValue;
    return `${this.openParen}${langValue}${this.closeParen}`;
  }
}

export type NumericValue = Number_ | Fenced;

export class Sqrt extends BaseModel {
  constructor(public value: ModelNode | undefined) {
    super();
  }

  override toAsciimath(options: FormulaOptions): string {
    return this.value?.toAsciimath(options) ?? "";
  }
  override toLatex(options: FormulaOptions): string {
    return this.value?.toLatex(options) ?? "";
  }
  override toMathml(options: FormulaOptions): MathmlNode | MathmlNode[] {
    return this.value!.toMathml(options);
  }
  override toHtml(options: FormulaOptions): string {
    return this.value?.toHtml(options) ?? "";
  }
  override toUnicode(options: FormulaOptions): string {
    return this.value?.toUnicode(options) ?? "";
  }
}

export class Extender extends BaseModel {
  constructor(public symbol: string) {
    super();
  }

  override toMathml(options: FormulaOptions): MathmlNode {
    const rspace = options["multiplier"] === "space" ? "thickmathspace" : undefined;
    const extender = this.multiplier((options["multiplier"] as string) || "⋅", true, false);
    return { method: "mo", value: extender, ...(rspace ? { attrs: { rspace } } : {}) };
  }

  override toLatex(options: FormulaOptions): string {
    return this.multiplierLatex((options["multiplier"] as string) || "/");
  }

  override toAsciimath(options: FormulaOptions): string {
    return this.multiplierPlain((options["multiplier"] as string) || this.symbol);
  }

  override toHtml(options: FormulaOptions): string {
    return this.multiplier((options["multiplier"] as string) || "⋅", true, true);
  }

  override toUnicode(options: FormulaOptions): string {
    const extender = (options["multiplier"] as string) || this.unicodeExtender();
    return this.multiplierPlain(extender);
  }

  private multiplierLatex(extender: string): string {
    return this.multiplierPlain(extender);
  }

  private multiplierPlain(extender: string): string {
    return extender;
  }

  private multiplier(extender: string, unicode: boolean, html: boolean): string {
    switch (extender) {
      case "space":
        return this.spaceExtender(html, unicode);
      case "nospace":
        return unicode ? "&#x2062;" : "";
      default:
        return unicode ? stringToHtmlEntity(extender) : extender;
    }
  }

  private spaceExtender(html: boolean, unicode: boolean): string {
    if (html) return "&#xa0;";
    return unicode ? "&#x2062;" : " ";
  }

  private unicodeExtender(): string {
    return this.symbol === "*" ? "·" : this.symbol;
  }
}

export class Prefix extends BaseModel {
  onlyInstance = false;
  private prefixInstance?: PrefixRecord;

  constructor(public prefixName: string, onlyInstance = false) {
    super();
    this.onlyInstance = onlyInstance;
  }

  get instance(): PrefixRecord | undefined {
    this.prefixInstance ??= Unitsdb.findPrefixBySymbolName(this.prefixName);
    return this.prefixInstance;
  }

  get id(): string | undefined {
    return this.instance ? prefixNistId(this.instance) : undefined;
  }

  get name(): string | undefined {
    return this.instance?.names?.find((n) => n.lang === "en")?.value;
  }

  get prefixSymbols(): UnitSymbol | undefined {
    return this.instance?.symbols?.at(-1);
  }

  get symbolid(): string | undefined {
    return this.prefixSymbols?.ascii;
  }

  get base(): number | undefined {
    return this.instance?.base;
  }

  get power(): number | undefined {
    return this.instance?.power;
  }

  override toMathml(_options: FormulaOptions): MathmlNode {
    // Ruby: string_to_html_entity(html_entity_to_unicode(symbols.html))
    const html = this.prefixSymbols?.html ?? this.symbolid ?? this.prefixName ?? "";
    const decoded = html
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&([a-zA-Z]+);/g, (name) => name);
    return { method: "mi", value: stringToHtmlEntity(decoded) };
  }

  override toLatex(_options: FormulaOptions): string {
    return this.prefixSymbols?.latex ?? this.symbolid ?? this.prefixName;
  }

  override toAsciimath(_options: FormulaOptions): string {
    return this.symbolid ?? this.prefixName;
  }

  override toHtml(_options: FormulaOptions): string {
    return this.prefixSymbols?.html ?? this.symbolid ?? this.prefixName;
  }

  override toUnicode(_options: FormulaOptions): string {
    return this.prefixSymbols?.unicode ?? this.symbolid ?? this.prefixName;
  }
}

export class Unit extends BaseModel {
  constructor(
    public unitName: string,
    public powerNumerator?: NumericValue | number,
    public prefix?: Prefix,
  ) {
    super();
  }

  get instance(): UnitRecord | undefined {
    return Unitsdb.findUnitBySymbolId(this.unitName);
  }

  get unknownName(): boolean {
    return this.unitName === "unknown";
  }

  get unitSymbols(): UnitSymbol | undefined {
    return this.instance?.symbols?.find((s) => s.id === this.unitName);
  }

  override toMathml(options: FormulaOptions): MathmlNode {
    const fragment = this.unitSymbols?.mathml;
    const parsed = parseFragment(fragment);
    const tag = parsed.tag;
    let node: MathmlNode = { method: tag, value: parsed.inner, ...(parsed.attrs ? { attrs: parsed.attrs } : {}) };
    if (this.prefix) {
      const prefixNode = this.prefix.toMathml(options);
      const prefixText = prefixNode.value ?? "";
      node = {
        method: tag,
        value: `${prefixText}${node.value ?? ""}`,
        ...(node.attrs ? { attrs: node.attrs } : {}),
      };
    }
    if (this.powerNumerator) {
      const powerNodes = toArray(numericMathml(this.powerNumerator, options));
      node = { method: "msup", children: [node, ...powerNodes] };
    }
    return node;
  }

  override toLatex(options: FormulaOptions): string {
    let value = this.unitSymbols?.latex ?? "";
    if (this.powerNumerator) value = `${value}^${numeric(this.powerNumerator, "toLatex", options)}`;
    if (this.prefix) value = `${this.prefix.toLatex(options)}${value}`;
    return value;
  }

  override toAsciimath(options: FormulaOptions): string {
    let value = this.unitSymbols?.ascii ?? "";
    if (this.powerNumerator) value = `${value}^${numeric(this.powerNumerator, "toAsciimath", options)}`;
    if (this.prefix) value = `${this.prefix.toAsciimath(options)}${value}`;
    return value;
  }

  override toHtml(options: FormulaOptions): string {
    let value = this.unitSymbols?.html ?? "";
    if (this.powerNumerator) value = `${value}<sup>${numeric(this.powerNumerator, "toHtml", options)}</sup>`;
    if (this.prefix) value = `${this.prefix.toHtml(options)}${value}`;
    return value;
  }

  override toUnicode(options: FormulaOptions): string {
    let value = this.unitSymbols?.unicode ?? "";
    if (this.powerNumerator) value = `${value}^${numeric(this.powerNumerator, "toUnicode", options)}`;
    if (this.prefix) value = `${this.prefix.toUnicode(options)}${value}`;
    return value;
  }

  get enumeratedName(): string | undefined {
    return this.instance?.names?.find((n) => n.lang === "en")?.value;
  }

  get prefixName(): string | undefined {
    return this.prefix?.prefixName;
  }

  get systemType(): string | undefined {
    return this.instance?.unit_system_reference?.[0]?.id;
  }

  get siDerivedBases(): DerivedBase[] | undefined {
    return this.instance?.si_derived_bases;
  }

  get xmlPostprocessName(): string {
    return `${this.prefixName ?? ""}${this.unitName}${this.displayExp ?? ""}`;
  }

  get siSystemType(): boolean {
    return SI_UNIT_SYSTEM.includes(this.downcaseSystemType ?? "");
  }

  get downcaseSystemType(): string | undefined {
    return snakeCase(this.systemType);
  }

  get inversePowerNumerator(): NumericValue | undefined {
    if (this.powerNumerator instanceof Number_ || this.powerNumerator instanceof Fenced) {
      this.powerNumerator.updateNegativeSign();
      return this.powerNumerator;
    }
    if (typeof this.powerNumerator === "number") {
      this.powerNumerator = new Number_(String(-this.powerNumerator));
      return this.powerNumerator;
    }
    this.powerNumerator = new Number_("-1");
    return this.powerNumerator;
  }

  private get displayExp(): string | undefined {
    if (this.powerNumerator === undefined) return undefined;
    const exp = typeof this.powerNumerator === "number"
      ? String(this.powerNumerator)
      : this.powerNumerator.rawValue;
    return exp !== "1" ? `^${exp}` : undefined;
  }
}

const SI_UNIT_SYSTEM = ["si_base", "si_derived_special", "si_derived_non_special"];

export class Dimension extends BaseModel {
  private dimInstance?: DimensionRecord;

  constructor(
    public dimensionName: string,
    public powerNumerator?: NumericValue,
  ) {
    super();
  }

  get instance(): DimensionRecord | undefined {
    if (this.dimInstance === undefined) {
      this.dimInstance = Unitsdb.dimensions.find((dim) =>
        dimensionComponents(dim).some(([, component]) =>
          ((component as { symbols?: Array<{ id?: string }> }).symbols ?? []).some(
            (s) => s.id === this.dimensionName,
          ),
        ),
      );
    }
    return this.dimInstance;
  }

  get dimSymbols(): UnitSymbol | undefined {
    const last = this.processedKeys.at(-1);
    if (!last) return undefined;
    const component = (this.instance?.[last] ?? {}) as {
      symbols?: UnitSymbol[];
    };
    return component.symbols?.[0];
  }

  get processedKeys(): string[] {
    return dimensionComponents(this.instance as DimensionRecord).map(([key]) => key);
  }

  get processedSymbol(): string | undefined {
    const first = this.processedKeys[0];
    const component = this.instance?.[first] as { symbol?: string } | undefined;
    return component?.symbol;
  }

  get elementName(): string {
    return this.processedKeys[0];
  }

  override toMathml(options: FormulaOptions): MathmlNode {
    const parsed = parseFragment(this.dimSymbols?.mathml);
    let value: MathmlNode = {
      method: parsed.tag,
      value: parsed.inner || this.processedSymbol || "",
      ...(parsed.attrs ? { attrs: parsed.attrs } : {}),
    };
    if (this.powerNumerator) {
      value = { method: "msup", children: [{ method: "mrow", children: [value] }, ...toArray(this.powerNumerator.toMathml(options))] };
    }
    return value;
  }

  override toLatex(options: FormulaOptions): string {
    return this.genericCode("latex", options);
  }

  override toAsciimath(options: FormulaOptions): string {
    return this.genericCode("ascii", options);
  }

  override toUnicode(options: FormulaOptions): string {
    return this.genericCode("unicode", options);
  }

  override toHtml(options: FormulaOptions): string {
    let value = this.dimSymbols?.html ?? "";
    if (this.powerNumerator) value = `${value}<sup>${this.powerNumerator.toHtml(options)}</sup>`;
    return value;
  }

  get generateId(): string {
    return `${this.dimensionName.split("_").at(-1)}${this.powerNumerator?.rawValue ?? ""}`;
  }

  private genericCode(
    method: "ascii" | "latex" | "unicode",
    options: FormulaOptions,
  ): string {
    let value = (this.dimSymbols?.[method] as string | undefined) ?? "";
    if (!this.powerNumerator) return value;
    const renderMethod = method === "ascii" ? "toAsciimath" : `to${method[0].toUpperCase()}${method.slice(1)}`;
    return `${value}^${(this.powerNumerator as unknown as Record<string, (o: FormulaOptions) => string>)[renderMethod](options)}`;
  }
}

export class Formula extends BaseModel {
  constructor(
    public value: ModelNode[] = [],
    public explicitValue?: Record<string, string>,
    public root = false,
    public origText?: string,
    public normText?: string,
  ) {
    super();
  }

  updateOptions(options: FormulaOptions): FormulaOptions {
    if (!this.root) return options;
    const multiplier = options.multiplier ?? this.explicitValue?.["multiplier"];
    const explicitParenthesis = "explicit_parenthesis" in options
      ? (options["explicit_parenthesis"] as boolean)
      : true;
    const out: FormulaOptions = { ...options, multiplier, explicit_parenthesis: explicitParenthesis };
    for (const key of Object.keys(out)) {
      if (out[key] === undefined) delete out[key];
    }
    return out;
  }

  override toMathml(options: FormulaOptions = {}): MathmlNode | MathmlNode[] {
    if (this.root) {
      const updated = this.updateOptions(options);
      const children = this.value.flatMap((instance) =>
        toArray(instance.toMathml(updated)),
      );
      return { method: "math", children, ...( {}) } as MathmlNode;
    }
    return this.value.flatMap((obj) => toArray(obj.toMathml(options)));
  }

  /** Root MathML document string (unitsml-ruby Formula#to_mathml string form). */
  mathmlString(options: FormulaOptions = {}): string {
    const node = this.toMathml(options) as MathmlNode;
    return mathTag(node.children ?? []);
  }

  override toLatex(options: FormulaOptions = {}): string {
    return this.value.map((obj) => obj.toLatex(this.updateOptions(options))).join("");
  }

  override toAsciimath(options: FormulaOptions = {}): string {
    return this.value.map((obj) => obj.toAsciimath(this.updateOptions(options))).join("");
  }

  override toHtml(options: FormulaOptions = {}): string {
    return this.value.map((obj) => obj.toHtml(this.updateOptions(options))).join("");
  }

  override toUnicode(options: FormulaOptions = {}): string {
    return this.value.map((obj) => obj.toUnicode(this.updateOptions(options))).join("");
  }

  dimensionsExtraction(): Dimension[] {
    return this.extractDimensions(this.value);
  }

  extractDimensions(formula: ModelNode[]): Dimension[] {
    const dimensions: Dimension[] = [];
    for (const term of formula) {
      if (term instanceof Dimension) {
        dimensions.push(term);
      } else if (term instanceof Sqrt) {
        if (term.value instanceof Dimension) {
          const sqrtTerm = new Dimension(
            term.value.dimensionName,
            term.value.powerNumerator,
          );
          sqrtTerm.powerNumerator = new Number_("0.5");
          dimensions.push(sqrtTerm);
        } else if (term.value instanceof Fenced) {
          dimensions.push(...term.value.dimensionsExtraction());
        }
      } else if (term instanceof Formula) {
        dimensions.push(...this.extractDimensions(term.value));
      } else if (term instanceof Fenced) {
        dimensions.push(...term.dimensionsExtraction());
      }
    }
    return dimensions;
  }

  extractUnits(value: ModelNode[]): Unit[] {
    return value.flatMap((term) => {
      if (term instanceof Unit) {
        // Ruby dups extracted units — the dimension decomposition mutates
        // powers on the extracted copies, never the rendered tree.
        const clone = new Unit(term.unitName, term.powerNumerator, term.prefix);
        return [clone];
      }
      if (term instanceof Formula) return this.extractUnits([...term.value]);
      if (term instanceof Sqrt) {
        return term.value instanceof Unit ? [term.value] : [];
      }
      if (term instanceof Fenced) {
        return this.extractUnits([term.value]);
      }
      return [];
    });
  }
}

export type ModelNode =
  | Unit
  | Prefix
  | Dimension
  | Number_
  | Extender
  | Sqrt
  | Fenced
  | Formula;

export function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function innerOf(xmlFragment: string | undefined): string {
  if (!xmlFragment) return "";
  const match = xmlFragment.match(/^<[^>]*>(.*)<\/[^>]+>$/s);
  return match ? match[1] : xmlFragment;
}

/** Split a stored symbol fragment `<tag attrs>inner</tag>` into parts,
 * preserving the attribute string byte-for-byte (Ruby round-trips it
 * through the mml object graph; keeping the raw attributes matches). */
function parseFragment(fragment: string | undefined): {
  tag: MathmlNode["method"];
  attrs?: Record<string, string>;
  inner: string;
} {
  if (!fragment) return { tag: "mi", inner: "" };
  const match = fragment.match(/^<(\w+)([^>]*)>(.*)<\/\1>$/s);
  if (!match) return { tag: "mi", inner: fragment };
  const [, tag, attrString, inner] = match;
  const attrs: Record<string, string> = {};
  for (const m of attrString.matchAll(/([\w:-]+)=["']([^"']*)["']/g)) {
    attrs[m[1]] = m[2];
  }
  return { tag: tag as MathmlNode["method"], attrs, inner: escapeNonAscii(inner) };
}

