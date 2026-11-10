// Focused parity with unitsml-ruby spec/unitsml/quantity_spec.rb and
// spec/unitsml/conversion/integration_spec.rb (reference head 92b0f348).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConversionDefinition,
  ConversionError,
  DimensionMismatchError,
  IndeterminateResultError,
  Quantity,
  Rational,
  ScaleOperationError,
  parse,
  toCanonical,
  type ConversionModel,
} from "../dist/index.js";

const q = (value: string, expression: string) => Quantity.parse(value, expression);

function float64(fields: Partial<ConversionModel> & { id: string; initialUnit: string }): ConversionDefinition {
  return new ConversionDefinition({ kind: "Float64ConversionFrom", exact: true, attributes: {}, ...fields });
}
const degcFromK = () => float64({ id: "degC_from_K", initialUnit: "#NISTu5", finalAddend: "-273.15" });
const kFromDegc = (initialUnit = "#NISTu23") =>
  float64({ id: "K_from_degC", initialUnit, finalAddend: "273.15" });
const degfFromK = () =>
  float64({ id: "degF_from_K", initialUnit: "#NISTu5", initialAddend: "-273.15", multiplicand: "9", divisor: "5", finalAddend: "32" });

test("R-A2: kV * A equals the watt quantity", async () => {
  const product = (await q("10", "kV")).times(await q("5", "A"));
  assert.ok(product.equals(await q("50", "W")));
});

test("R-A2: V + s is a typed dimension mismatch", async () => {
  const v = await q("1", "V");
  const s = await q("1", "s");
  assert.throws(() => v.plus(s), DimensionMismatchError);
});

test("R-A2: J / s composes and equals 3 J/s", async () => {
  const quotient = (await q("12", "J")).dividedBy(await q("4", "s"));
  assert.ok(quotient.equals(await q("3", "J/s")));
});

test("R-A4: interval-scale quantities refuse scaling; differences are legal", async () => {
  const m = (await q("10", "m")).formula;
  const c = new Quantity(10, m, "interval");
  assert.throws(() => c.times(2), ScaleOperationError);
  const b = new Quantity(4, m, "interval");
  assert.ok(c.minus(b).value.equals(6));
});

test("R-A5: division by a zero quantity is indeterminate", async () => {
  const m = await q("1", "m");
  const zero = await q("0", "s");
  assert.throws(() => m.dividedBy(zero), IndeterminateResultError);
  assert.throws(() => m.dividedBy(0), IndeterminateResultError);
});

test("arithmetic: sums and the composed m/s expression", async () => {
  assert.ok((await q("3", "m")).plus(await q("2", "m")).value.equals(5));
  assert.equal((await q("3", "m")).dividedBy(await q("2", "s")).normText, "m/s");
});

test("a composed quotient converts exactly: 36 km / 1 h = 10 m/s", async () => {
  const speed = (await q("36", "km")).dividedBy(await q("1", "h"));
  assert.ok((await speed.convertTo("m/s")).value.equals(10));
});

test("definitions: fragment initialUnit resolves through the register", async () => {
  const converted = await (await q("20", "degC")).convertTo("K", { definitions: { K: kFromDegc() } });
  assert.ok(converted.value.equals(new Rational(29315n, 100n)));
});

test("definitions: chained with canonical data, 20 degC = 68 degF", async () => {
  const converted = await (await q("20", "degC")).convertTo("degF", { definitions: { degF: degfFromK() } });
  assert.ok(converted.value.equals(68));
});

test("definitions: same hop as canonical gives the same value", async () => {
  const t = await q("20", "degC");
  const canonical = (await t.convertTo("K")).value;
  const defined = (await t.convertTo("K", { definitions: { K: kFromDegc() } })).value;
  assert.ok(defined.equals(canonical));
});

test("definitions: disagreement with canonical data is a diagnostic", async () => {
  const wrong = float64({ id: "bad", initialUnit: "#NISTu5", finalAddend: "-273.16" });
  await assert.rejects(
    (await q("20", "K")).convertTo("degC", { definitions: { degC: wrong } }),
    (error: Error) => error instanceof ConversionError && /disagrees with canonical data for "degC".*definition/.test(error.message),
  );
});

test("definitions: affine definition at a power other than 1 is refused", async () => {
  const formula = await parse("degF^2");
  assert.throws(() => toCanonical(formula, { degF: degfFromK() }), /affine unit raised to power/);
});

test("definitions: SpecialConversionFrom is refused", async () => {
  const special: ConversionModel = { kind: "SpecialConversionFrom", id: "sp", initialUnit: "#x", attributes: {} };
  await assert.rejects(
    (await q("20", "degC")).convertTo("K", { definitions: { K: special } }),
    /SpecialConversionFrom "sp" is not/,
  );
});

test("definitions: initialUnit URI resolves through register references", async () => {
  const definition = kFromDegc("http://si-digital-framework.org/SI/units/degreeCelsius");
  const converted = await (await q("20", "degC")).convertTo("K", { definitions: { K: definition } });
  assert.ok(converted.value.equals(new Rational(29315n, 100n)));
});

test("definitions: difference semantics survive definitions", async () => {
  const difference = (await q("20", "degC")).minus(await q("15", "degC"));
  assert.ok((await difference.convertTo("K", { definitions: { K: kFromDegc() } })).value.equals(5));
});

test("definitions: round trip 20 degC -> K -> degC", async () => {
  const forward = await (await q("20", "degC")).convertTo("K", { definitions: { K: kFromDegc() } });
  const back = await forward.convertTo("degC", { definitions: { degC: degcFromK() } });
  assert.ok(back.value.equals(20));
});
