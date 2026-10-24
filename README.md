# unitsml-ts

UnitsML in TypeScript — the native port of
[unitsml-ruby](https://github.com/unitsml/unitsml-ruby), built on the
[asciiunits-ts](https://github.com/unitsml/asciiunits-ts) PARG runtime.
**No Opal** — this replaces the Opal-compiled `@unitsml/unitsml` npm
package.

Status: **scaffold** — the port is owned by @suleman-uzair; the checklist
lives in the open issues.

## Target shape

```
src/
├── parse/        AsciiUnits -> model (on @unitsml/asciiunits-ts)
├── model/        Formula, Unit, Prefix, Dimension, Number, Fenced, Sqrt, Extender
├── render/       UnitsML XML, MathML, LaTeX, AsciiMath, Unicode, HTML
└── unitsdb/      UnitsDB data access (@unitsml/unitsdb npm)
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
