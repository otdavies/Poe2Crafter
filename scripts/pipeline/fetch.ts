/**
 * Download all upstream sources into the local cache.
 *
 * Skips files already in the cache so local pipeline iterations are fast;
 * use --force to re-download everything (CI does this).
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR, COE_ORACLE, SOURCES, USER_AGENT, type Source } from "./sources.ts";

const force = process.argv.includes("--force");
const withOracle = process.argv.includes("--oracle");

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function fetchSource(source: Source): Promise<void> {
  const dest = join(CACHE_DIR, source.file);
  if (!force && (await exists(dest))) {
    console.log(`  cached  ${source.file}`);
    return;
  }
  const res = await fetch(source.url, {
    headers: source.ggg ? { "User-Agent": USER_AGENT } : {},
  });
  if (!res.ok) {
    throw new Error(`${source.url} -> HTTP ${res.status}`);
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  fetched ${source.file} (${res.headers.get("content-length") ?? "?"} bytes)`);
}

await mkdir(CACHE_DIR, { recursive: true });
const sources = withOracle ? [...SOURCES, COE_ORACLE] : SOURCES;
console.log(`Fetching ${sources.length} sources into ${CACHE_DIR}/`);
for (const source of sources) {
  await fetchSource(source);
}
console.log("Done.");
