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
