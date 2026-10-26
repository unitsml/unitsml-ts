// Release-time dependency finalization: replaces the github: dev specs
// with the published ranges. Invoked by release.yml with the released
// versions as inputs; refuses to publish with unresolved ranges.
import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const asciiunits = process.env.FINALIZE_ASCIIUNITS;
const unitsdb = process.env.FINALIZE_UNITSDB;

if (!asciiunits || !unitsdb) {
  console.error(
    "finalize-deps: set FINALIZE_ASCIIUNITS and FINALIZE_UNITSDB " +
      "(the released versions to depend on); @unitsml/unitsdb is an " +
      "existing package whose next version is the maintainer's call",
  );
  process.exit(1);
}

manifest.dependencies["@unitsml/asciiunits"] = `^${asciiunits}`;
manifest.dependencies["@unitsml/unitsdb"] = `^${unitsdb}`;
writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`finalized: asciiunits ^${asciiunits}, unitsdb ^${unitsdb}`);
