// Replays the frozen unitsml-ruby render oracle (fixtures/render-oracle.json,
// frozen from unitsml-ruby 0.6.11) against this port: norm_text, asciimath,
// and UnitsML XML per input. XML comparison is semantic (whitespace between
// tags collapsed, quotes unified) since indentation is serializer detail.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../dist/index.js";
import { toXml } from "../dist/render.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const oracle = JSON.parse(
  readFileSync(join(ROOT, "fixtures", "render-oracle.json"), "utf8"),
);

let passed = 0;
const failures = [];

const NAMED_ENTITIES = {
  micro: "\u00b5", Omega: "\u03a9", deg: "\u00b0", prime: "\u2032",
  minus: "\u2212", sdot: "\u22c5", ldquo: "\u201c", amp: "&",
  lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};

function decodeEntities(xml) {
  return xml
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function normalizeXml(xml) {
  return decodeEntities(
    xml.replace(/>\s+</g, "><").replace(/\s+/g, " ").replace(/"/g, "'"),
  ).trim();
}

for (const [input, expected] of Object.entries(oracle)) {
  if (expected.error) continue;
  try {
    const formula = await parse(input);
    const actual = {
      norm_text: formula.normText,
      asciimath: formula.toAsciimath(),
      xml: normalizeXml(toXml(formula)),
    };
    const expectedNormalized = {
      norm_text: expected.norm_text,
      asciimath: expected.asciimath,
      xml: normalizeXml(expected.xml),
    };
    const mismatches = [];
    for (const key of ["norm_text", "asciimath"]) {
      if (actual[key] !== expectedNormalized[key]) {
        mismatches.push(`${key}: got ${JSON.stringify(actual[key])}, want ${JSON.stringify(expectedNormalized[key])}`);
      }
    }
    if (actual.xml !== expectedNormalized.xml) {
      mismatches.push(`xml: got ${JSON.stringify(actual.xml.slice(0, 300))}, want ${JSON.stringify(expectedNormalized.xml.slice(0, 300))}`);
    }
    if (mismatches.length > 0 && process.env.VERBOSE) {
      console.error(`DEBUG ${JSON.stringify(input)} norm: ${JSON.stringify([actual.norm_text, expectedNormalized.norm_text])} am: ${JSON.stringify([actual.asciimath, expectedNormalized.asciimath])}`);
    }
    if (mismatches.length === 0) {
      passed += 1;
    } else {
      failures.push({ input, mismatches });
    }
  } catch (error) {
    failures.push({ input, mismatches: [`threw: ${error.message}`] });
  }
}



console.log(`${passed}/${Object.keys(oracle).filter((k) => !oracle[k].error).length} oracle cases pass`);
for (const { input, mismatches } of failures.slice(0, Number(process.env.SHOW ?? 10))) {
  console.error(`FAIL ${JSON.stringify(input)}`);
  for (const m of mismatches) console.error(`  ${m}`);
}
if (failures.length > 0) process.exit(1);
