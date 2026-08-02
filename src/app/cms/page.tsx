import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const publicPaths: Record<string, string> = {
  home: "/",
  writing: "/writing",
  about: "/about",
  "article-why-writing-here": "/writing/why-i-am-writing-here",
};

export default async function CmsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page = "home" } = await searchParams;
  const publicPath = publicPaths[page] || "/";
  redirect(`${publicPath}?cms=1`);
}
