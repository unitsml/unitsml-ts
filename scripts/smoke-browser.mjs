// Packaged browser closure proof for unitsml + asciiunits + unitsdb.
//
// Packs the three packages, installs the tarballs into a scratch project
// (parsanol comes from asciiunits' own manifest spec, installed normally),
// resolves every bare specifier with the "browser" export condition into an
// importmap, crawls the resolved module graph refusing node:* / unresolved
// imports, serves it on 127.0.0.1 and runs scripts/browser-proof/page.mjs in
// a real headless Chromium (Edge/Chrome). Asserts the reported check counts.
//
// Usage: node scripts/smoke-browser.mjs --asciiunits <repo> --unitsdb <repo>
//          [--out <dir>] [--browser <exe>]
//   BROWSER env may name the browser executable instead of --browser.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const repos = {
  unitsml: ROOT,
  asciiunits: resolve(arg("asciiunits", join(ROOT, "..", "asciiunits-ts"))),
  unitsdb: resolve(arg("unitsdb", join(ROOT, "..", "unitsdb-ts"))),
};
const EXPECTED_MAIN = 17;
const EXPECTED_ENGINE = 1;
const npm = (args, cwd) =>
  process.platform === "win32"
    ? execFileSync("cmd.exe", ["/d", "/s", "/c", "npm", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    : execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const findBrowser = () =>
  [
    arg("browser"),
    process.env.BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((p) => p && existsSync(p));

const out = resolve(arg("out", mkdtempSync(join(tmpdir(), "unitsml-browser-"))));
mkdirSync(out, { recursive: true });
const project = mkdtempSync(join(out, "project-"));
const summary = { out, packages: {}, checks: {} };

// 1. Pack + install as a consumer would.
const tarballs = {};
for (const [name, dir] of Object.entries(repos)) {
  const [packed] = JSON.parse(npm(["pack", "--json", "--pack-destination", out], dir));
  tarballs[name] = `file:${join(out, packed.filename).split(sep).join("/")}`;
  summary.packages[name] = { version: packed.version, filename: packed.filename, integrity: packed.integrity };
}
writeFileSync(
  join(project, "package.json"),
  JSON.stringify({
    name: "unitsml-browser-proof",
    private: true,
    type: "module",
    dependencies: { unitsml: tarballs.unitsml, asciiunits: tarballs.asciiunits, unitsdb: tarballs.unitsdb },
    overrides: { asciiunits: tarballs.asciiunits, unitsdb: tarballs.unitsdb },
  }, null, 2),
);
npm(["install", "--no-audit", "--no-fund", "--foreground-scripts"], project);
const pkgVersion = (n) => JSON.parse(readFileSync(join(project, "node_modules", n, "package.json"), "utf8"));
summary.packages.parsanol = { version: pkgVersion("parsanol").version, resolved: JSON.parse(readFileSync(join(project, "package-lock.json"), "utf8")).packages["node_modules/parsanol"]?.resolved };
const nested = execFileSync(process.execPath, ["-e", `
  const lock = require(${JSON.stringify(join(project, "package-lock.json"))});
  console.log(JSON.stringify(Object.keys(lock.packages).filter(k => /node_modules\\/.+node_modules\\/(asciiunits|unitsdb|parsanol)$/.test(k))));
`], { encoding: "utf8" });
summary.nestedCopies = JSON.parse(nested);
if (summary.nestedCopies.length) throw new Error(`duplicate nested packages: ${nested}`);

// 2. Resolve bare specifiers with the browser condition (Node's own resolver).
const specifiers = ["unitsml", "unitsml/render", "asciiunits", "unitsdb", "parsanol/browser"];
const resolver = join(project, "resolve.mjs");
writeFileSync(resolver, `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(specifiers)}.map(s => [s, import.meta.resolve(s)]))));`);
const resolved = JSON.parse(execFileSync(process.execPath, ["--conditions=browser", resolver], { cwd: project, encoding: "utf8" }));
const toHttp = (fileUrl) => "/" + relative(project, fileURLToPath(fileUrl)).split(sep).join("/");
const imports = Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, toHttp(v)]));
summary.importmap = imports;
for (const [k, v] of Object.entries(imports)) {
  if (k.startsWith("asciiunits") && !v.endsWith("/dist/browser.js")) throw new Error(`asciiunits did not resolve to its browser entry: ${v}`);
}

