#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { selectUsablePageReferences } from "./cms-sync-lib.mjs";

const cmsOrigin = (process.env.USABLE_CMS_SETUP_URL || "https://cms.usable.dev").replace(
  /\/api\/setup\/register\/?$/,
  "",
);
const setupToken = process.env.USABLE_CMS_SETUP_TOKEN;
const serverToken = process.env.USABLE_CMS_SERVER_TOKEN;

if (!setupToken) {
  console.error("USABLE_CMS_SETUP_TOKEN is required. Complete the Usable CMS device login first.");
  process.exit(1);
}
if (!serverToken) {
  console.error("USABLE_CMS_SERVER_TOKEN is required to discover runtime-created pages.");
  process.exit(1);
}

const binding = JSON.parse(
  await readFile(new URL("../cms/site-binding.json", import.meta.url), "utf8"),
);
const fallback = JSON.parse(
  await readFile(new URL("../content/site.json", import.meta.url), "utf8"),
);
if (!binding.siteId || !binding.workspaceId) {
  throw new Error("cms/site-binding.json is missing the Usable CMS site or workspace id.");
}

const headers = {
  Authorization: `Bearer ${setupToken}`,
  "Content-Type": "application/json",
};
const regionsEndpoint = `${cmsOrigin}/api/sites/${binding.siteId}/regions`;
const manifestEndpoint = `${cmsOrigin}/api/setup/manifest`;
const current = await requestJson(regionsEndpoint, { headers });
const manifest = current.manifest;
if (!manifest || !Array.isArray(manifest.regions) || !Array.isArray(manifest.pages)) {
  throw new Error("Usable CMS returned an invalid region manifest.");
}

const [cmsPagesPayload, workspaceFragments] = await Promise.all([
  readCmsPages(binding.siteId),
  readWorkspacePageFragments(binding.workspaceId),
]);
const canonicalPages = selectUsablePageReferences({
  fallbackPages: fallback.pages,
  bindingPageFragmentIds: binding.pageFragmentIds,
  workspaceFragments,
  cmsPagesPayload,
});
const canonicalManifestPages = buildManifestPages({
  canonicalPages,
  currentPages: manifest.pages,
  workspaceFragments,
});
const pageFragmentIds = new Map(canonicalManifestPages.map((page) => [page.id, page.fragmentId]));

const regions = manifest.regions
  .filter((region) => region.scope !== "page" || pageFragmentIds.has(region.pageId))
  .map((region) => bindManifestEntry(region, pageFragmentIds));
let added = 0;
for (const page of canonicalManifestPages) {
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

const declaration = {
  siteId: binding.siteId,
  workspaceId: binding.workspaceId,
  mode: "repair",
  regions,
  pages: canonicalManifestPages,
  pageTemplates: manifest.pageTemplates || [],
  fields: (manifest.fields || []).map((field) => bindManifestEntry(field, pageFragmentIds)),
  collections: (manifest.collections || []).map((collection) =>
    bindManifestEntry(collection, pageFragmentIds),
  ),
};

const updated = await requestJson(manifestEndpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(declaration),
});

const readback = updated.manifest;
if (!readback || !Array.isArray(readback.pages) || !Array.isArray(readback.regions)) {
  throw new Error("Usable CMS did not return the synchronized region manifest.");
}
if (!isDeepStrictEqual(readback.pages, canonicalManifestPages)) {
  throw new Error("Usable CMS page-directory readback did not match the canonical declaration.");
}
for (const family of ["regions", "pageTemplates", "fields", "collections"]) {
  if (!isDeepStrictEqual(readback[family] || [], declaration[family])) {
    throw new Error(`Usable CMS ${family} readback did not match the complete declaration.`);
  }
}
for (const page of canonicalManifestPages) {
  if (!String(page.id || "").startsWith("article-") || !page.fragmentId) continue;
  for (const required of articleMutationRegions(page)) {
    const actual = readback.regions.find((region) => region.id === required.id);
    if (actual?.path !== required.path || actual.fragmentId !== page.fragmentId) {
      throw new Error(`Article mutation region ${required.id} was not persisted correctly.`);
    }
  }
}

console.log(
  `Synchronized the complete hosted manifest for ${canonicalManifestPages.length} canonical pages and ${canonicalManifestPages.filter((page) => String(page.id || "").startsWith("article-")).length} articles (${added} article regions added).`,
);

function buildManifestPages({ canonicalPages, currentPages, workspaceFragments }) {
  const currentById = new Map(currentPages.map((page) => [page.id, page]));
  const fragmentById = new Map(
    workspaceFragments.map((fragment) => [fragment.id || fragment.fragmentId, fragment]),
  );
  const fallbackCreatedBy =
    currentPages.find((page) => page.createdBy)?.createdBy || "usable-cms-manifest-repair";
  const now = new Date().toISOString();

  return canonicalPages.map((page, order) => {
    const currentPage = currentById.get(page.id);
    const fragment = fragmentById.get(page.fragmentId);
    return {
      id: page.id,
      title: page.title,
      path: page.path,
      fragmentId: page.fragmentId,
      order,
      status: manifestStatus(page.status || currentPage?.status),
      ...(currentPage?.templateId ? { templateId: currentPage.templateId } : {}),
      createdBy: currentPage?.createdBy || fragment?.createdBy || fallbackCreatedBy,
      createdAt: currentPage?.createdAt || fragment?.createdAt || now,
      updatedAt: fragment?.updatedAt || currentPage?.updatedAt || now,
    };
  });
}

function manifestStatus(status) {
  if (status === "draft") return "draft";
  if (status === "archived" || status === "hidden") return "archived";
  return "active";
}

function bindManifestEntry(entry, pageFragmentIds) {
  if (entry.scope === "page") {
    const fragmentId = pageFragmentIds.get(entry.pageId);
    if (!fragmentId) {
      throw new Error(`Manifest entry ${entry.id} refers to unknown page ${entry.pageId}.`);
    }
    return { ...entry, fragmentId };
  }
  return { ...entry, fragmentId: binding.globalFragmentId };
}

async function readCmsPages(siteId) {
  try {
    return await requestJson(`${cmsOrigin}/api/sites/${siteId}/pages`, {
      headers: { Authorization: `Bearer ${serverToken}`, Accept: "application/json" },
    });
  } catch {
    return null;
  }
}

async function readWorkspacePageFragments(workspaceId) {
  const usableOrigin = (process.env.USABLE_API_BASE_URL || "https://usable.dev").replace(/\/$/, "");
  const fragments = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const query = new URLSearchParams({
      workspaceId,
      tags: "usable-cms-page",
      limit: String(limit),
      offset: String(offset),
    });
    const payload = await requestJson(`${usableOrigin}/api/memory-fragments?${query}`, {
      headers: { Authorization: `Bearer ${serverToken}`, Accept: "application/json" },
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
      const payload = await requestJson(`${usableOrigin}/api/memory-fragments/${fragmentId}`, {
        headers: { Authorization: `Bearer ${serverToken}`, Accept: "application/json" },
      });
      const content = payload.fragment?.content ?? payload.content;
      return {
        ...fragment,
        content: typeof content === "string" ? content : JSON.stringify(content),
      };
    }),
  );
}

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
