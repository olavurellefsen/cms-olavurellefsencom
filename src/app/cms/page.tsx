import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCmsEditorPageDirectory } from "@/lib/content/load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CmsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page = "home" } = await searchParams;
  const pages = await getCmsEditorPageDirectory();
  const publicPath = pages.find((candidate) => candidate.id === page)?.path || "/";
  redirect(`${publicPath}?cms=1`);
}
