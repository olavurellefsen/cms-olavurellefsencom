import { z } from "zod";

const linkSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

const imageSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
});

export const globalContentSchema = z.object({
  siteName: z.string().min(1),
  siteDescription: z.string().min(1),
  canonicalUrl: z.url(),
  navigation: z.array(linkSchema),
  author: z.object({
    name: z.string().min(1),
    email: z.email(),
    location: z.string().min(1),
    portrait: imageSchema,
  }),
  socialLinks: z.array(linkSchema),
  footer: z.string().min(1),
});

const workItemSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().min(1),
  href: z.url(),
  accent: z.enum(["coral", "blue", "green", "yellow"]),
});

export const homeContentSchema = z.object({
  type: z.literal("home"),
  eyebrow: z.string(),
  headline: z.string().min(1),
  introduction: z.string().min(1),
  currentFocus: z.object({
    label: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    href: z.url(),
    linkLabel: z.string().min(1),
  }),
  selectedWorkTitle: z.string().min(1),
  selectedWork: z.array(workItemSchema),
  latestWritingTitle: z.string().min(1),
});

export const writingContentSchema = z.object({
  type: z.literal("writing"),
  eyebrow: z.string(),
  headline: z.string().min(1),
  introduction: z.string().min(1),
});

export const aboutContentSchema = z.object({
  type: z.literal("about"),
  eyebrow: z.string(),
  headline: z.string().min(1),
  lead: z.string().min(1),
  body: z.array(z.string().min(1)),
  principlesTitle: z.string().min(1),
  principles: z.array(z.string().min(1)),
  contactTitle: z.string().min(1),
  contactBody: z.string().min(1),
});

export const articleContentSchema = z.object({
  type: z.literal("article"),
  title: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  summary: z.string().min(1),
  publishedAt: z.iso.date(),
  updatedAt: z.iso.date().optional(),
  status: z.enum(["draft", "scheduled", "published"]),
  topics: z.array(z.string()),
  canonicalUrl: z.url(),
  heroImage: imageSchema.optional(),
  bodyMarkdown: z.string().min(1),
});

export const pageContentSchema = z.discriminatedUnion("type", [
  homeContentSchema,
  writingContentSchema,
  aboutContentSchema,
  articleContentSchema,
]);

export const pageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  path: z.string().startsWith("/"),
  content: pageContentSchema,
});

export const siteContentSchema = z.object({
  global: globalContentSchema,
  pages: z.array(pageSchema),
  pageTemplates: z.array(z.record(z.string(), z.unknown())).default([]),
});

export type GlobalContent = z.infer<typeof globalContentSchema>;
export type Page = z.infer<typeof pageSchema>;
export type HomeContent = z.infer<typeof homeContentSchema>;
export type WritingContent = z.infer<typeof writingContentSchema>;
export type AboutContent = z.infer<typeof aboutContentSchema>;
export type ArticleContent = z.infer<typeof articleContentSchema>;
