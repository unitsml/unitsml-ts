// Focused parity with unitsml-ruby spec/unitsml/quantity_composition_spec.rb
// (reference: unitsml-ruby 92b0f348 plus the difference-scale fix on
// claude-b/scalar-difference-scale). Line numbers cite that spec.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Dimension,
  DimensionMismatchError,
  Extender,
  Formula,
  IndeterminateResultError,
  InvalidUnitEntryError,
  MixedTermsError,
  Number_,
  ParseError,
  Prefix,
  Quantity,
  Rational,
  ScaleOperationError,
  Unit,
  parse,
  quantityProduct,
  toXml,
  type ModelNode,
  type QuantityScale,
} from "../dist/index.js";

async function q(unit: string | undefined, value: string | number = 1, scale?: QuantityScale): Promise<Quantity> {
  return new Quantity(value, unit === undefined ? undefined : await parse(unit), scale);
}

function leaves(nodes: ModelNode[], out: Array<Unit | Dimension> = []): Array<Unit | Dimension> {
  for (const node of nodes) {
    if (node instanceof Unit || node instanceof Dimension) out.push(node);
    else if (node instanceof Formula) leaves(node.value, out);
    else if (node && typeof node === "object" && "value" in node && node.value && typeof node.value === "object") {
      leaves([node.value as ModelNode], out);
    }
  }
  return out;
}

function power(leaf: Unit | Dimension): string | undefined {
  const p = leaf.powerNumerator;
  if (p === undefined) return undefined;
  return typeof p === "number" ? String(p) : String(p.rawValue);
}

/** leaf_powers / leaf_shape: [name, raw power] per Unit (or Dimension) leaf. */
function shape(quantity: Quantity): Array<[string, string | undefined]> {
  return leaves(quantity.formula?.value ?? []).map((leaf) => [
    leaf instanceof Unit ? leaf.unitName : leaf.dimensionName,
    power(leaf),
  ]);
}

const vector = (quantity: Quantity) => Object.fromEntries(quantity.dimensionVector() ?? []);
const value = (quantity: Quantity) => quantity.value.toString();
// Exact exponents as strings ("1/2"); null when there is no decomposition.
const exact = (quantity: Quantity) => {
  const vec = quantity.exactDimensionVector();
  return vec === undefined ? null : Object.fromEntries([...vec].map(([k, v]) => [k, v.toString()]));
};

// --- composition through the builder (spec :23) ---

test("builder: W/m * s composes structurally (:24)", async () => {
  const result = (await q("W/m", 6)).times(await q("s", 2));
  assert.equal(value(result), "12");
  assert.equal(result.normText, "W*m^(-1)*s");
  assert.deepEqual(shape(result), [["W", undefined], ["m", "-1"], ["s", undefined]]);
  assert.deepEqual(vector(result), { Length: 1, Mass: 1, Time: -2 });
});

test("builder: (J/s) / (m/s) (:34)", async () => {
  const result = (await q("J/s", 6)).dividedBy(await q("m/s", 2));
  assert.equal(value(result), "3");
  assert.equal(result.normText, "J*s^(-1)*m^(-1)*s");
  assert.deepEqual(shape(result), [["J", undefined], ["s", "-1"], ["m", "-1"], ["s", undefined]]);
  assert.deepEqual(vector(result), { Length: 1, Mass: 1, Time: -2 });
});

test("builder: simple quotient text and mixed-term rejection (:45, :49)", async () => {
  assert.equal((await q("m")).dividedBy(await q("s")).normText, "m/s");
  await assert.rejects(async () => (await q("dim_L")).times(await q("m")), MixedTermsError);
});

// --- unit entry points (spec :55, the parts with a TS counterpart) ---

test("entry points: a Unit and a Formula construct alike; nil is a pure number (:58, :88)", async () => {
  const fromUnit = new Quantity(2, new Unit("m"));
  const fromFormula = await q("m", 2);
  assert.equal(fromUnit.normText, fromFormula.normText);
  assert.deepEqual(vector(fromUnit), vector(fromFormula));
  assert.equal(new Quantity(3).formula, undefined);
  assert.equal(new Quantity(3, undefined).normText, "3");
});

