import Script from "next/script";
import { siteBinding } from "@/lib/cms/binding";

export function CmsEmbed() {
  const cmsOrigin = (process.env.NEXT_PUBLIC_USABLE_CMS_ORIGIN || "https://cms.usable.dev").replace(
    /\/$/,
    "",
  );
  const siteId = process.env.NEXT_PUBLIC_USABLE_CMS_SITE_ID || siteBinding.siteId;
  const integrationKey =
    process.env.NEXT_PUBLIC_USABLE_CMS_INTEGRATION_KEY || siteBinding.integrationKey;

  if (!siteId || !integrationKey) return null;

  return (
    <Script
      id="usable-cms-embed"
      src={`${cmsOrigin}/embed.js`}
      strategy="afterInteractive"
      data-cms-origin={cmsOrigin}
      data-site={siteId}
      data-token={integrationKey}
    />
  );
}
