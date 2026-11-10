// Replays the full F40 UnitsML quantity vector set (unitsml-testsuite
// corpora/features/unitsml-quantities.json, produced by unitsml-ruby
// 92b0f348, vendored byte-for-byte and digest-pinned below) through the
// actual implementation. Every case runs; a case either matches exactly
// (value.rational string, unit, dimension_id, dimension_vector, scale;
// refusals by error class) or is listed in ACCOUNTED with the reason the
// TypeScript result differs. An unlisted mismatch, an unused account or a
// changed corpus digest fails.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Quantity } from "../dist/index.js";

const FILE = new URL("./fixtures/f40/unitsml-quantities.json", import.meta.url);
const DIGEST = "2cacb0b5b3c66f7c8a960b73e638b892afb86dd44ee4838371f132c2c5b60218";
// The digest is over the LF-normalized text, so a CRLF checkout still pins.
const text = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const corpus = JSON.parse(text);

// Typed or unsupported differences from the Ruby 92b0f348 producer. Each
// names the TypeScript outcome it requires.
const ACCOUNTED: Record<string, { reason: string; actual: unknown }> = {
  "dim-1": {
    reason: "Ruby raises an untyped NoMethodError (source bug, not blessed); TS evaluates the dimensionless expression 1",
    actual: { value: { rational: "1/1", decimal: "1" }, unit: "1", dimension_id: null, dimension_vector: null, scale: "ratio" },
  },
  "difference-degc": {
    reason: "Ruby 92b0f348 drops difference typing on conversion; unitsml-ruby 761fbdba keeps it (value 5 K agrees)",
    actual: { value: { rational: "5/1", decimal: "5" }, unit: "K", dimension_id: "NISTd5", dimension_vector: { ThermodynamicTemperature: 1 }, scale: "difference" },
  },
  "refuse-both-keywords": {
    reason: "Ruby keyword-argument refusal (unit: with unit_expression:); the TS constructor is positional, so the call cannot be expressed",
    actual: { unsupported: "keyword API" },
  },
};

const q = (value: string, unit: string | null) => (unit === null ? Promise.resolve(new Quantity(value)) : Quantity.parse(value, unit));

function snap(x: Quantity) {
  const vector = x.dimensionVector();
  return {
    value: { rational: x.value.toRubyString(), decimal: x.value.toDecimalString() },
    unit: x.normText,
    dimension_id: x.dimensionId() ?? null,
    dimension_vector: vector ? Object.fromEntries([...vector].sort(([a], [b]) => (a < b ? -1 : 1))) : null,
    scale: x.scale,
  };
}

// The producer records refusals by id; these are the operations each id
// names (error_message in the corpus confirms the operands).
const REFUSALS: Record<string, () => Promise<unknown>> = {
  "refuse-degc2-to-k2": async () => (await q("1", "degC^2")).convertTo("K^2"),
  "refuse-m-to-s": async () => (await q("1", "m")).convertTo("s"),
  "refuse-degc-to-k2": async () => (await q("1", "degC")).convertTo("K^2"),
  "refuse-v-plus-s": async () => (await q("1", "V")).plus(await q("1", "s")),
  "refuse-degc-times-2": async () => (await q("10", "degC")).times(2),
  "refuse-degc-times-degc": async () => (await q("10", "degC")).times(await q("2", "degC")),
  "refuse-div-zero-quantity": async () => (await q("1", "m")).dividedBy(await q("0", "s")),
  "refuse-div-zero-scalar": async () => (await q("1", "m")).dividedBy(0),
  "refuse-unknown-unit": async () => q("1", "notaunit_xyz"),
};

async function run(c: any): Promise<unknown> {
  const i = c.input;
  switch (c.kind) {
    case "convert":
      return snap(await (await q(i.value, i.unit)).convertTo(i.target));
    case "dimension":
      return snap(await q(i.value ?? "1", i.unit));
    case "difference":
      return snap(await (await q(i.high[0], i.high[1])).minus(await q(i.low[0], i.low[1])).convertTo(i.target));
    case "product": {
      const p = (await q(i.left[0], i.left[1])).times(await q(i.right[0], i.right[1]));
      return {
        product: snap(p),
        equals_50000_W: p.equals(await q("50000", "W")),
        equals_50_kW: p.equals(await q("50", "kW")),
        to_W: snap(await p.convertTo("W")),
        to_kW: snap(await p.convertTo("kW")),
      };
    }
    case "equality": {
      assert.equal(i.left, "10 kV * 5 A");
      assert.equal(i.right, "50 W");
      return { equal: (await q("10", "kV")).times(await q("5", "A")).equals(await q("50", "W")) };
    }
    case "refusal": {
      const operation = REFUSALS[c.id];
      if (!operation) return { unsupported: "keyword API" };
      return { unexpected: snap((await operation()) as Quantity) };
    }
    default:
      throw new Error(`unknown F40 case kind ${c.kind}`);
  }
}