test("entry points: a Formula is kept without reparsing (:67)", async () => {
  const formula = await parse("m");
  assert.equal(new Quantity(1, formula).formula, formula);
});

test("entry points: a direct Dimension or another object is a typed :unit error (:106, :258)", () => {
  for (const bad of [new Dimension("dim_L"), "m", {}]) {
    assert.throws(
      () => new Quantity(1, bad as unknown as Formula),
      (error: unknown) => error instanceof InvalidUnitEntryError && error.field === "unit" && error.value === bad,
    );
  }
});

// --- bare Unit, Dimension and Formula operands (spec :131) ---

test("operands: multiplies and divides by a Unit, keeping the magnitude (:161)", () => {
  const metre = new Unit("m");
  const second = new Unit("s");
  const product = new Quantity(6, metre).times(second);
  const quotient = new Quantity(6, metre).dividedBy(second);
  assert.deepEqual([value(product), shape(product)], ["6", [["m", undefined], ["s", undefined]]]);
  assert.deepEqual([value(quotient), shape(quotient)], ["6", [["m", undefined], ["s", "-1"]]]);
});

test("operands: multiplies and divides by a Formula, keeping the magnitude (:171)", async () => {
  const speed = quantityProduct(await parse("m"), await parse("s"), "/") as Formula;
  const product = (await q("m", 6)).times(speed);
  const quotient = (await q("m", 6)).dividedBy(speed);
  assert.deepEqual([value(product), shape(product)], ["6", [["m", undefined], ["m", undefined], ["s", "-1"]]]);
  assert.deepEqual([value(quotient), shape(quotient)], ["6", [["m", undefined], ["m", "-1"], ["s", undefined]]]);
});

test("operands: divides a pure number by a Unit (:181)", () => {
  const result = new Quantity(5).dividedBy(new Unit("s"));
  assert.deepEqual([value(result), shape(result)], ["5", [["s", "-1"]]]);
});

test("operands: composes dimension-only operands (:187)", () => {
  const dimL = new Dimension("dim_L");
  const formula = quantityProduct(undefined, new Formula([dimL]), "*") as Formula;
  const result = new Quantity(6, formula).times(dimL);
  assert.equal(value(result), "6");
  assert.deepEqual(shape(result), [["dim_L", undefined], ["dim_L", undefined]]);
});

test("operands: still rejects mixing units and dimensions (:196)", async () => {
  const dimL = new Dimension("dim_L");
  const dimensional = new Quantity(2, quantityProduct(undefined, new Formula([dimL]), "*"));
  await assert.rejects(async () => (await q("m", 6)).dividedBy(dimL), MixedTermsError);
  assert.throws(() => dimensional.times(new Unit("m")), MixedTermsError);
});

test("operands: nil, a String, an Extender and plain objects are typed :operand errors (:206)", async () => {
  const base = await q("m", 6);
  for (const bad of [null, undefined, "s", new Extender("*"), {}, Object.create(null)]) {
    for (const op of ["times", "dividedBy"] as const) {
      assert.throws(
        () => base[op](bad as unknown as Quantity),
        (error: unknown) => error instanceof InvalidUnitEntryError && error.field === "operand" && error.value === bad,
        `${op}(${String(typeof bad)})`,
      );
    }
  }
});

test("operands: Quantity operands keep their scale gates (:219)", async () => {
  const interval = await q("K", 10, "interval");
  const speed = quantityProduct(await parse("m"), await parse("s"), "/") as Formula;
  assert.equal(value((await q("m", 2)).times(await q("s", 3))), "6");
  assert.throws(() => interval.times(new Unit("s")), ScaleOperationError);
  assert.throws(() => interval.dividedBy(speed), ScaleOperationError);
});

test("operands: zero dividend is fine, zero divisor indeterminate (:229)", async () => {
  assert.equal(value((await q("m", 0)).dividedBy(new Unit("s"))), "0");
  await assert.rejects(async () => (await q("m")).dividedBy(await q("s", 0)), IndeterminateResultError);
});

