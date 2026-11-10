import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConversionDefinition,
  DimensionMismatchError,
  Quantity,
  Rational,
  ScaleOperationError,
  parse,
  parseConversionXml,
  toCanonical,
} from "../dist/index.js";

test("Rational parses lexical decimals and fractions exactly", () => {
  assert.equal(Rational.parse("273.15").toString(), "5463/20");
  assert.equal(Rational.parse("-0.5").toString(), "-1/2");
  assert.equal(Rational.parse("1e-3").toString(), "1/1000");
  assert.equal(Rational.parse("5/9").toString(), "5/9");
  assert.equal(Rational.parse("0.1").add(Rational.parse("0.2")).toDecimalString(), "0.3");
  assert.equal(Rational.parse("1").div(Rational.parse("3")).toDecimalString(), undefined);
  assert.equal(Rational.parse("1/4").sqrt()?.toString(), "1/2");
  assert.equal(Rational.parse("2").sqrt(), undefined);
  assert.throws(() => Rational.parse("12abc"), SyntaxError);
});

test("canonical conversion is exact and prefix powers scale with the unit", async () => {
  const km2 = toCanonical(await parse("km^2"));
  assert.ok(km2.factor.equals("1000000"));
  const quantity = await Quantity.parse("20", "degC");
  assert.equal(quantity.scale, "interval");
  assert.equal((await quantity.convertTo("K")).value.toDecimalString(), "293.15");
});

test("an absolute interval value cannot be scaled; its difference can", async () => {
  const warm = await Quantity.parse("20", "degC");
  const cool = await Quantity.parse("15", "degC");
  assert.throws(() => warm.scaledBy(2), ScaleOperationError);
  const difference = warm.minus(cool);
  assert.equal(difference.scale, "difference");
  const doubled = difference.scaledBy(2);
  assert.ok((await doubled.convertTo("K")).value.equals("10"));
});

test("conversion refuses incompatible dimensions and affine composites", async () => {
  const metres = await Quantity.parse("1", "m");
  await assert.rejects(metres.convertTo("s"), DimensionMismatchError);
  await assert.rejects(async () => toCanonical(await parse("degC*km")), /affine unit inside a composite/);
});

test("conversion XML keeps lexical decimals and refuses non-linear kinds", () => {
  const model = parseConversionXml(
    '<Float64ConversionFrom xml:id="x" initialUnit="#NISTu5" finalAddend="0.5729577951308232087679815481"/>',
  );
  assert.equal(model.finalAddend, "0.5729577951308232087679815481");
  assert.equal(model.exact, undefined);
  const definition = new ConversionDefinition(model);
  assert.equal(definition.exact, false);
  assert.ok(definition.inverse(definition.forward("1")).equals("1"));
  assert.throws(
    () => ConversionDefinition.fromXml('<SpecialConversionFrom xml:id="s" initialUnit="#x"/>'),
    /SpecialConversionFrom "s" is not executable/,
  );
});