const sorted = (o: any): any =>
  o && typeof o === "object" && !Array.isArray(o)
    ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted(o[k])]))
    : o;

test("F40 corpus digest and counts are the frozen input", () => {
  assert.equal(createHash("sha256").update(text).digest("hex"), DIGEST);
  assert.equal(corpus.cases.length, corpus.counts.cases);
  assert.equal(corpus.producer_source.commit, "92b0f3481cd90e8a7b50ba9bd729363bec150a21");
});

test("F40 unitsml quantity vectors: every case matches or is accounted", async () => {
  const used = new Set<string>();
  const failures: string[] = [];
  let matched = 0;
  for (const c of corpus.cases) {
    let actual: unknown;
    let errorClass: string | undefined;
    try {
      actual = await run(c);
    } catch (error) {
      errorClass = (error as Error).constructor.name;
      actual = { error: errorClass };
    }
    const account = ACCOUNTED[c.id];
    if (account) {
      used.add(c.id);
      if (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(account.actual))) {
        failures.push(`${c.id}: accounted outcome changed: ${JSON.stringify(actual)}`);
      }
      continue;
    }
    const ok =
      c.outcome === "error"
        ? errorClass !== undefined && errorClass === String(c.error_class).split("::").pop()
        : errorClass === undefined && JSON.stringify(sorted(actual)) === JSON.stringify(sorted(c.result));
    if (ok) matched += 1;
    else failures.push(`${c.id}: expected ${JSON.stringify(c.result ?? c.error_class)} got ${JSON.stringify(actual)}`);
  }
  for (const id of Object.keys(ACCOUNTED)) if (!used.has(id)) failures.push(`${id}: unused account`);
  assert.deepEqual(failures, []);
  assert.equal(matched + used.size, corpus.cases.length);
  assert.equal(matched, 36);
});

// Gaps closed beyond the corpus: Ruby's unchecked unlike-unit sums and
// absolute-minus-difference typing are not blessed.
test("sums and differences convert an operand in another unit exactly", async () => {
  const sum = (await q("1", "km")).plus(await q("1", "m"));
  assert.equal(sum.value.toRubyString(), "1001/1000");
  assert.equal(sum.normText, "km");
  const less = (await q("1", "mi")).minus(await q("1", "km"));
  assert.equal((await less.convertTo("m")).value.toRubyString(), "76168/125");
  const hot = (await q("20", "degC")).minus(await q("283.15", "K"));
  assert.equal(hot.scale, "difference");
  assert.equal((await hot.convertTo("K")).value.toRubyString(), "10/1");
});

test("absolute minus a difference stays absolute; two differences sum to a difference", async () => {
  const delta = (await q("20", "degC")).minus(await q("15", "degC"));
  const absolute = (await q("20", "degC")).minus(delta);
  assert.equal(absolute.scale, "interval");
  assert.equal((await absolute.convertTo("K")).value.toRubyString(), "5763/20");
  const both = delta.plus(delta);
  assert.equal(both.scale, "difference");
  assert.equal((await both.convertTo("K")).value.toRubyString(), "10/1");
  const raised = (await q("10", "degC")).plus(delta);
  assert.equal(raised.scale, "interval");
  assert.equal((await raised.convertTo("K")).value.toRubyString(), "5763/20");
  assert.throws(() => absolute.times(2), { name: "ScaleOperationError" });
});

test("exact rational quotients: no integer truncation", async () => {
  const speed = (await q("7", "m")).dividedBy(await q("2", "s"));
  assert.equal(speed.value.toRubyString(), "7/2");
  assert.equal((await q("7", "m")).dividedBy(2).value.toRubyString(), "7/2");
});
