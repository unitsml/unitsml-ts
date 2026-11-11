// Replays the F40 Ruby-oracle feature vectors (unitsml-testsuite
// corpora/features/ruby-unitsml-features/v1/vectors.json at d5d0da86,
// produced by unitsml-ruby 2337a12 on unitsdb 2.2.13 data; vendored
// byte-for-byte and digest-pinned below) through the public API: data-
// declared quantity kinds (equivalence_class gating), primary-quantity
// selection by the UnitsDB primary flag under three reference orders, and
// validated caller registers. Every case must match; none is accounted.
// Ruby wires Integer as a plain number and Rational as {rational:[n,d]};
// both are compared as exact rationals.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  InvalidUnitRegisterError,
  Parser,
  PrimaryQuantityError,
  Quantity,
  QuantityKind,
  QuantityKindMismatchError,
  Rational,
  Register,
  Unitsdb,
  currentRegister,
  quantityXml,
  withRegister,
} from "../dist/index.js";

const FILE = new URL("./fixtures/f40/ruby-unitsml-features-v1.json", import.meta.url);
const DIGEST = "3aadf68a23261bf159a8344d1095201d38a11d854cb1d685929a536587ee2398";
const text = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const corpus = JSON.parse(text);

type Wire = number | string | { rational: [string, string] };
const exact = (wire: Wire): Rational =>
  typeof wire === "object" ? Rational.parse(`${wire.rational[0]}/${wire.rational[1]}`) : Rational.from(String(wire));
const shortName = (name: string): string => name.split("::").pop()!;
const OPS: Record<string, "plus" | "minus" | "times" | "dividedBy"> = { "+": "plus", "-": "minus", "*": "times", "/": "dividedBy" };

async function outcome(call: () => Promise<Record<string, unknown>> | Record<string, unknown>) {
  try {
    return await call();
  } catch (error) {
    return { error: (error as Error).name };
  }
}

async function runKind(c: any) {
  const e = c.expected;
  if (c.id === "kind-dimension-mismatch" || c.id === "kind-unknown") {
    return outcome(async () => (await Quantity.parse(1, e.unit, { kind: e.kind }), { outcome: "ok" }));
  }
  const { left, right } = c.input;
  return outcome(async () => {
    const a = await Quantity.parse(left.value, left.unit, { kind: left.kind ?? undefined });
    const b = await Quantity.parse(right.value, right.unit, { kind: right.kind ?? undefined });
    const sum = a.plus(b);
    return { value: sum.value, unit: sum.normText, kind: sum.kind?.id };
  });
}

type Node = { q: Quantity } | { op: string; l: Node; r: Node };
async function prepare(ast: any, bindings: any): Promise<Node> {
  if (ast.type === "variable") {
    const b = bindings[ast.name];
    return { q: await Quantity.parse(b.value, b.unit, b.difference ? { scale: "difference" } : {}) };
  }
  return { op: ast.operator, l: await prepare(ast.left, bindings), r: await prepare(ast.right, bindings) };
}
const compute = (node: Node): Quantity =>
  "q" in node ? node.q : (compute(node.l)[OPS[node.op]] as (o: Quantity) => Quantity).call(compute(node.l), compute(node.r));

async function runRegister(c: any) {
  const req = c.input.request;
  return outcome(async () => {
    const tree = await prepare(req.ast, req.bindings);
    const target = req.convert_to ? await new Parser(req.convert_to).parse() : undefined;
    const run = () => {
      const value = compute(tree);
      const out: Record<string, unknown> = { value: value.value, unit: value.normText, scale: value.scale };
      if (target) {
        const converted = value.convertToFormula(target);
        out.converted_value = converted.value;
        out.converted_unit = converted.normText;
      }
      return out;
    };
    return "register" in req ? withRegister(req.register, run) : run();
  });
}

test("the vendored Ruby feature vectors are the pinned d5d0da86 corpus", () => {
  assert.equal(createHash("sha256").update(text).digest("hex"), DIGEST);
  assert.equal(corpus.count, 251);
  assert.equal(corpus.cases.length, 251);
});

