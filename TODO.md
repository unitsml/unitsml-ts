# unitsml-ts port checklist (suleman-uzair)

1. [x] Scaffold build/test tooling (tsc, node --test)
2. [x] Parse layer: asciiunits-ts trees -> unitsml-ts model, incl. the
       post-parse passes (sqrt -> 0.5 powers, `/` and `//` inverting
       exponents, prefix-only only_instance) and the unitsml(...)/extras
       front door
3. [x] Model layer: Formula, Unit, Prefix, Dimension, Number, Fenced,
       Sqrt, Extender over the vendored unitsdb dataset (data rebuilt
       from unitsml/unitsdb v2.0.2 via unitsdb-ruby)
4. [ ] Render layer: UnitsML XML + AsciiMath + norm_text DONE (oracle
       87/87); MathML document API, LaTeX, HTML, Unicode remain
5. [x] Conformance: frozen render oracle (fixtures/render-oracle.json,
       from unitsml-ruby 0.6.11 conv specs) replayed in CI
6. [x] No Opal anywhere: native TS over the asciiunits artifact
7. [ ] npm publish @unitsml/unitsml-ts (trusted publishing via OIDC)