// 3. Crawl the graph: every import must be relative or mapped; never node:*.
const graph = new Set();
const offenders = [];
const IMPORT = /(?:^|[;\s])(?:import|export)\s*(?:[^"'`;]*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gm;
const crawl = (httpPath) => {
  if (graph.has(httpPath)) return;
  graph.add(httpPath);
  const file = join(project, httpPath);
  if (extname(file) !== ".js" && extname(file) !== ".mjs") return;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith("node:") || /^(fs|path|url|crypto|os|child_process)$/.test(spec)) offenders.push(`${httpPath} -> ${spec}`);
    else if (spec.startsWith(".")) crawl(new URL(spec, `http://x${httpPath}`).pathname);
    else if (imports[spec]) crawl(imports[spec]);
    else offenders.push(`${httpPath} -> unmapped ${spec}`);
  }
};
copyFileSync(join(ROOT, "scripts", "browser-proof", "page.mjs"), join(project, "page.mjs"));
crawl("/page.mjs");
summary.graph = { modules: graph.size, offenders };
if (offenders.length) throw new Error(`browser graph offenders: ${offenders.join("; ")}`);
const html = `<!doctype html><meta charset="utf-8"><title>unitsml browser proof</title>
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module" src="/page.mjs"></script>`;
writeFileSync(join(project, "index.html"), html);

// 4. Serve on localhost with a corrupt-artifact route and a 404 route.
const artifact = readFileSync(join(project, "node_modules", "asciiunits", "artifacts", "unitsml.json"));
const corrupt = Buffer.from(artifact);
corrupt[corrupt.length - 2] ^= 1;
summary.artifactSha256 = createHash("sha256").update(artifact).digest("hex");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const reports = {};
const served = new Set();
let notify = () => {};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/report") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      reports[url.searchParams.get("mode") ?? "main"] = JSON.parse(body);
      res.end("ok");
      notify();
    });
    return;
  }
  if (url.pathname === "/corrupt/unitsml.json") return res.writeHead(200, { "content-type": MIME[".json"] }).end(corrupt);
  const file = join(project, decodeURIComponent(url.pathname));
  if (!file.startsWith(project) || url.pathname.startsWith("/missing/") || !existsSync(file) || url.pathname === "/") {
    return res.writeHead(404).end("not found");
  }
  served.add(url.pathname);
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

// 5. Real headless browser, once per page mode.
const browser = findBrowser();
if (!browser) {
  server.close();
  writeFileSync(join(out, "summary.json"), JSON.stringify({ ...summary, browser: null, limitation: "no Chromium-family browser found" }, null, 2));
  console.error("no browser executable found; set BROWSER or --browser");
  process.exit(3);
}
summary.browser = { path: browser };
const runPage = (mode, query) =>
  new Promise((resolveRun, rejectRun) => {
    const profile = join(out, `profile-${mode}-${Date.now()}`);
    const child = spawn(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", `--user-data-dir=${profile}`, `${origin}/index.html${query}`,
    ], { stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); rejectRun(new Error(`${mode}: no report within 90s`)); }, 90_000);
    notify = () => { if (reports[mode]) { clearTimeout(timer); child.kill(); resolveRun(reports[mode]); } };
    child.on("error", (e) => { clearTimeout(timer); rejectRun(e); });
  });
let failed = 0;
try {
  for (const [mode, query, expected] of [["main", "", EXPECTED_MAIN], ["engine-missing", "?mode=engine-missing", EXPECTED_ENGINE]]) {
    const results = await runPage(mode, query);
    const passed = results.filter((r) => r.ok).length;
    summary.checks[mode] = { expected, reported: results.length, passed, results };
    if (results.length !== expected || passed !== expected) failed++;
  }
} catch (error) {
  summary.error = String(error);
  failed++;
} finally {
  server.close();
}
summary.browser.userAgent = summary.checks.main?.results?.[0]?.detail ?? null;
summary.servedWasm = [...served].filter((p) => p.endsWith(".wasm"));
summary.ok = failed === 0;
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
for (const [mode, c] of Object.entries(summary.checks)) {
  console.log(`${mode}: ${c.passed}/${c.expected} checks pass (${c.reported} reported)`);
  for (const r of c.results.filter((r) => !r.ok)) console.log(`  FAIL ${r.name}: ${r.error}`);
}
console.log(`graph modules ${summary.graph.modules}, offenders ${offenders.length}; ${summary.ok ? "OK" : "FAILED"} -> ${join(out, "summary.json")}`);
process.exit(summary.ok ? 0 : 1);
