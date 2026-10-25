// MathML emission — string-level composition of the shapes the mml gem
// object graph produces in unitsml-ruby (attribute quoting and entity
// forms preserved from the unitsml-ruby fixtures).
export type MathmlNode = {
  method: "math" | "mi" | "mo" | "mn" | "msup" | "mrow";
  value?: string;
  attrs?: Record<string, string>;
  children?: MathmlNode[];
};

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

function attrsString(attrs?: Record<string, string>): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .map(([k, v]) => {
      // unitsml-ruby's stored symbol fragments quote mathvariant singly;
      // keep that byte-compat quirk for it, double-quote everything else.
      const quote = k === "mathvariant" && !v.includes('"') ? "'" : '"';
      return ` ${k}=${quote}${v}${quote}`;
    })
    .join("");
}

export function serializeMathml(node: MathmlNode): string {
  if (node.children === undefined) {
    return `<${node.method}${attrsString(node.attrs)}>${node.value ?? ""}</${node.method}>`;
  }
  const inner = node.children.map(serializeMathml).join("");
  const open = `<${node.method}${attrsString(node.attrs)}>`;
  return `${open}${inner}</${node.method}>`;
}

export function mathTag(children: MathmlNode[]): string {
  const serialized = serializeMathml({ method: "math", attrs: { xmlns: MATHML_NS, display: "block" }, children });
  // Formula#to_mathml un-escapes entities in the generated markup.
  return serialized.replace(/&amp;(.*?)(?=<\/)/g, "&$1");
}

/** Utility.string_to_html_entity — hexadecimal numeric references. */
export function stringToHtmlEntity(input: string): string {
  return [...input]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (ch === "&") return "&amp;";
      if (ch === "<") return "&lt;";
      if (ch === ">") return "&gt;";
      return code > 127 || ch === "−" || ch === "⋅"
        ? `&#x${code.toString(16).padStart(2, "0")};`
        : ch;
    })
    .join("");
}

/** lutaml escapes non-ASCII as lowercase hex entities when serializing
 * the mml fragments — mirror it on stored symbol content. */
export function escapeNonAscii(input: string): string {
  return input.replace(/[^\x00-\x7F]/g, (ch) =>
    `&#x${ch.codePointAt(0)!.toString(16)};`,
  );
}

export function htmlEntityToUnicode(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
