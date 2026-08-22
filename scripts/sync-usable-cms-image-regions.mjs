#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const cmsOrigin = (process.env.USABLE_CMS_SETUP_URL || "https://cms.usable.dev").replace(
  /\/api\/setup\/register\/?$/,
  "",
);
const setupToken = process.env.USABLE_CMS_SETUP_TOKEN;

if (!setupToken) {
  console.error("USABLE_CMS_SETUP_TOKEN is required. Complete the Usable CMS device login first.");
  process.exit(1);
}

const binding = JSON.parse(
  await readFile(new URL("../cms/site-binding.json", import.meta.url), "utf8"),
);
if (!binding.siteId || !binding.workspaceId) {
  throw new Error("cms/site-binding.json is missing the Usable CMS site or workspace id.");
}

const headers = {
  Authorization: `Bearer ${setupToken}`,
  "Content-Type": "application/json",
};
const endpoint = `${cmsOrigin}/api/sites/${binding.siteId}/regions`;
const current = await requestJson(endpoint, { headers });
const manifest = current.manifest;
if (!manifest || !Array.isArray(manifest.regions) || !Array.isArray(manifest.pages)) {
  throw new Error("Usable CMS returned an invalid region manifest.");
}

const regions = [...manifest.regions];
let added = 0;
for (const page of manifest.pages) {
  if (!String(page.id || "").startsWith("article-") || !page.fragmentId) continue;
  for (const region of articleMutationRegions(page)) {
    const index = regions.findIndex((candidate) => candidate.id === region.id);
    if (index >= 0) {
      regions[index] = region;
    } else {
      regions.push(region);
      added += 1;
    }
  }
}

const updated = await requestJson(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({
    workspaceId: binding.workspaceId,
    regions,
    fields: manifest.fields || [],
    collections: manifest.collections || [],
  }),
});

const readback = updated.manifest;
if (!readback || !Array.isArray(readback.pages) || !Array.isArray(readback.regions)) {
  throw new Error("Usable CMS did not return the synchronized region manifest.");
}
const beforePageIds = manifest.pages.map((page) => page.id).sort();
const afterPageIds = readback.pages.map((page) => page.id).sort();
if (JSON.stringify(beforePageIds) !== JSON.stringify(afterPageIds)) {
  throw new Error("Image-region synchronization changed the live CMS page list; aborting.");
}
for (const page of readback.pages) {
  if (!String(page.id || "").startsWith("article-") || !page.fragmentId) continue;
  for (const required of articleMutationRegions(page)) {
    const actual = readback.regions.find((region) => region.id === required.id);
    if (actual?.path !== required.path || actual.fragmentId !== page.fragmentId) {
      throw new Error(`Article mutation region ${required.id} was not persisted correctly.`);
    }
  }
}

console.log(
  `Synchronized structured-body and image mutation regions for ${manifest.pages.filter((page) => String(page.id || "").startsWith("article-")).length} article pages (${added} added); ${afterPageIds.length} live pages preserved.`,
);

function articleMutationRegions(page) {
  const shared = {
    scope: "page",
    pageId: page.id,
    fragmentId: page.fragmentId,
  };
  return [
    {
      ...shared,
      id: `${page.id}.article.bodyBlocks`,
      label: "Structured article body",
      kind: "text",
      path: "bodyBlocks",
    },
    {
      ...shared,
      id: `${page.id}.article.heroImage`,
      label: "Article hero image",
      kind: "image",
      path: "heroImage",
    },
    {
      ...shared,
      id: `${page.id}.article.showHeroImage`,
      label: "Show article hero image",
      kind: "text",
      path: "showHeroImage",
    },
  ];
}

async function requestJson(url, init) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}