test("every quantity_kinds vector matches the Ruby oracle", async () => {
  const cases = corpus.cases.filter((c: any) => c.family === "quantity_kinds");
  assert.equal(cases.length, 124);
  for (const c of cases) {
    const got: any = await runKind(c);
    const e = c.expected;
    if (e.outcome === "error") {
      assert.equal(got.error, shortName(e.error_class), c.id);
    } else {
      assert.equal(got.error, undefined, `${c.id}: ${got.error}`);
      assert.ok(exact(e.value).equals(got.value), c.id);
      assert.equal(got.unit, e.unit, c.id);
      assert.equal(got.kind, e.kind, c.id);
    }
  }
});

test("every primary_quantity vector matches, under data, reversed and rotated order", () => {
  const cases = corpus.cases.filter((c: any) => c.family === "primary_quantity");
  assert.equal(cases.length, 95);
  for (const c of cases) {
    const e = c.expected;
    const record = Unitsdb.findUnitById(e.unit)!;
    const refs = record.quantity_references ?? [];
    assert.deepEqual(refs.map((r) => r.id).sort(), c.input.references, c.id);
    const orders = { data: refs, reversed: [...refs].reverse(), rotated: [...refs.slice(1), refs[0]] };
    const picks = Object.fromEntries(
      Object.entries(orders).map(([k, order]) => [k, QuantityKind.primaryFor({ ...record, quantity_references: order })!.id]),
    );
    assert.deepEqual(picks, e.by_order, c.id);
    assert.equal(picks.data, e.primary, c.id);
    assert.equal(new Set(Object.values(picks)).size === 1, e.order_independent, c.id);
    assert.equal(refs[0].id === picks.data, e.first_reference_is_primary, c.id);
  }
});

test("every caller_register vector matches the Ruby oracle", async () => {
  const cases = corpus.cases.filter((c: any) => c.family === "caller_register");
  assert.equal(cases.length, 32);
  for (const c of cases) {
    const got: any = await runRegister(c);
    const e = c.expected;
    if (e.outcome === "error") {
      assert.equal(got.error, shortName(e.error_class), c.id);
      continue;
    }
    assert.equal(got.error, undefined, `${c.id}: ${got.error}`);
    assert.ok(exact(e.value).equals(got.value), c.id);
    assert.equal(got.unit, e.unit, c.id);
    assert.equal(got.scale, e.scale.symbol, c.id);
    if (e.converted_value !== undefined) {
      assert.ok(exact(e.converted_value).equals(got.converted_value), c.id);
      assert.equal(got.converted_unit, e.converted_unit, c.id);
    }
  }
});

test("a register is scoped to the callback and never persists", async () => {
  const x = await Quantity.parse(2, "cwt (US)");
  const kg = await new Parser("kg").parse();
  const entries = [{ unit: "NISTu230", factor: "50", dimensions: { Mass: "1" } }];
  assert.equal(withRegister(entries, () => x.convertToFormula(kg)).value.toString(), "100");
  assert.equal(currentRegister(), undefined);
  assert.throws(() => x.convertToFormula(kg), { name: "ConversionError" });
  // the scope is restored even when the callback throws
  assert.throws(() => withRegister(entries, () => { throw new RangeError("boom"); }), RangeError);
  assert.equal(currentRegister(), undefined);
  // nested scopes restore the outer register
  withRegister(entries, () => {
    withRegister([], () => assert.ok(currentRegister()));
    assert.equal(x.convertToFormula(kg).value.toString(), "100");
  });
});

test("withRegister refuses an async callback rather than leaking across awaits", () => {
  assert.throws(() => withRegister([], async () => 1), TypeError);
  assert.equal(currentRegister(), undefined);
});

test("a validated Register instance can be reused; validation happens up front", () => {
  const register = new Register([{ unit: "cwt (US)", factor: "1/3", dimensions: { Mass: "1" } }]);
  assert.equal(register.empty, false);
  assert.throws(() => new Register([{ unit: "kg", factor: "50", dimensions: { Mass: "1" }, extra: 1 }]), InvalidUnitRegisterError);
  assert.ok(new InvalidUnitRegisterError("x") instanceof Error);
});

