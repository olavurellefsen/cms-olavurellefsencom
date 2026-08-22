import type { Metadata } from "next";
import { UmbracoCmsBridge } from "@/components/umbraco-cms-bridge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function UmbracoBridgePage() {
  const parentOrigin = process.env.UMBRACO_BACKOFFICE_ORIGIN || process.env.UMBRACO_ORIGIN || "";
  return <UmbracoCmsBridge parentOrigin={parentOrigin} />;
}
