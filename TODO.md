# unitsml-ts port checklist (suleman-uzair)

Migrate unitsml to TypeScript as `unitsml-ts`, dropping Opal completely,
on the asciiunits-ts PARG runtime.

1. [ ] Scaffold build/test tooling (tsc, node --test) — package.json ready
2. [ ] Parse layer: consume @unitsml/asciiunits-ts trees; port
       Unitsml::Parg::TreeMapper semantics (capture tree -> model), incl.
       the post-parse passes (sqrt -> 0.5 powers, `/` and `//` inverting
       exponents, prefix-only only_instance)
3. [ ] Model layer: Formula, Unit, Prefix, Dimension, Number, Fenced, Sqrt,
       Extender — mirror unitsml-ruby lib/unitsml/model + unitsdb resolution
       via @unitsml/unitsdb (cur: currencies included)
4. [ ] Render layer: UnitsML XML, MathML (mml corpus parity), LaTeX,
       AsciiMath, Unicode, HTML — pin unitsml-ruby renders as fixtures
5. [ ] Conformance: replay asciiunits-testsuite (143 cases); port the
       unitsml-ruby conv spec expectations as fixtures
6. [ ] Drop Opal: no opal runtime, no database_payload — @unitsml/unitsdb
       npm supplies data; unitsml-ruby's Opal path is deprecated separately
7. [ ] npm publish @unitsml/unitsml-ts (trusted publishing via OIDC)

Reference implementations: unitsml-ruby lib/unitsml/{parser,formula,unit,
prefix,dimension,number,fenced,sqrt,extender,utility}.rb and the conv specs
(spec/unitsml/conv/*).
