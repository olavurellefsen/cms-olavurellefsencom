import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import {
  auditUsablePageTopology,
  parseCmsFragmentContent,
  selectUsablePageReferences,
} from "./cms-sync-lib.mjs";

const root = new URL("../", import.meta.url);
const stateUrl = new URL(".cms-sync-state.json", root);
const binding = JSON.parse(await readFile(new URL("cms/site-binding.json", root), "utf8"));
const fallback = JSON.parse(await readFile(new URL("content/site.json", root), "utf8"));
const args = new Set(process.argv.slice(2));
const from = valueAfter("--from");
const to = valueAfter("--to");
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const auditTopology = args.has("--audit-topology");

if (auditTopology) {
  const [globalContent, cmsPagesPayload, workspaceFragments] = await Promise.all([
    readUsableFragment(binding.globalFragmentId),
    readCmsPages(),
    readWorkspacePageFragments(),
  ]);
  console.log(
    JSON.stringify(
      auditUsablePageTopology({
        globalContent,
        fallbackPages: fallback.pages,
        bindingPageFragmentIds: binding.pageFragmentIds,
        workspaceFragments,
        cmsPagesPayload,
      }),
      null,
      2,
    ),
  );
  process.exit(0);
}

if (from !== "usable" || to !== "umbraco") {
  fail(
    "Usage: npm run cms:sync -- --from usable --to umbraco [--dry-run] [--force], or npm run cms:audit-topology. Usable is canonical; reverse synchronization is not supported.",
  );
}

const previous = await readState();
const [sourceSnapshot, targetSnapshot] = await Promise.all([exportCms(from), exportCms(to)]);
const sourceHash = hash(sourceSnapshot);
const targetHash = hash(targetSnapshot);
const previousSourceHash = previous?.hashes?.[from];
const previousTargetHash = previous?.hashes?.[to];

if (
  !force &&
  sourceHash !== targetHash &&
  previous &&
  previousSourceHash !== sourceHash &&
  previousTargetHash !== targetHash
) {
  fail(
    "Projection drift: canonical Usable content and the local Umbraco projection both changed. Review the local projection or rerun with --force to rebuild it from Usable.",
  );
}

const report = {
  from,
  to,
  dryRun,
  sourceHash,
  targetHash,
  changed: sourceHash !== targetHash,
  pages: sourceSnapshot.pages.length,
};
console.log(JSON.stringify(report, null, 2));
if (dryRun) process.exit(0);
if (sourceHash === targetHash && !force) {
  await writeState(sourceHash);
  console.log(`Already synchronized ${sourceSnapshot.pages.length} pages; baseline recorded.`);
  process.exit(0);
}

await importCms(to, sourceSnapshot);
const verified = await exportCms(to);
const verifiedHash = hash(verified);
if (verifiedHash !== sourceHash)
  fail(`Readback mismatch: ${to} returned ${verifiedHash}, expected ${sourceHash}.`);

await writeState(sourceHash);
console.log(
  `Synchronized ${sourceSnapshot.pages.length} pages from ${from} to ${to}; readback verified.`,
);

