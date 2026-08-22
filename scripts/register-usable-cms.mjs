#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";

const setupUrl = process.env.USABLE_CMS_SETUP_URL || "https://cms.usable.dev/api/setup/register";
const setupToken = process.env.USABLE_CMS_SETUP_TOKEN;
const existingServerToken = await readExistingServerToken();
const existingBinding = await readExistingBinding();

if (!setupToken) {
  console.error("USABLE_CMS_SETUP_TOKEN is required. Complete the Usable CMS device login first.");
  process.exit(1);
}

const siteContent = JSON.parse(
  await readFile(new URL("../content/site.json", import.meta.url), "utf8"),
);
const manifest = JSON.parse(
  await readFile(new URL("../cms/manifest.json", import.meta.url), "utf8"),
);

const payload = {
  siteName: "Ólavur Ellefsen",
  allowedOrigins: [
    "https://www.olavurellefsen.com",
    "https://olavurellefsen.com",
    "https://olavurellefsen-com.fly.dev",
    "https://olavurellefsen-umbraco.fly.dev",
    "http://localhost:3000",
    "http://localhost:5099",
    "http://127.0.0.1:5099",
  ],
  serverTokenAccess: "read-write",
  selectedSkillIds: [
    "8a2a5948-2cb4-4df4-a6c1-2e030650dbec",
    "e0d55160-5649-4cae-b8f6-c0c94cc1a196",
    "d646e68c-44a3-424a-ad4c-94a9b486cc36",
  ],
  features: ["page-templates"],
  globalContent: siteContent.global,
  pages: siteContent.pages,
  pageTemplates: siteContent.pageTemplates,
  manifest,
};