test("operands: the result has its own tree and leaves operands untouched (:240, :248)", async () => {
  const metre = new Unit("m");
  const speed = quantityProduct(await parse("m"), await parse("s"), "/") as Formula;
  const quantity = await q("m", 6);
  const snapshot = () => [toXml(quantity.formula!), toXml(speed), JSON.stringify(leaves(speed.value).map(power)), metre.unitName, metre.powerNumerator];
  const before = snapshot();
  for (const result of [quantity.times(metre), quantity.dividedBy(speed)]) {
    assert.notEqual(result.formula, speed);
    assert.notEqual(result.formula, quantity.formula);
    const first = result.formula!.value[0] as Unit;
    first.powerNumerator = new Number_("9");
    result.formula!.value.length = 0;
  }
  assert.deepEqual(snapshot(), before);
});

// --- gates (spec :264) ---

test("gates: scalar and quantity scale gates on interval quantities (:265)", async () => {
  const interval = await q("K", 10, "interval");
  assert.throws(() => interval.times(2), ScaleOperationError);
  assert.throws(() => interval.dividedBy(2), ScaleOperationError);
  assert.throws(() => interval.times(new Quantity(1, new Unit("s"))), ScaleOperationError);
  assert.throws(() => new Quantity(1, new Unit("s")).dividedBy(interval), ScaleOperationError);
});

test("gates: zero Numeric and zero Quantity divisors (:276)", async () => {
  const m = await q("m");
  assert.throws(() => m.dividedBy(0), IndeterminateResultError);
  assert.throws(() => m.dividedBy(new Quantity(0, new Unit("s"))), IndeterminateResultError);
  assert.throws(() => m.dividedBy(new Quantity(0)), IndeterminateResultError);
});

test("gates: + and - take only quantities (:285)", async () => {
  const m = await q("m");
  assert.throws(() => m.minus(1 as unknown as Quantity), TypeError);
  assert.throws(() => m.plus(new Unit("m") as unknown as Quantity), TypeError);
});

test("gates: difference typing survives scaling and conversion (:291, :300)", async () => {
  const a = await q("K", 10, "interval");
  const b = await q("K", 2, "interval");
  assert.equal(a.minus(b).scale, "difference");
  assert.equal(value(a.minus(b).times(2)), "16");

  const difference = (await q("degC", 20)).minus(await q("degC", 15));
  const doubled = difference.times(2);
  const halved = difference.dividedBy(2);
  assert.deepEqual([doubled.scale, halved.scale], ["difference", "difference"]);
  assert.equal(value(await doubled.convertTo("K")), "10");
  assert.ok((await halved.convertTo("K")).value.equals(Rational.from("5/2")));
  const inKelvin = await difference.convertTo("K");
  assert.equal(inKelvin.scale, "difference");
  assert.equal(value(await inKelvin.times(3).convertTo("degC")), "15");
  assert.equal((await q("m", 3)).times(2).scale, "ratio");
});

// --- pure numbers (spec :318) ---

test("pure numbers: scaling, either-side composition, lone divisor (:319-:345)", async () => {
  const scaled = new Quantity(4).times(2);
  assert.deepEqual([value(scaled), vector(scaled), scaled.formula], ["8", {}, undefined]);
  assert.deepEqual(vector(new Quantity(5).dividedBy(await q("s", 2))), { Time: -1 });
  assert.deepEqual(vector((await q("s", 4)).dividedBy(new Quantity(2))), { Time: 1 });
  assert.deepEqual(vector(new Quantity(4).times(await q("s"))), { Time: 1 });
  assert.equal((await q("s")).times(new Quantity(4)).normText, "s");
  const inverted = new Quantity(1).dividedBy(await q("s"));
  assert.ok(inverted.formula!.value[0] instanceof Unit);
  assert.equal(inverted.normText, "s^(-1)");
  assert.equal(new Quantity(4).times(new Quantity(2)).formula, undefined);
  assert.equal(value(new Quantity(4).dividedBy(new Quantity(2))), "2");
  assert.deepEqual(vector((await q("m", 6)).dividedBy(await q("m", 2))), {});
});

