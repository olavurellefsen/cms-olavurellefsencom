#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";

const setupUrl = process.env.USABLE_CMS_SETUP_URL || "https://cms.usable.dev/api/setup/register";
const setupToken = process.env.USABLE_CMS_SETUP_TOKEN;

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
    "http://localhost:3000",
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
if (!response.ok) {
  console.error(`CMS registration failed: ${response.status} ${response.statusText}`);
  console.error(responseText);
  process.exit(1);
}

const result = JSON.parse(responseText);
const workspaceId = result.workspace?.id || result.workspaceId || "";
const siteId = result.site?.id || result.siteId || "";
const integrationKey =
  result.embedKey?.token ||
  result.integrationKey ||
  result.publicEnv?.NEXT_PUBLIC_USABLE_CMS_INTEGRATION_KEY ||
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

await writeFile(
  new URL("../cms/site-binding.json", import.meta.url),
  `${JSON.stringify({ siteId, workspaceId, integrationKey, globalFragmentId, pageFragmentIds }, null, 2)}\n`,
);

const envLines = [
  "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
  "NEXT_PUBLIC_USABLE_CMS_ORIGIN=https://cms.usable.dev",
  `NEXT_PUBLIC_USABLE_CMS_SITE_ID=${siteId}`,
  `NEXT_PUBLIC_USABLE_CMS_INTEGRATION_KEY=${integrationKey}`,
  "USABLE_API_BASE_URL=https://usable.dev",
  `USABLE_CMS_WORKSPACE_ID=${workspaceId}`,
  `USABLE_CMS_GLOBAL_CONFIG_FRAGMENT_ID=${globalFragmentId}`,
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
