// Stamps the service worker with the list of built assets and a content-based version,
// so every route chunk is available offline and clients update when a new build ships.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT = "build/client";
const assets = readdirSync(join(CLIENT, "assets"), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && !d.name.endsWith(".map"))
  .map((d) => "/" + join(d.parentPath ?? d.path, d.name).replace(/\\/g, "/").slice(CLIENT.length + 1))
  .sort();

const swPath = join(CLIENT, "sw.js");
const source = readFileSync(swPath, "utf8");
const version = createHash("sha256").update(assets.join("\n")).update(source).digest("hex").slice(0, 10);
const sw = source
  .replace('const VERSION = "dev";', `const VERSION = "${version}";`)
  .replace("const PRECACHE_ASSETS = [];", `const PRECACHE_ASSETS = ${JSON.stringify(assets)};`);

writeFileSync(swPath, sw);
console.log(`sw.js stamped: version ${version}, ${assets.length} assets`);