// --- chained arithmetic (spec :350) ---

test("chained: formulas carry through +, -, * and / (:351)", async () => {
  const speed = (await q("m", 10)).dividedBy(await q("s", 2));
  const summed = speed.plus((await q("m", 3)).dividedBy(await q("s", 1))).minus((await q("m", 2)).dividedBy(await q("s", 1)));
  const result = summed.times(await q("s", 2)).dividedBy(2);
  assert.equal(value(result), "6");
  assert.deepEqual(vector(result), { Length: 1 });
  assert.equal(result.normText, "m*s^(-1)*s");
});

// --- operand isolation (spec :362) ---

test("isolation: composition does not mutate either operand (:363)", async () => {
  const a = await q("km^2", 4);
  const b = await q("s^((-2))", 2);
  const snap = () => [toXml(a.formula!), toXml(b.formula!), a.normText, b.normText];
  const before = snap();
  for (const r of [a.times(b), a.dividedBy(b), b.dividedBy(a)]) r.dimensionVector();
  assert.deepEqual(snap(), before);
});

test("isolation: scalar and additive results get independent trees (:373, :390)", async () => {
  const a = await q("km^2", 4);
  const b = await q("km^2", 2);
  const leaf = a.formula!.value[0] as Unit;
  for (const result of [a.times(2), a.dividedBy(2), a.plus(b), a.minus(b)]) {
    assert.notEqual(result.formula, a.formula);
    assert.equal(result.normText, "km^2");
    const first = result.formula!.value[0] as Unit;
    assert.notEqual(first, leaf);
    first.powerNumerator = new Number_("9");
    first.prefix = new Prefix("m");
    result.formula!.normText = "changed";
    result.formula!.value.length = 0;
  }
  assert.equal(a.formula!.value[0], leaf);
  assert.deepEqual([power(leaf), leaf.prefix?.prefixName, a.normText], ["2", "k", "km^2"]);
});

// --- unknown text (spec :470) ---

test("unknown text: an unknown unit or prefix is the parser's failure (:471)", async () => {
  for (const source of ["foo", "xm"]) {
    await assert.rejects(() => Quantity.parse(1, source), ParseError);
  }
});

// --- baseline replay (spec :484): pinned existing behaviour, deferred #82 ---

const joule = { Length: 2, Mass: 1, Time: -2 };

test("baseline: recorded arithmetic rows (:519)", async () => {
  const rows: Array<[string, string, "times" | "dividedBy", string, Record<string, number>]> = [
    ["W/m", "s", "times", "W*m^(-1)*s", { Length: 1, Mass: 1, Time: -2 }],
    ["J/s", "m/s", "dividedBy", "J*s^(-1)*m^(-1)*s", { Length: 1, Mass: 1, Time: -2 }],
    ["m", "W/m", "dividedBy", "m*W^(-1)*m", { Mass: -1, Time: 3 }],
    ["W", "m*s", "dividedBy", "W*m^(-1)*s^(-1)", { Length: 1, Mass: 1, Time: -4 }],
    ["m", "s", "dividedBy", "m/s", { Length: 1, Time: -1 }],
  ];
  for (const [left, right, op, text, vec] of rows) {
    const result = (await q(left))[op](await q(right));
    assert.deepEqual([value(result), result.normText, vector(result)], ["1", text, vec], `${left} ${op} ${right}`);
  }
});

