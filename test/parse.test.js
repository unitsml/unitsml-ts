import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, Parser, Unitsdb } from "../dist/index.js";
import { toXml } from "../dist/render.js";

test("parses a bare unit to a resolved model", async () => {
  const formula = await parse("m");
  const unit = formula.value[0];
  assert.equal(unit.unitName, "m");
  assert.equal(unit.instance?.identifiers?.find((i) => i.type === "nist")?.id, "NISTu1");
});

test("norm_text strips the unitsml wrapper", async () => {
  const formula = await parse("unitsml(mm*s^-2)");
  assert.equal(formula.normText, "mm*s^-2");
});

test("asciimath round-trips products and powers", async () => {
  const formula = await parse("unitsml(mm*s^-2)");
  assert.equal(formula.toAsciimath(), "mm*s^-2");
});

test("division inverts exponents", async () => {
  const formula = await parse("unitsml(J/kg*K)");
  assert.equal(formula.toAsciimath(), "J/kg^-1*K^-1");
});

test("sqrt becomes a 0.5 power", async () => {
  const formula = await parse("unitsml(sqrt(Hz))");
  const unit = formula.extractUnits(formula.value)[0];
  assert.equal(unit.powerNumerator.rawValue, "0.5");
});

test("extras capture name and quantity", async () => {
  const formula = await parse("unitsml(um, name: micro meter)");
  assert.equal(formula.explicitValue?.["name"], "micro meter");
});

test("trailing dash marks the prefix-only instance", async () => {
  const formula = await parse("unitsml(d-)");
  assert.equal(formula.normText, "d-");
  const xml = toXml(formula);
  assert.match(xml, /<Prefix xmlns:xml=/);
  assert.match(xml, /<PrefixName xml:lang="en">deci<\/PrefixName>/);
});

test("registered decibel resolves to the NIST identity", async () => {
  const formula = await parse("unitsml(dB)");
  const xml = toXml(formula);
  assert.match(xml, /xml:id="U_NISTu155"/);
  assert.match(xml, /<UnitName xml:lang="en">decibel<\/UnitName>/);
});

test("dimensions decompose through si_derived_bases", async () => {
  const formula = await parse("unitsml(N)");
  const unit = formula.value[0];
  assert.ok((unit.siDerivedBases ?? []).length > 0);
});

test("the unitsdb dataset is loaded", () => {
  assert.ok(Unitsdb.units.length > 300);
  assert.ok(Unitsdb.prefixes.length > 20);
  assert.ok(Unitsdb.dimensions.length > 50);
  assert.ok(Unitsdb.quantities.length > 100);
});

test("rejects non-units inputs", async () => {
  await assert.rejects(() => new Parser("10m").parse(), /failed to parse/);
});