test("kind: QuantityKind.PRIMARY selects the unit's primary quantity; equality respects kinds", async () => {
  const joule = await Quantity.parse(1, "J", { kind: QuantityKind.PRIMARY });
  assert.equal(joule.kind?.id, QuantityKind.primaryFor(Unitsdb.findUnitBySymbolId("J")!)!.id);
  const torque = await Quantity.parse(1, "J", { kind: "NISTq184" });
  const work = await Quantity.parse(1, "J", { kind: "NISTq152" });
  const untyped = await Quantity.parse(1, "J");
  assert.equal(torque.equals(work), false);
  assert.equal(torque.equals(untyped), true);
  assert.throws(() => torque.plus(work), QuantityKindMismatchError);
  // kinds survive scaling and conversion
  assert.equal(work.scaledBy(2).kind?.id, "NISTq152");
  assert.equal(work.dividedBy(2).kind?.id, "NISTq152");
  assert.equal((await work.convertTo("kJ")).kind?.id, "NISTq152");
  // a composite expression names no single unit, so PRIMARY is refused
  await assert.rejects(Quantity.parse(1, "N*m", { kind: QuantityKind.PRIMARY }), { name: "UnknownQuantityKindError" });
});

test("primaryFor refuses a register defect instead of picking by position", () => {
  const ids = [{ type: "nist", id: "X" }];
  assert.throws(() => QuantityKind.primaryFor({ identifiers: ids, quantity_references: [{ id: "NISTq1" }, { id: "NISTq2" }] }), PrimaryQuantityError);
  assert.throws(
    () => QuantityKind.primaryFor({ identifiers: ids, quantity_references: [{ id: "NISTq1", primary: true }, { id: "NISTq2", primary: true }] }),
    PrimaryQuantityError,
  );
  assert.equal(QuantityKind.primaryFor({ identifiers: ids, quantity_references: [{ id: "NISTq1" }] })!.id, "NISTq1");
  assert.equal(QuantityKind.primaryFor({ identifiers: ids, quantity_references: [] }), undefined);
});

// Source-reference cases from unitsml-ruby c4821ee
// (spec/unitsml/quantity_kind_spec.rb "never promotes a sole reference marked
// primary: false" and the three cases after it). Presence and absence of the
// flag are distinct: absent keeps the sole-reference inference, false never
// promotes.
test("c4821ee: a sole reference marked primary: false is never promoted", () => {
  assert.throws(
    () => QuantityKind.primaryFor({ identifiers: [], quantity_references: [{ id: "NISTq1", primary: false }] }),
    { name: "PrimaryQuantityError", message: /primary: false/ },
  );
});

test("c4821ee: a sole reference whose flag is absent is taken (null counts as absent)", () => {
  const absent = { id: "NISTq1" };
  assert.equal("primary" in absent, false);
  assert.equal(QuantityKind.primaryFor({ identifiers: [], quantity_references: [absent] })!.id, "NISTq1");
  assert.equal(QuantityKind.primaryFor({ identifiers: [], quantity_references: [{ id: "NISTq1", primary: null }] })!.id, "NISTq1");
});

test("c4821ee: the true flag is selected among explicit false siblings", () => {
  const refs = [["NISTq1", false], ["NISTq48", true], ["NISTq95", false]].map(([id, primary]) => ({ id: id as string, primary: primary as boolean }));
  assert.equal(QuantityKind.primaryFor({ identifiers: [], quantity_references: refs })!.id, "NISTq48");
});

test("c4821ee: render selection still reads the first reference, not the primary", () => {
  const record = Unitsdb.findUnitBySymbolId("J")!;
  const first = record.quantity_references![0].id;
  assert.notEqual(first, QuantityKind.primaryFor(record)!.id);
  // the render helpers (quantityXml / unitDimensionId) are untouched: a
  // multi-reference unit renders no quantity without an explicit instance,
  // and a sole-reference unit renders its only reference
  assert.equal(quantityXml("J", undefined), undefined);
  const kilogram = Unitsdb.findUnitBySymbolId("kg")!;
  assert.equal(kilogram.quantity_references!.length, 1);
  assert.ok(quantityXml("kg", undefined)!.includes(kilogram.quantity_references![0].id));
});