// Ruby (spec :527/:536/:574/:580) truncates fractional exponents with
// to_i and drops powers on derived units (m^(1/2) a length, sqrt(m)
// dimensionless, J^(1/2) a joule). Those rows are not reproduced: the
// exponents stay exact, an integer-only dimensionVector() is undefined for
// fractional ones, and a root the decomposition cannot see through is
// unknown rather than dimensionless.
test("exact roots/fractions: dimension vectors (Ruby :527 diverges)", async () => {
  const rows: Record<string, Record<string, string> | null> = {
    "m^(1/2)": { Length: "1/2" }, "J^(1/2)": { Length: "1", Mass: "1/2", Time: "-1" },
    J: { Length: "2", Mass: "1", Time: "-2" }, "dim_L*dim_M": {}, "sqrt(m)": { Length: "1/2" },
    "s/sqrt(m)": { Time: "1", Length: "-1/2" }, "Hz^(1/2)": { Time: "-1/2" },
    "m^(1/3)": { Length: "1/3" }, "sqrt(m*s)": null, "sqrt((m*s))": null,
    "sqrt(sqrt(m))": null, "sqrt(dim_L)": null, "1/sqrt(m)": null,
  };
  for (const [source, vec] of Object.entries(rows)) assert.deepEqual(exact(await q(source)), vec, source);
  assert.equal((await q("sqrt(m)")).dimensionVector(), undefined);
  assert.deepEqual(vector(await q("J")), joule);
});

test("exact roots/fractions: dimension ids and fractional product (Ruby :536 diverges)", async () => {
  assert.equal((await q("m^(1/2)")).dimensionId(), undefined);
  assert.equal((await q("sqrt(m)")).dimensionId(), undefined);
  assert.equal((await q("J^(1/2)")).dimensionId(), undefined);
  const square = (await q("m^(1/2)")).times(await q("m^(1/2)"));
  assert.deepEqual(vector(square), { Length: 1 });
  assert.equal(square.dimensionId(), "NISTd1");
  await assert.rejects(async () => (await q("sqrt(m)")).plus(await q("sqrt(s)")), DimensionMismatchError);
  assert.equal((await q("sqrt(m)", 2)).plus(await q("sqrt(m)", 3)).value.toString(), "5");
});

test("baseline: recorded dimension-leaf rows (:543)", async () => {
  assert.equal(value((await q("dim_L")).plus(new Quantity(2))), "3");
  await assert.rejects(async () => (await q("dim_L")).plus(await q("m")), DimensionMismatchError);
  await assert.rejects(async () => (await q("dim_L")).times(await q("m")), MixedTermsError);
  const quotient = (await q("dim_M")).dividedBy(await q("dim_L"));
  assert.equal(toXml(quotient.formula!), toXml(await parse("dim_M/dim_L")));
});

test("baseline: recorded interval and ratio scale rows (:559, :568)", async () => {
  const interval = (v: number) => q("K", v, "interval");
  const diff = (await interval(10)).minus(await interval(2));
  assert.equal(diff.scale, "difference");
  assert.equal(value(diff.times(2)), "16");
  await assert.rejects(async () => (await interval(10)).times(2), ScaleOperationError);
  assert.equal((await q("K", 10)).plus(await interval(2)).scale, "ratio");
  assert.equal((await q("m", 2)).times(await q("s", 3)).scale, "ratio");
});

test("fenced-power product vectors (Ruby :574 truncates the halves)", async () => {
  const halves = { Length: "1/2", Time: "1" };
  assert.deepEqual(exact((await q("m^((1/2))")).times(await q("s"))), halves);
  assert.deepEqual(exact((await q("m^(1/2)")).times(await q("s"))), halves);
  const rows: Record<string, Record<string, number>> = {
    "m^-1": { Length: -1, Time: 1 },
    "g^((((3))))": { Mass: 3, Time: 1 },
    "m^((-2))": { Length: -2, Time: 1 },
    "K^(((-1)))": { Time: 1, ThermodynamicTemperature: -1 },
  };
  for (const [source, vec] of Object.entries(rows)) {
    assert.deepEqual(vector((await q(source)).times(await q("s"))), vec, source);
  }
});

test("baseline: recorded scalar and pure-number rows (:580, :588)", async () => {
  const rows: Array<[string | undefined, Record<string, number>]> = [
    ["m", { Length: 1 }], [undefined, {}],
  ];
  for (const source of ["sqrt(m)", "m^(1/2)"]) {
    const result = (await q(source, 4)).times(2);
    assert.deepEqual([value(result), exact(result)], ["8", { Length: "1/2" }], source);
  }
  for (const [source, vec] of rows) {
    const result = (await q(source, 4)).times(2);
    assert.deepEqual([value(result), vector(result)], ["8", vec], String(source));
  }
  assert.deepEqual(vector(new Quantity(5).dividedBy(await q("s", 2))), { Time: -1 });
  assert.deepEqual(vector((await q("s", 4)).dividedBy(new Quantity(2))), { Time: 1 });
  assert.deepEqual(vector(new Quantity(4).times(new Quantity(2))), {});
});

