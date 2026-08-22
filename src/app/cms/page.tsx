import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCmsEditorPageDirectory } from "@/lib/content/load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CmsPage({
  searchParams,
}: {
  searchParams: Promise<{ editor?: string; page?: string }>;
}) {
  const { editor, page = "home" } = await searchParams;
  if (editor === "umbraco" || process.env.CMS_CONTENT_SOURCE === "umbraco") {
    const umbracoOrigin = process.env.UMBRACO_BACKOFFICE_ORIGIN || process.env.UMBRACO_ORIGIN;
    if (umbracoOrigin) redirect(new URL("/umbraco", umbracoOrigin).toString());
  }
  const pages = await getCmsEditorPageDirectory();
  const publicPath = pages.find((candidate) => candidate.id === page)?.path || "/";
  redirect(`${publicPath}?cms=1`);
}