const response = await fetch(setupUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${setupToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
const responseText = await response.text();
let result;
if (response.ok) {
  result = JSON.parse(responseText);
} else if (
  responseText.includes("Failed to create fragment type") ||
  responseText.includes("Fragment type not found in workspace")
) {
  console.warn(
    "Usable custom fragment-type provisioning is unavailable; using the workspace default content type.",
  );
  result = await registerWithWorkspaceDefaultType(payload, setupToken, existingServerToken);
} else {
  console.error(`CMS registration failed: ${response.status} ${response.statusText}`);
  console.error(responseText);
  process.exit(1);
}
const workspaceId = result.workspace?.id || result.workspaceId || "";
const siteId = result.site?.id || result.siteId || "";
const integrationKey =
  result.embedKey?.token ||
  result.integrationKey ||
  result.binding?.integrationKey ||
  result.publicIntegration?.integrationKey ||
  result.publicIntegration?.embedKey ||
  result.publicIntegration?.key ||
  result.publicEnv?.NEXT_PUBLIC_USABLE_CMS_INTEGRATION_KEY ||
  result.publicEnv?.NEXT_PUBLIC_USABLE_CMS_KEY ||
  existingBinding.integrationKey ||
  "";
const globalFragmentId =
  result.contentFragments?.global?.fragmentId || result.globalFragmentId || "";
const pageEntries = result.contentFragments?.pages || [];
const pageFragmentIds = Object.fromEntries(
  pageEntries.map((page) => [page.id || page.pageId, page.fragmentId]),
);
const serverToken =
  result.serverToken?.token ||
  result.serverEnv?.USABLE_CMS_SERVER_TOKEN ||
  result.env?.USABLE_CMS_SERVER_TOKEN ||
  "";

if (!workspaceId || !siteId || !integrationKey || !globalFragmentId || !pageEntries.length) {
  console.error("Registration succeeded but returned an unexpected setup kit shape.");
  console.error(
    JSON.stringify(
      {
        keys: Object.keys(result),
        workspaceId: Boolean(workspaceId),
        siteId: Boolean(siteId),
        integrationKey: Boolean(integrationKey),
        globalFragmentId: Boolean(globalFragmentId),
        pageCount: pageEntries.length,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const sameExistingSite =
  existingBinding.siteId === siteId && existingBinding.workspaceId === workspaceId;
const resolvedGlobalFragmentId =
  (sameExistingSite && existingBinding.globalFragmentId) || globalFragmentId;
const resolvedPageFragmentIds = sameExistingSite
  ? { ...pageFragmentIds, ...existingBinding.pageFragmentIds }
  : pageFragmentIds;
if (
  sameExistingSite &&
  (resolvedGlobalFragmentId !== globalFragmentId ||
    Object.entries(existingBinding.pageFragmentIds || {}).some(
      ([pageId, fragmentId]) => pageFragmentIds[pageId] && pageFragmentIds[pageId] !== fragmentId,
    ))
) {
  console.warn(
    "Registration returned duplicate setup fragments; preserving the checked-in canonical bindings. Run npm run cms:sync-regions to repair the hosted manifest.",
  );
}

await writeFile(
  new URL("../cms/site-binding.json", import.meta.url),
  `${JSON.stringify(
    {
      siteId,
      workspaceId,
      integrationKey,
      globalFragmentId: resolvedGlobalFragmentId,
      pageFragmentIds: resolvedPageFragmentIds,
    },
    null,
    2,
  )}\n`,
);

const envLines = [
  "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
  "NEXT_PUBLIC_USABLE_CMS_ORIGIN=https://cms.usable.dev",
  `NEXT_PUBLIC_USABLE_CMS_SITE_ID=${siteId}`,
  `NEXT_PUBLIC_USABLE_CMS_INTEGRATION_KEY=${integrationKey}`,
  "USABLE_API_BASE_URL=https://usable.dev",
  `USABLE_CMS_WORKSPACE_ID=${workspaceId}`,
  `USABLE_CMS_GLOBAL_CONFIG_FRAGMENT_ID=${resolvedGlobalFragmentId}`,
  ...(serverToken ? [`USABLE_CMS_SERVER_TOKEN=${serverToken}`] : []),
  "CMS_CONTENT_SOURCE=usable",
];
const envPath = new URL("../.env.local", import.meta.url);
await writeFile(envPath, `${envLines.join("\n")}\n`, { mode: 0o600 });
await chmod(envPath, 0o600);

console.log(`Registered ${payload.siteName} with Usable CMS.`);
console.log(`Workspace: ${workspaceId}`);
console.log(`Site: ${siteId}`);
console.log(`Global fragment: ${globalFragmentId}`);
console.log(`Page fragments: ${pageEntries.length}`);
console.log(
  `Server token returned: ${serverToken ? "yes" : "no (reuse the existing deployment secret)"}`,
);
console.log(
  "Public identifiers written to cms/site-binding.json; private values written to .env.local.",
);

async function registerWithWorkspaceDefaultType(input, token, reusableServerToken) {
  const usableOrigin = "https://usable.dev";
  const cmsOrigin = new URL(setupUrl).origin;
  const slug = "olavur-ellefsen";
  const workspaceName = `${input.siteName} CMS`;
  const authHeaders = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

  const workspacePayload = await requestJson(`${usableOrigin}/api/workspaces`, {
    headers: authHeaders,
  });
  const workspace = (workspacePayload.workspaces || []).find(
    (candidate) => candidate.name === workspaceName,
  );
  if (!workspace?.id) throw new Error(`Usable workspace not found: ${workspaceName}`);

  const typePayload = await requestJson(
    `${usableOrigin}/api/workspaces/${workspace.id}/fragment-types`,
    { headers: authHeaders },
  );
  const fragmentType =
    (typePayload.fragmentTypes || []).find((candidate) => candidate.name === "Knowledge") ||
    typePayload.fragmentTypes?.[0];
  if (!fragmentType?.id) throw new Error("Usable workspace has no durable fragment type");

  const existingFragments = await requestJson(
    `${usableOrigin}/api/memory-fragments?workspaceId=${workspace.id}&tags=site%3A${slug}&limit=50`,
    { headers: authHeaders },
  );
  const fragments = existingFragments.fragments || [];
  const globalFragment = await ensureFragment({
    content: input.globalContent,
    fragmentTypeId: fragmentType.id,
    fragments,
    summary: `Shared CMS configuration for ${input.siteName}.`,
    tags: ["usable-cms", "usable-cms-global-config", `site:${slug}`],
    title: `${input.siteName} Global Config`,
    token,
    usableOrigin,
    workspaceId: workspace.id,
  });
  const pageFragments = [];
  for (const page of input.pages) {
    pageFragments.push({
      ...page,
      fragmentId: await ensureFragment({
        content: page.content,
        fragmentTypeId: fragmentType.id,
        fragments,
        summary: `CMS page content for ${page.title} (${page.path}).`,
        tags: ["usable-cms", "usable-cms-page", `site:${slug}`, `cms-page:${page.id}`],
        title: `${input.siteName}: ${page.title}`,
        token,
        usableOrigin,
        workspaceId: workspace.id,
      }),
    });
  }

  const sitesPayload = await requestJson(`${cmsOrigin}/api/sites`, { headers: authHeaders });
  let site = (sitesPayload.sites || []).find((candidate) => candidate.slug === slug);
  if (!site) {
    const sitePayload = await requestJson(`${cmsOrigin}/api/sites`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        slug,
        displayName: input.siteName,
        allowedOrigins: input.allowedOrigins,
        defaultWorkspaceId: workspace.id,
      }),
    });
    site = sitePayload.site;
  }
  if (!site?.id) throw new Error("Usable CMS did not return a site id");

  await requestJson(`${cmsOrigin}/api/sites/${site.id}/workspace-bindings`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      workspaceId: workspace.id,
      rolePolicy: "members",
      contentRoot: globalFragment,
      assetRoot: "usable-files",
    }),
  });
  const keyPayload = await requestJson(`${cmsOrigin}/api/sites/${site.id}/embed-keys`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ allowedOrigins: input.allowedOrigins }),
  });
  const integrationKey = keyPayload.token || keyPayload.embedKey?.token;
  if (!integrationKey) throw new Error("Usable CMS did not return a public integration key");

  const pageIds = new Map(pageFragments.map((page) => [page.id, page.fragmentId]));
  const bindEntry = (entry) => ({
    ...entry,
    fragmentId: entry.scope === "page" ? pageIds.get(entry.pageId) : globalFragment,
  });
  await requestJson(`${cmsOrigin}/api/sites/${site.id}/regions`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      workspaceId: workspace.id,
      regions: input.manifest.regions.map(bindEntry),
      collections: input.manifest.collections.map(bindEntry),
    }),
  });

  const serverToken =
    reusableServerToken ||
    (await createServerToken({
      headers: jsonHeaders,
      siteName: input.siteName,
      usableOrigin,
      workspaceId: workspace.id,
    }));

  return {
    workspace: { id: workspace.id },
    site: { id: site.id },
    embedKey: { token: integrationKey },
    serverToken: { token: serverToken },
    contentFragments: {
      global: { fragmentId: globalFragment },
      pages: pageFragments.map((page) => ({ id: page.id, fragmentId: page.fragmentId })),
    },
  };
}

