/**
 * Download all upstream sources into the local cache.
 *
 * Skips files already in the cache so local pipeline iterations are fast;
 * use --force to re-download everything (CI does this). With --best-effort,
 * unreachable sources are logged and skipped instead of aborting — compile.ts
 * then carries the previous bundle output forward for those sources (useful
 * on networks that can't reach every upstream host).
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CACHE_DIR, COE_ORACLE, SOURCES, USER_AGENT, type Source } from "./sources.ts";

const force = process.argv.includes("--force");
const withOracle = process.argv.includes("--oracle");
const bestEffort = process.argv.includes("--best-effort");

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
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  fetched ${source.file} (${res.headers.get("content-length") ?? "?"} bytes)`);
}

await mkdir(CACHE_DIR, { recursive: true });
const sources = withOracle ? [...SOURCES, COE_ORACLE] : SOURCES;
console.log(`Fetching ${sources.length} sources into ${CACHE_DIR}/`);
const unreachable: string[] = [];
for (const source of sources) {
  try {
    await fetchSource(source);
  } catch (err) {
    if (!bestEffort) throw err;
    unreachable.push(source.file);
    console.warn(`  SKIP    ${source.file}: ${err instanceof Error ? err.message : err}`);
  }
}
if (unreachable.length > 0) {
  console.warn(`Done with ${unreachable.length} unreachable sources (best-effort mode).`);
} else {
  console.log("Done.");
}
