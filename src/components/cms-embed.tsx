import Script from "next/script";
import { siteBinding } from "@/lib/cms/binding";
import { CmsEditor } from "./cms-editor";

export function CmsEmbed() {
  if (process.env.CMS_CONTENT_SOURCE === "umbraco") return null;
  const cmsOrigin = (process.env.NEXT_PUBLIC_USABLE_CMS_ORIGIN || "https://cms.usable.dev").replace(
    /\/$/,
    "",
  );
  const siteId = process.env.NEXT_PUBLIC_USABLE_CMS_SITE_ID || siteBinding.siteId;
  const integrationKey =
    process.env.NEXT_PUBLIC_USABLE_CMS_INTEGRATION_KEY || siteBinding.integrationKey;

  if (!siteId || !integrationKey) return null;

  return (
    <>
      <Script
        id="usable-cms-broker"
        src={`${cmsOrigin}/broker.js`}
        strategy="afterInteractive"
        data-cms-origin={cmsOrigin}
        data-site={siteId}
        data-token={integrationKey}
      />
      <CmsEditor />
    </>
  );
}