async function createServerToken({ headers, siteName, usableOrigin, workspaceId }) {
  const permissions = serverTokenPermissions();
  const baseName = `${siteName} personal website server read-write token`;
  const create = (name) =>
    requestJson(`${usableOrigin}/api/tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        globalPermissions: emptyPermissions(),
        name,
        workspacePermissions: [{ workspaceId, permissions }],
      }),
    });

  let tokenPayload;
  try {
    tokenPayload = await create(baseName);
  } catch (error) {
    if (error.status !== 409) throw error;
    console.warn(
      "The existing named server token secret is unavailable locally; creating a replacement token.",
    );
    tokenPayload = await create(`${baseName} (${new Date().toISOString()})`);
  }
  if (!tokenPayload.token) throw new Error("Usable did not return the server token secret");
  return tokenPayload.token;
}

async function ensureFragment({
  content,
  fragmentTypeId,
  fragments,
  summary,
  tags,
  title,
  token,
  usableOrigin,
  workspaceId,
}) {
  const existing = fragments.find(
    (fragment) => fragment.title === title && tags.every((tag) => fragment.tags?.includes(tag)),
  );
  if (existing?.id) return existing.id;
  const payload = await requestJson(`${usableOrigin}/api/memory-fragments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      fragmentTypeId,
      title,
      summary,
      content: JSON.stringify(content, null, 2),
      tags,
    }),
  });
  const fragmentId = payload.fragmentId || payload.fragment?.id || payload.id;
  if (!fragmentId) throw new Error(`Usable did not return a fragment id for ${title}`);
  return fragmentId;
}

async function requestJson(url, init, attempt = 1) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) {
    if (response.status >= 500 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      return requestJson(url, init, attempt + 1);
    }
    const error = new Error(
      `${response.status} ${response.statusText} from ${url}: ${text.slice(0, 500)}`,
    );
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

async function readExistingServerToken() {
  if (process.env.USABLE_CMS_SERVER_TOKEN) return process.env.USABLE_CMS_SERVER_TOKEN;
  try {
    const env = await readFile(new URL("../.env.local", import.meta.url), "utf8");
    const line = env
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith("USABLE_CMS_SERVER_TOKEN="));
    return line?.slice("USABLE_CMS_SERVER_TOKEN=".length).trim() || "";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function readExistingBinding() {
  try {
    return JSON.parse(await readFile(new URL("../cms/site-binding.json", import.meta.url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function emptyPermissions() {
  return {
    fragments: { read: false, create: false, update: false, delete: false },
    search: { basic: false, advanced: false },
    workspace: {
      read: false,
      create: false,
      update: false,
      delete: false,
      manage_members: false,
      manage_invitations: false,
      manage_fragment_types: false,
      subscribe: false,
    },
    notifications: { read: false },
    profile: { read: false, update: false },
  };
}

function serverTokenPermissions() {
  return {
    ...emptyPermissions(),
    fragments: { read: true, create: true, update: true, delete: false },
    search: { basic: true, advanced: false },
    workspace: { ...emptyPermissions().workspace, read: true },
  };
}
