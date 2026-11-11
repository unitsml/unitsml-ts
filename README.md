# unitsml-ts

UnitsML in TypeScript — the native port of
[unitsml-ruby](https://github.com/unitsml/unitsml-ruby), built on the
[asciiunits-ts](https://github.com/unitsml/asciiunits-ts) PARG runtime.
**No Opal** — this replaces the Opal-compiled `unitsml` npm
package.

Status: **core complete** — the parse pipeline (extras, sqrt→0.5 powers,
`/` and `//` exponent inversion, prefix-only instances) and the UnitsML
XML / AsciiMath renders match unitsml-ruby 0.6.11 on the frozen render
oracle (87/87 cases; `npm run replay`). The oracle lives in
https://github.com/unitsml/unitsml-testsuite[unitsml/unitsml-testsuite]
— the same frozen corpus unitsml-ruby replays; the two `kcal_IT` cases are excluded pending
an upstream mml fix. MathML, LaTeX, HTML and Unicode renders, and
plurimath integration, are follow-ups on the mml-ts/amath-ts wave.

## Quantities and conversions

Exact unit conversion ports unitsml-ruby `Unitsml::Conversion`,
`Conversion::Definition` and the conversion/difference part of
`Unitsml::Quantity`: BigInt-backed `Rational` values, UnitsDB
`canonical_conversion` data, prefix powers that scale with the unit power,
affine (temperature) offsets only on a lone power-1 unit, difference
quantities that convert without addends, and UnitsML
`Float64ConversionFrom` definitions (lexical decimals preserved,
`SpecialConversionFrom`/`WSDLConversionFrom` refused).

```ts
import { Quantity, ConversionDefinition } from "unitsml";

const t = await Quantity.parse("20", "degC");
(await t.convertTo("degF")).value.toDecimalString();          // "68"
const dt = t.minus(await Quantity.parse("15", "degC"));
(await dt.convertTo("K")).value.toString();                   // "5"
ConversionDefinition.fromXml(
  '<Float64ConversionFrom xml:id="d" initialUnit="#NISTu5" finalAddend="273.15"/>',
).forward("0").toDecimalString();                             // "273.15"
```

Errors are typed like the Ruby ones: `ConversionError`,
`DimensionMismatchError`, `ScaleOperationError`. Quantity products and
quotients with unit composition (Ruby `Quantity#*`/`#/`) are not ported
yet. The data comes from the `unitsdb` package: canonical conversion,
scale and reference-URI fields need a unitsdb release carrying the schema
2.2.0 projection.

Quantities can carry a data-declared kind, a UnitsDB quantity. Sums and
differences of two typed quantities need the same quantity or a shared
`equivalence_class`, so work plus heat is allowed but torque plus energy
raises `QuantityKindMismatchError`, although both have the same dimension.
Untyped quantities keep the dimension-only check. `QuantityKind.primaryFor`
picks a unit's primary quantity from the UnitsDB `primary` flag, never from
the order of its references.

A caller register supplies factors and affine offsets for units that
UnitsDB cannot convert. `withRegister` validates the entries first (exact
decimal or rational strings, a positive factor, dimensions matching the
unit's, agreement with UnitsDB canonical data within 1e-9) and applies them
only while its synchronous callback runs.

```ts
import { Parser, Quantity, withRegister } from "unitsml";

const work = await Quantity.parse(2, "J", { kind: "NISTq152" });
work.plus(await Quantity.parse(3, "J", { kind: "NISTq153" })); // QuantityKindMismatchError

const cwt = await Quantity.parse(2, "cwt (US)");
const kg = await new Parser("kg").parse();
withRegister([{ unit: "NISTu230", factor: "50", dimensions: { Mass: "1" } }],
  () => cwt.convertToFormula(kg).value.toString());             // "100"
```

`npm run replay:conversions` replays the shared
[unitsml-testsuite](https://github.com/unitsml/unitsml-testsuite)
`corpora/conversions` vectors (`CONVERSION_CORPUS_DIR`), the same cases
unitsml-ruby replays; every case kind runs and a missing corpus fails.

## Target shape

```
src/
├── parse/        AsciiUnits -> model (on asciiunits)
├── model/        Formula, Unit, Prefix, Dimension, Number, Fenced, Sqrt, Extender
├── render/       UnitsML XML, MathML, LaTeX, AsciiMath, Unicode, HTML
└── unitsdb/      UnitsDB data access (unitsdb npm)
```

## Behavioral contract

unitsml-ruby's spec suite is the porting oracle: for every input, the
parse tree, UnitsML XML, MathML, LaTeX, AsciiMath and Unicode renders must
match. The shared conformance corpora live in
[asciiunits-testsuite](https://github.com/unitsml/asciiunits-testsuite).

## Development

```sh
npm install
npm run build && npm test
```
