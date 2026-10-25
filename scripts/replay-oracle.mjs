// Replays the SHARED unitsml-testsuite corpus (github.com/unitsml/
// unitsml-testsuite, corpora/renders) — the same oracle unitsml-ruby
// replays. CORPUS_DIR points at the checkout; the default expects the
// testsuite cloned as a sibling of this repository.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../dist/index.js";
import { toXml } from "../dist/render.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR =
  process.env.CORPUS_DIR ??
  join(ROOT, "..", "unitsml-testsuite", "corpora", "renders");
const corpus = JSON.parse(
  readFileSync(join(CORPUS_DIR, "expected-renders.json"), "utf8"),
);

const NAMED_ENTITIES = {
  micro: "µ", Omega: "Ω", deg: "°", prime: "′",
  minus: "−", sdot: "⋅", amp: "&", lt: "<", gt: ">",
  quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(xml) {
  return xml
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) =>
      String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function normalizeXml(xml) {
  return decodeEntities(
    xml.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/"/g, "'"),
  ).trim();
}

let passed = 0;
let skipped = 0;
const failures = [];

for (const entry of corpus.cases) {
  const input = entry.input;
  if (entry.kind === "ruby_error") {
    skipped += 1;
    continue;
  }
  const expected = entry.renders;
  try {
    const formula = await parse(input);
    const mismatches = [];
    if (formula.normText !== expected.norm_text) {
      mismatches.push(`norm_text: got ${JSON.stringify(formula.normText)}, want ${JSON.stringify(expected.norm_text)}`);
    }
    if (formula.toAsciimath() !== expected.asciimath) {
      mismatches.push(`asciimath: got ${JSON.stringify(formula.toAsciimath())}, want ${JSON.stringify(expected.asciimath)}`);
    }
    const gotXml = normalizeXml(toXml(formula));
    const wantXml = normalizeXml(expected.xml);
    if (gotXml !== wantXml) {
      const at = [...gotXml].findIndex((ch, i) => ch !== wantXml[i]);
      mismatches.push(`xml at ${at}: got ${JSON.stringify(gotXml.slice(Math.max(0, at - 40), at + 80))}, want ${JSON.stringify(wantXml.slice(Math.max(0, at - 40), at + 80))}`);
    }
    if (mismatches.length === 0) passed += 1;
    else failures.push({ input, mismatches });
  } catch (error) {
    failures.push({ input, mismatches: [`threw: ${error.message}`] });
  }
}

const total = corpus.cases.length;
console.log(`${passed}/${total - skipped} render cases pass (${skipped} ruby_error rows skipped)`);
for (const { input, mismatches } of failures.slice(0, Number(process.env.SHOW ?? 10))) {
  console.error(`FAIL ${JSON.stringify(input)}`);
  for (const m of mismatches) console.error(`  ${m}`);
}
if (failures.length > 0) process.exit(1);
