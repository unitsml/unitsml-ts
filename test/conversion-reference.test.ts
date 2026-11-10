// Focused parity with unitsml-ruby spec/unitsml/conversion_spec.rb
// (reference head 92b0f348): same inputs, same exact expectations.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConversionError,
  DimensionMismatchError,
  Quantity,
  Rational,
  ScaleOperationError,
} from "../dist/index.js";

const r = (n: bigint | number, d: bigint | number = 1) =>
  new Rational(BigInt(n), BigInt(d));

async function converted(value: string, from: string, to: string): Promise<Rational> {
  return (await (await Quantity.parse(value, from)).convertTo(to)).value;
}

const CASES: Array<[string, string, string, Rational]> = [
  ["0", "degC", "K", r(27315, 100)],
  ["100", "degC", "K", r(37315, 100)],
  ["32", "degF", "K", r(27315, 100)],
  ["1", "mi", "m", r(1609344, 1000)],
  ["1", "km", "m", r(1000)],
  ["2", "bar", "Pa", r(200000)],
  ["1", "kWh", "J", r(3600000)],
  ["1", "mi/h", "m/s", r(1609344, 1000).div(r(3600))],
  ["1", "km^2", "m^2", r(1000000)],
  ["1", "ft^2", "m^2", r(145161, 1562500)],
  ["1", "cm^3", "m^3", r(1, 1000000)],
];

for (const [value, from, to, expected] of CASES) {
  test(`R-A3: ${value} ${from} -> ${to}`, async () => {
    const actual = await converted(value, from, to);
    assert.ok(actual.equals(expected), `got ${actual}, expected ${expected}`);
  });
}

test("converted quantity carries the target expression", async () => {
  const kelvin = await (await Quantity.parse("0", "degC")).convertTo("K");
  assert.equal(kelvin.formula?.normText, "K");
});

test("rejects dimension-incompatible targets", async () => {
  await assert.rejects((await Quantity.parse("1", "mi")).convertTo("s"), DimensionMismatchError);
});

test("rejects affine units raised to powers", async () => {
  await assert.rejects((await Quantity.parse("1", "degC^2")).convertTo("K^2"), ConversionError);
});

test("rejects units without a canonical path", async () => {
  await assert.rejects((await Quantity.parse("1", "kn")).convertTo("m/s"), ConversionError);
});

test("difference typing: 20 degC - 15 degC = 5 K", async () => {
  const high = await Quantity.parse("20", "degC");
  const low = await Quantity.parse("15", "degC");
  const difference = high.minus(low);
  assert.equal(difference.scale, "difference");
  assert.ok((await difference.convertTo("K")).value.equals(r(5)));
  assert.equal(high.scale, "interval");
  assert.equal((await Quantity.parse("1", "m")).scale, "ratio");
  assert.throws(() => high.scaledBy(2), ScaleOperationError);
});