// --- entry points: composed Formula operand (spec :75) ---

test("entry points: accepts a composed Formula operand (:75)", async () => {
  const formula = new Quantity(1, new Unit("W")).dividedBy(new Unit("m")).formula!;
  const result = new Quantity(6, formula).times(await q("s", 2));
  assert.deepEqual([value(result), result.normText, vector(result)], [
    "12", "W*m^(-1)*s", { Length: 1, Mass: 1, Time: -2 },
  ]);
});

// --- operand isolation: no shared mutable state (spec :422) ---

function mutableParts(nodes: ModelNode[]): Set<object> {
  const out = new Set<object>();
  for (const leaf of leaves(nodes)) {
    out.add(leaf);
    if (leaf.powerNumerator && typeof leaf.powerNumerator === "object") out.add(leaf.powerNumerator);
    if (leaf instanceof Unit && leaf.prefix) out.add(leaf.prefix);
  }
  return out;
}

test("isolation: results share no mutable leaf, exponent or prefix objects (:422)", async () => {
  const a = await q("km^((2))", 4);
  const b = await q("ms^-1", 2);
  const source = new Set([...mutableParts(a.formula!.value), ...mutableParts(b.formula!.value)]);
  for (const result of [a.times(b), a.dividedBy(b), b.dividedBy(a), a.times(3), a.plus(a)]) {
    const shared = [...mutableParts(result.formula!.value)].filter((part) => source.has(part));
    assert.deepEqual(shared, [], result.normText);
  }
});

// --- parser independence after operand setup (spec :432) ---
// The TS constructor is synchronous and never parses; only Quantity.parse
// reaches the (async) parser, so object operands combine without parsing.

test("parser independence: object operands build and combine without parsing (:442, :451)", () => {
  const formula = new Quantity(1, new Unit("m")).dividedBy(new Unit("s")).formula!;
  const a = new Quantity(4, formula);
  const b = new Quantity(2, new Unit("m"));
  const dim = new Dimension("dim_L");
  const d = new Quantity(2, new Quantity(1).times(dim).times(dim).formula);
  const results = [
    a.times(b), a.dividedBy(b), a.times(2), a.dividedBy(2), a.plus(a), a.minus(a),
    a.times(new Unit("m")), a.dividedBy(new Unit("s")), a.times(formula), a.dividedBy(formula), d.times(dim),
  ];
  for (const result of results) {
    assert.ok(result instanceof Quantity);
    assert.ok(result.formula instanceof Formula);
  }
});

test("parser independence: String entries go only through Quantity.parse (:460)", async () => {
  assert.throws(
    () => new Quantity(1, "m" as unknown as Unit),
    (error: unknown) => error instanceof InvalidUnitEntryError && error.field === "unit" && error.value === "m",
  );
  assert.equal((await Quantity.parse(1, "m")).normText, "m");
});

// --- parsed dimension division (composite_spec "parsed dimension division",
// unitsml-ruby 7595cc1; needed by the :543 dimension-leaf row) ---

test("parsed dimension division inverts the dimension after / (composite_spec 7595cc1)", async () => {
  for (const [text, id] of [["dim_L/dim_T", "D_LT-1"], ["dim_L/dim_T^2", "D_LT-2"], ["dim_M/dim_L^-3", "D_L3M"]]) {
    assert.ok(toXml(await parse(text)).includes(`xml:id="${id}"`), text);
  }
  assert.equal(toXml(await parse("dim_L/dim_T")), toXml(await parse("dim_L*dim_T^-1")));
  const quotient = new Quantity(2, await parse("dim_L")).dividedBy(new Quantity(1, await parse("dim_T")));
  assert.equal(quotient.normText, "dim_L*dim_T^(-1)");
});
