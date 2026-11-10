// Replays the SHARED unitsml-testsuite conversion corpus (github.com/
// unitsml/unitsml-testsuite, corpora/conversions) — the same oracle
// unitsml-ruby replays in spec/unitsml/conversion_corpus_spec.rb, case kind
// for case kind. CONVERSION_CORPUS_DIR points at the checkout; the default
// expects the testsuite cloned as a sibling of this repository.
//
// Every case must run: an unknown kind or a missing corpus is a failure,
// never a skip. Values compare as exact rationals.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConversionDefinition,
  ConversionError,
  DimensionMismatchError,
  Quantity,
  Rational,
  ScaleOperationError,
  parse,
  parseConversionXml,
  lexicalDecimal,
  toCanonical,
} from "../dist/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR =
  process.env.CONVERSION_CORPUS_DIR ??
  join(ROOT, "..", "unitsml-testsuite", "corpora", "conversions");
const CORPUS_FILE = join(CORPUS_DIR, "expected-conversions.json");
if (!existsSync(CORPUS_FILE)) {
  console.error(`no conversion corpus at ${CORPUS_FILE} (set CONVERSION_CORPUS_DIR)`);
  process.exit(2);
}
const corpus = JSON.parse(readFileSync(CORPUS_FILE, "utf8"));

const ERRORS = { ConversionError, DimensionMismatchError, ScaleOperationError };

function definitionFrom(entry) {
  return ConversionDefinition.fromModel(
    parseConversionXml(entry.xml),
    entry.document_units ?? {},
  );
}

function definitionsHash(entry) {
  const definitions = {};
  for (const item of entry.definitions ?? []) {
    definitions[item.key] = new ConversionDefinition(parseConversionXml(item.xml));
  }
  return definitions;
}

async function checkConvert(entry, failures) {
  let quantity = await Quantity.parse(entry.value, entry.unit_expression);
  if (entry.kind === "difference") {
    const other = await Quantity.parse(entry.other_value, entry.other_unit_expression);
    quantity = quantity.minus(other);
  }
  const converted = await quantity.convertTo(entry.target, {
    definitions: definitionsHash(entry),
  });
  const expected = Rational.parse(entry.expected);
  if (!converted.value.equals(expected)) {
    failures.push(`${entry.id}: expected ${expected}, got ${converted.value}`);
  }
}

function checkDefinition(entry, failures) {
  const definition = definitionFrom(entry);
  if (definition.exact !== entry.exact) failures.push(`${entry.id}: exactness`);
  for (const [name, expected] of Object.entries(entry.lexical ?? {})) {
    const actual = lexicalDecimal(definition.model, name);
    if (actual !== expected) {
      failures.push(`${entry.id}: lexical ${name}: ${JSON.stringify(actual)}`);
    }
  }
  for (const operation of entry.operations) {
    const input = Rational.parse(operation.input);
    const actual = definition[operation.op](input);
    const expected = Rational.parse(operation.expected);
    if (!actual.equals(expected)) {
      failures.push(
        `${entry.id}: ${operation.op}(${input}) = ${actual}, expected ${expected}`,
      );
    }
  }
}

function checkResolve(entry, failures) {
  const resolved = definitionFrom(entry).resolveInitialUnit();
  if (entry.resolves_to !== undefined) {
    if (resolved !== entry.resolves_to) {
      failures.push(
        `${entry.id}: resolved ${JSON.stringify(resolved)}, expected ${JSON.stringify(entry.resolves_to)}`,
      );
    }
  } else if (entry.resolves_to_identifier !== undefined) {
    const ids = (resolved?.identifiers ?? []).map((identifier) => identifier.id);
    if (!ids.includes(entry.resolves_to_identifier)) {
      failures.push(
        `${entry.id}: resolved ids ${JSON.stringify(ids)}, expected ${JSON.stringify(entry.resolves_to_identifier)}`,
      );
    }
  } else {
    failures.push(`${entry.id}: resolve case names no expectation`);
  }
}

async function runErrorOperation(entry) {
  if (entry.operation === "canonical") {
    toCanonical(await parse(entry.expression), definitionsHash(entry));
  } else if (entry.xml) {
    definitionFrom(entry).resolveInitialUnit();
  } else {
    const quantity = await Quantity.parse(entry.value, entry.unit_expression);
    await quantity.convertTo(entry.target, { definitions: definitionsHash(entry) });
  }
}

async function checkError(entry, failures) {
  const expectedError = ERRORS[entry.error];
  if (!expectedError) {
    failures.push(`${entry.id}: unknown error class ${entry.error}`);
    return;
  }
  try {
    await runErrorOperation(entry);
    failures.push(`${entry.id}: expected ${entry.error}, nothing raised`);
  } catch (error) {
    if (!(error instanceof expectedError)) {
      failures.push(`${entry.id}: expected ${entry.error}, got ${error?.name}: ${error?.message}`);
    } else if (!new RegExp(entry.matches).test(error.message)) {
      failures.push(
        `${entry.id}: ${JSON.stringify(error.message)} does not match ${JSON.stringify(entry.matches)}`,
      );
    }
  }
}

const CHECKS = {
  convert: checkConvert,
  difference: checkConvert,
  definition: checkDefinition,
  resolve: checkResolve,
  error: checkError,
};

const failures = [];
const failedCases = new Set();
const kinds = {};
for (const entry of corpus.cases) {
  kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
  const check = CHECKS[entry.kind];
  if (!check) {
    failures.push(`${entry.id}: unknown kind ${JSON.stringify(entry.kind)}`);
    continue;
  }
  const before = failures.length;
  try {
    await check(entry, failures);
  } catch (error) {
    if (failures.length === before) {
      failures.push(`${entry.id}: ${error?.name}: ${error?.message}`);
    }
  }
  if (failures.length > before) failedCases.add(entry.id);
}

const total = corpus.cases.length;
for (const failure of failures) if (failure.includes("unknown kind")) failedCases.add(failure);
console.log(
  `conversion corpus (schema ${corpus.schema}): ${total - failedCases.size}/${total} cases ` +
    `(${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", ")})`,
);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