async function writeState(synchronizedHash) {
  await writeFile(
    stateUrl,
    `${JSON.stringify({ version: 1, synchronizedAt: new Date().toISOString(), hashes: { usable: synchronizedHash, umbraco: synchronizedHash } }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function exportCms(cms) {
  if (cms === "umbraco") return requestUmbraco("export");
  const global = await readUsableFragment(binding.globalFragmentId);
  const [cmsPagesPayload, workspaceFragments] = await Promise.all([
    readCmsPages(),
    readWorkspacePageFragments(),
  ]);
  const references = selectUsablePageReferences({
    fallbackPages: fallback.pages,
    bindingPageFragmentIds: binding.pageFragmentIds,
    workspaceFragments,
    cmsPagesPayload,
  });
  const pages = await Promise.all(
    references.map(async (reference) => {
      const content = reference.content || (await readUsableFragment(reference.fragmentId));
      return {
        id: reference.id,
        title: content.title || reference.title || reference.id,
        path: reference.path,
        content,
      };
    }),
  );
  return normalize({
    global,
    pages,
    pageTemplates: [],
    canonical: {
      provider: "usable",
      workspaceId: process.env.USABLE_CMS_WORKSPACE_ID || binding.workspaceId,
      globalFragmentId: binding.globalFragmentId,
      pageFragmentIds: Object.fromEntries(
        references.map((reference) => [reference.id, reference.fragmentId]),
      ),
    },
  });
}

async function readCmsPages() {
  const token = required("USABLE_CMS_SERVER_TOKEN");
  const origin = (process.env.NEXT_PUBLIC_USABLE_CMS_ORIGIN || "https://cms.usable.dev").replace(
    /\/$/,
    "",
  );
  try {
    const response = await fetch(`${origin}/api/sites/${binding.siteId}/pages`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function readWorkspacePageFragments() {
  const token = required("USABLE_CMS_SERVER_TOKEN");
  const origin = (process.env.USABLE_API_BASE_URL || "https://usable.dev").replace(/\/$/, "");
  const workspaceId = process.env.USABLE_CMS_WORKSPACE_ID || binding.workspaceId;
  const fragments = [];
  const limit = 100;
  for (let offset = 0; offset < 10_000; offset += limit) {
    const query = new URLSearchParams({
      workspaceId,
      tags: "usable-cms-page",
      limit: String(limit),
      offset: String(offset),
    });
    const payload = await request(`${origin}/api/memory-fragments?${query}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const page = payload.fragments || [];
    fragments.push(...page);
    if (page.length < limit || fragments.length >= (payload.total || Number.POSITIVE_INFINITY)) {
      break;
    }
  }
  return Promise.all(
    fragments.map(async (fragment) => {
      if (typeof fragment.content === "string") return fragment;
      const fragmentId = fragment.id || fragment.fragmentId;
      if (!fragmentId) return fragment;
      const content = await readUsableFragment(fragmentId);
      return { ...fragment, content: JSON.stringify(content) };
    }),
  );
}

async function importCms(cms, snapshot) {
  if (cms === "umbraco") {
    return requestUmbraco("import", {
      method: "POST",
      body: JSON.stringify({
        snapshot,
        expectedTargetHash: targetHash,
        source: "usable",
        force,
      }),
    });
  }
  fail("Usable imports are disabled because Usable is the canonical content store.");
}

async function readUsableFragment(fragmentId) {
  const token = required("USABLE_CMS_SERVER_TOKEN");
  const origin = (process.env.USABLE_API_BASE_URL || "https://usable.dev").replace(/\/$/, "");
  const payload = await request(`${origin}/api/memory-fragments/${fragmentId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return parseContent(payload.fragment?.content ?? payload.content);
}

async function requestUmbraco(action, init = {}) {
  const origin = required("UMBRACO_ORIGIN").replace(/\/$/, "");
  const apiKey = required("UMBRACO_SYNC_API_KEY");
  const payload = await request(`${origin}/api/olavur-sync/${action}`, {
    ...init,
    headers: { "X-Olavur-Sync-Key": apiKey, "Content-Type": "application/json", ...init.headers },
  });
  return action === "export" ? normalize(payload) : payload;
}

async function request(url, init) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const text = await response.text();
  if (!response.ok)
    fail(`${init?.method || "GET"} ${url} failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function parseContent(raw) {
  const parsed = parseCmsFragmentContent(raw);
  if (!parsed) fail("A Usable fragment did not contain valid JSON text content.");
  return parsed;
}

function normalize(snapshot) {
  const normalized = {
    global: snapshot.global,
    pages: [...snapshot.pages].sort((a, b) => a.id.localeCompare(b.id)),
    pageTemplates: snapshot.pageTemplates || [],
  };
  if (snapshot.canonical) normalized.canonical = snapshot.canonical;
  return normalized;
}

function hash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateUrl, "utf8"));
  } catch {
    return null;
  }
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required.`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
