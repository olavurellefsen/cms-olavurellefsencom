"use client";

import {
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  ExternalLink,
  Heading2,
  Heading3,
  History,
  ImageOff,
  ImagePlus,
  ImageUp,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListPlus,
  LoaderCircle,
  LogIn,
  MessageSquare,
  Monitor,
  PanelLeft,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  Send,
  Settings2,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  Video,
  X,
} from "lucide-react";
import Image from "next/image";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import TurndownService from "turndown";
import { articleRegionId, articleRegions } from "@/lib/cms/article-regions";
import type { CmsPageReference } from "@/lib/cms/binding";
import {
  requiresStableCollectionCommands,
  stableCollectionItemKey,
} from "@/lib/cms/collection-compatibility";
import { articleBodyFromMarkdown, articleMarkdownFromBody } from "@/lib/content/article-body";
import {
  type ArticleMediaAlignment,
  type ArticleMediaBlock,
  type ArticleMediaPlacement,
  type ArticleMediaType,
  articleBodyInsertionPoints,
  articleMarkdownForEditor,
  articleMarkdownFromEditor,
  articleMediaBlocks,
  firstArticleHeroMedia,
  insertArticleMedia,
  removeArticleMedia,
  renderArticleMarkdownPreview,
  renderArticleMediaPreview,
  replaceArticleMedia,
} from "@/lib/content/article-media";
import { type ArticleBody, articleBodySchema } from "@/lib/content/schema";
import {
  type CmsImagePreparation,
  formatUploadBytes,
  prepareCmsImageUpload,
} from "@/lib/media/image-upload";

type CmsRegion = {
  id: string;
  kind: "text" | "link" | "image";
  label: string;
  fragmentId?: string;
  scope?: "global" | "page";
  pageId?: string;
  path?: string;
};

type CmsCollection = {
  fragmentId?: string;
  id: string;
  itemIdentity?: string;
  label?: string;
  pageId?: string;
  path: string;
  scope?: "global" | "page";
};

type CmsManifest = {
  siteId: string;
  workspaceId: string;
  regions: CmsRegion[];
  collections?: CmsCollection[];
  pages?: CmsPageReference[];
  pageTemplates?: CmsPageTemplate[];
};

type CmsPageTemplate = {
  id: string;
  name: string;
  description?: string;
  category?: string;
};

type CmsSession = {
  signedIn: boolean;
  authorized: boolean;
  user?: { email?: string; name?: string };
  capabilities?: {
    chat?: boolean;
    edit?: boolean;
    publish?: boolean;
    restore?: boolean;
    upload?: boolean;
  };
};

type CmsChange = {
  kind: "fragment";
  targetId: string;
  path: string;
  afterRef: string;
};

type CmsDirtyValue = string | Array<Record<string, unknown>> | ArticleBody;

type WorkItem = {
  $id?: string;
  accent: "coral" | "blue" | "green" | "yellow";
  description: string;
  href: string;
  name: string;
  role: string;
};

type WorkItemField = "description" | "href" | "name" | "role";

type CmsRevision = { id: string };
type CmsVersion = { id: string; createdAt?: string; summary?: string };

type CmsBroker = {
  session(): Promise<CmsSession>;
  login(returnTo: string, options: { forceLogin?: boolean; sameTab: true }): Promise<unknown>;
  content(input: { fragmentIds?: string[]; workspaceId?: string }): Promise<{
    fragments: Array<{ id: string; content: unknown }>;
    manifest?: CmsManifest;
  }>;
  pages(input?: Record<string, unknown>): Promise<{
    pages?: CmsPageReference[];
    pageTemplates?: CmsPageTemplate[];
  }>;
  createPage(input: Record<string, unknown>): Promise<{
    page?: CmsPageReference;
    manifest?: CmsManifest;
  }>;
  publishPage(pageId: string): Promise<{
    page?: CmsPageReference;
    manifest?: CmsManifest;
  }>;
  deletePage(pageId: string): Promise<unknown>;
  draft(input: {
    revisionId?: string;
    workspaceId: string;
    summary: string;
    changes: CmsChange[];
  }): Promise<{ revision: CmsRevision }>;
  publish(input: {
    revisionId?: string;
    workspaceId?: string;
    summary?: string;
    changes?: CmsChange[];
  }): Promise<{ revision: CmsRevision }>;
  upload(
    file: File,
    input: { regionId: string; title: string },
  ): Promise<{ assetPath?: string; url?: string }>;
  versions(): Promise<{ versions: CmsVersion[] }>;
  restore(versionId: string): Promise<unknown>;
  chat(message: string, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

declare global {
  interface Window {
    usableCmsBroker?: CmsBroker;
  }
}

const fallbackPages: CmsPageReference[] = [
  { id: "home", title: "Home", path: "/" },
  { id: "writing", title: "Writing", path: "/writing" },
  { id: "about", title: "About", path: "/about" },
  {
    id: "article-claude-codex-usable-collaboration",
    title: "Claude and Codex can’t talk to each other",
    path: "/writing/claude-codex-usable-collaboration",
  },
  {
    id: "article-why-writing-here",
    title: "Why I am writing here",
    path: "/writing/why-i-am-writing-here",
  },
];

type EditorStatus = "checking" | "signed-out" | "unauthorized" | "ready" | "error";
type SaveStatus = "published" | "changed" | "saving" | "saved" | "publishing" | "error";
type Drawer = "content" | "pages" | "history" | "settings" | null;
type CmsViewport = "desktop" | "tablet" | "mobile";

type ChatEntry = { id: string; role: "assistant" | "user"; text: string; ok?: boolean };

type NewPageDraft = {
  bodyMarkdown: string;
  slug: string;
  summary: string;
  title: string;
  topics: string;
};

type NewWorkDraft = WorkItem;

type WorkRemovalUndo = {
  index: number;
  item: WorkItem;
};

type MediaComposer = {
  alignment: ArticleMediaAlignment;
  alt: string;
  caption: string;
  editingId?: string;
  file?: File;
  imagePreparation?: CmsImagePreparation;
  insertAt: number;
  insertLabel?: string;
  placement: ArticleMediaPlacement;
  src: string;
  type: ArticleMediaType;
};

type MarkdownFormat = "bold" | "bullet" | "h2" | "h3" | "italic" | "link" | "numbered" | "quote";

export function CmsEditor() {
  const [active, setActive] = useState(false);
  const [pageId, setPageId] = useState("home");
  const [publicPath, setPublicPath] = useState("/");
  const [status, setStatus] = useState<EditorStatus>("checking");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("published");
  const [session, setSession] = useState<CmsSession | null>(null);
  const [manifest, setManifest] = useState<CmsManifest | null>(null);
  const [managedPages, setManagedPages] = useState<CmsPageReference[]>(fallbackPages);
  const [fragments, setFragments] = useState<Record<string, Record<string, unknown>>>({});
  const [registry, setRegistry] = useState<Record<string, CmsRegion>>({});
  const [dirty, setDirty] = useState<Record<string, CmsDirtyValue>>({});
  const [revisionId, setRevisionId] = useState<string>();
  const [versions, setVersions] = useState<CmsVersion[]>([]);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string>();
  const [viewport, setViewport] = useState<CmsViewport>("desktop");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loadNonce, setLoadNonce] = useState(0);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newWorkOpen, setNewWorkOpen] = useState(false);
  const [pageOperation, setPageOperation] = useState<"creating" | "hiding" | null>(null);
  const [newPage, setNewPage] = useState<NewPageDraft>(() => emptyNewPage());
  const [newWork, setNewWork] = useState<NewWorkDraft>(() => emptyNewWork());
  const [workRemovalUndo, setWorkRemovalUndo] = useState<WorkRemovalUndo | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [mediaComposer, setMediaComposer] = useState<MediaComposer | null>(null);
  const [mediaSaving, setMediaSaving] = useState(false);
  const [mediaPreparing, setMediaPreparing] = useState(false);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [failedMediaPreviewUrl, setFailedMediaPreviewUrl] = useState("");
  const [chatLog, setChatLog] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "I can create, read, update, publish, and hide CMS pages in this site workspace.",
    },
  ]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const markdownTextareaRef = useRef<HTMLTextAreaElement>(null);
  const brokerRef = useRef<CmsBroker | null>(null);
  const draftKeyRef = useRef("");
  const restoredDraftRef = useRef(false);
  const previewCleanupRef = useRef<() => void>(() => undefined);
  const attachPreviewRef = useRef<() => void>(() => undefined);
  const previewAttachTimerRef = useRef<number | undefined>(undefined);
  const refreshArticleControlsRef = useRef<() => void>(() => undefined);
  const mediaFilePreparationRef = useRef(0);
  const workRemovalUndoTimerRef = useRef<number | undefined>(undefined);
  const previewLoadedAtRef = useRef(0);
  const dirtyRef = useRef(dirty);
  const fragmentsRef = useRef(fragments);
  const registryRef = useRef(registry);
  const focusSnapshotRef = useRef(new Map<string, { html: string; value: string }>());
  const updateRegionRef = useRef<(regionId: string, value: CmsDirtyValue) => void>(() => undefined);
  const turndownRef = useRef(createArticleTurndownService());

  dirtyRef.current = dirty;
  fragmentsRef.current = fragments;
  registryRef.current = registry;

  useEffect(() => {
    const file = mediaComposer?.type === "image" ? mediaComposer.file : undefined;
    if (!file) {
      setMediaPreviewUrl("");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setMediaPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [mediaComposer?.file, mediaComposer?.type]);

  const mediaImagePreviewSrc =
    mediaComposer?.type === "image"
      ? mediaPreviewUrl || previewableImageSource(mediaComposer.src)
      : "";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cms") !== "1") return;
    const path = window.location.pathname;
    setActive(true);
    setPublicPath(path);
    setPageId(fallbackPages.find((page) => page.path === path)?.id || "home");
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let attempts = 0;

    async function connect() {
      const broker = window.usableCmsBroker;
      if (!broker) {
        attempts += 1;
        if (attempts < 50) window.setTimeout(connect, 100);
        else if (!cancelled) {
          setError("The Usable CMS broker could not be loaded.");
          setStatus("error");
        }
        return;
      }

      brokerRef.current = broker;
      try {
        const nextSession = await broker.session();
        if (cancelled) return;
        setSession(nextSession);
        if (!nextSession.signedIn) setStatus("signed-out");
        else if (!nextSession.authorized) setStatus("unauthorized");
        else setStatus("ready");
      } catch (nextError) {
        if (!cancelled) {
          setError(messageFrom(nextError));
          setStatus("error");
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    void loadNonce;
    if (status !== "ready" || !brokerRef.current) return;
    let cancelled = false;

    async function load() {
      try {
        const manifestResponse = await fetch("/api/cms/manifest", { cache: "no-store" });
        if (!manifestResponse.ok) throw new Error("The CMS manifest could not be loaded.");
        const localManifest = (await manifestResponse.json()) as CmsManifest;
        const pageDirectory = await brokerRef.current?.pages();
        const brokerPages = normalizeManagedPages(
          pageDirectory?.pages,
          localManifest.pages || fallbackPages,
        );
        const resolvedPage = brokerPages.find((page) => page.path === window.location.pathname);
        const resolvedPageId = resolvedPage?.id || pageId;
        const manifestWithPages: CmsManifest = {
          ...localManifest,
          pages: brokerPages,
          pageTemplates: pageDirectory?.pageTemplates?.length
            ? pageDirectory.pageTemplates
            : localManifest.pageTemplates,
        };
        const fragmentIds = Array.from(
          new Set(
            [
              ...manifestWithPages.regions.filter(
                (region) => region.scope === "global" || region.pageId === resolvedPageId,
              ),
              ...(manifestWithPages.collections || []).filter(
                (collection) => collection.id === "home.selectedWork",
              ),
            ]
              .map((region) => region.fragmentId as string | undefined)
              .concat(resolvedPage?.fragmentId)
              .filter((id): id is string => Boolean(id)),
          ),
        );
        const content = await brokerRef.current?.content({
          fragmentIds,
          workspaceId: localManifest.workspaceId,
        });
        const nextManifest = content?.manifest
          ? mergeManifests(manifestWithPages, content.manifest)
          : manifestWithPages;
        const nextPages = normalizeManagedPages(nextManifest.pages, brokerPages);
        const nextFragments = Object.fromEntries(
          (content?.fragments || []).map((fragment) => [
            fragment.id,
            parseContent(fragment.content),
          ]),
        );
        if (cancelled) return;

        setManifest(nextManifest);
        setManagedPages(nextPages);
        const matchedPage = nextPages.find((page) => page.path === window.location.pathname);
        const nextPageId = matchedPage?.id || resolvedPageId;
        if (nextPageId !== pageId) setPageId(nextPageId);
        if (matchedPage) setPublicPath(matchedPage.path);
        setFragments(nextFragments);
        setRegistry(registryFromManifest(nextManifest, nextPageId));
        draftKeyRef.current = `usable-cms:draft:${nextManifest.siteId}:${nextPageId}`;
        const savedDraft = window.localStorage.getItem(draftKeyRef.current);
        if (savedDraft) {
          const parsedDraft = JSON.parse(savedDraft) as Record<string, CmsDirtyValue>;
          const safeDraft = discardLegacyStableCollectionDrafts(parsedDraft, nextManifest);
          setDirty(safeDraft);
          setSaveStatus(Object.keys(safeDraft).length ? "changed" : "published");
        } else {
          setDirty({});
          setSaveStatus("published");
        }
        restoredDraftRef.current = true;
      } catch (nextError) {
        if (!cancelled) {
          if (isCmsAuthenticationError(nextError)) {
            setError("");
            setStatus("unauthorized");
          } else {
            setError(messageFrom(nextError));
            setSaveStatus("error");
          }
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadNonce, pageId, status]);

  useEffect(() => {
    if (status !== "ready") return;
    document.documentElement.classList.add("cms-editing");
    return () => document.documentElement.classList.remove("cms-editing");
  }, [status]);

  const changes = useMemo(
    () =>
      Object.entries(dirty)
        .map(([regionId, value]) => {
          const region = registry[regionId];
          if (!region?.fragmentId || !region.path) return null;
          if (
            manifest?.collections?.some(
              (collection) =>
                collection.id === regionId && requiresStableCollectionCommands(collection),
            )
          )
            return null;
          return {
            kind: "fragment" as const,
            targetId: region.fragmentId,
            path: region.path,
            afterRef: JSON.stringify(value) ?? "null",
          };
        })
        .filter((change): change is CmsChange => Boolean(change)),
    [dirty, manifest?.collections, registry],
  );

  const saveDraft = useCallback(async () => {
    const broker = brokerRef.current;
    if (!broker || !manifest || !changes.length) return;
    setSaveStatus("saving");
    try {
      const result = await broker.draft({
        revisionId,
        workspaceId: manifest.workspaceId,
        summary: `Update ${managedPages.find((page) => page.id === pageId)?.title || pageId}`,
        changes,
      });
      setRevisionId(result.revision.id);
      setSaveStatus("saved");
    } catch (nextError) {
      if (messageFrom(nextError).includes("Revision not found") && revisionId) {
        setRevisionId(undefined);
        setSaveStatus("changed");
        return;
      }
      setError(messageFrom(nextError));
      setSaveStatus("error");
    }
  }, [changes, managedPages, manifest, pageId, revisionId]);

  useEffect(() => {
    if (!restoredDraftRef.current) return;
    if (!Object.keys(dirty).length) {
      window.localStorage.removeItem(draftKeyRef.current);
      setSaveStatus((current) => (current === "publishing" ? current : "published"));
      return;
    }
    window.localStorage.setItem(draftKeyRef.current, JSON.stringify(dirty));
    setSaveStatus((current) => (current === "publishing" ? current : "changed"));
    const timer = window.setTimeout(() => void saveDraft(), 900);
    return () => window.clearTimeout(timer);
  }, [dirty, saveDraft]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!["changed", "saving", "publishing"].includes(saveStatus)) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [saveStatus]);

  function updateRegion(regionId: string, value: CmsDirtyValue) {
    const region = registryRef.current[regionId];
    const workLocation = workItemLocation(regionId, region?.path);
    const workCollection = selectedWorkCollection();
    if (workLocation && workCollection?.fragmentId && typeof value === "string") {
      if (requiresStableCollectionCommands(workCollection)) {
        setError(stableSelectedWorkReadOnlyMessage);
        return;
      }
      setDirty((current) => {
        const items = workItemsFromState(
          workCollection,
          current,
          fragmentsRef.current,
          registryRef.current,
        );
        const item = items[workLocation.index];
        if (!item) return current;
        item[workLocation.field] = value;
        return currentWorkDirtyState(
          current,
          items,
          workCollection,
          fragmentsRef.current,
          registryRef.current,
        );
      });
      return;
    }
    const baseline = region?.fragmentId
      ? readPathValue(fragmentsRef.current[region.fragmentId], region.path || "")
      : "";
    setDirty((current) => {
      const next = { ...current };
      if (sameValue(value, baseline)) delete next[regionId];
      else next[regionId] = value;
      return next;
    });
  }

  updateRegionRef.current = updateRegion;

  function valueForRegion(region: CmsRegion): string {
    const workLocation = workItemLocation(region.id, region.path);
    if (workLocation) {
      return currentWorkItemsFromRefs()[workLocation.index]?.[workLocation.field] || "";
    }
    const draftValue = dirty[region.id];
    return typeof draftValue === "string"
      ? draftValue
      : readPath(fragments[region.fragmentId || ""], region.path || "");
  }

  const applyValueToPreview = useCallback((region: CmsRegion, value: string) => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const elements = Array.from(doc.querySelectorAll<HTMLElement>("[data-usable-cms-region]"));
    const element =
      elements.find((candidate) => candidate.dataset.usableCmsRegion === region.id) ||
      elements.find(
        (candidate) =>
          candidate.dataset.usableCmsPath === region.path &&
          (!region.fragmentId || candidate.dataset.usableCmsFragmentId === region.fragmentId),
      );
    if (!element) return;
    if (region.kind === "image" && element instanceof HTMLImageElement) element.src = value;
    else if (region.kind === "link" && element instanceof HTMLAnchorElement) element.href = value;
    else if (region.path === "bodyMarkdown") {
      element.innerHTML = renderArticleMarkdownPreview(value);
      window.setTimeout(() => refreshArticleControlsRef.current(), 0);
    } else setEditableText(element, value);
  }, []);

  useEffect(() => {
    for (const [regionId, value] of Object.entries(dirty)) {
      const region = registry[regionId];
      if (region && typeof value === "string") applyValueToPreview(region, value);
    }
  }, [applyValueToPreview, dirty, registry]);

  const registerRegion = useCallback((region: CmsRegion) => {
    setRegistry((current) => (current[region.id] ? current : { ...current, [region.id]: region }));
  }, []);

  function attachPreview() {
    previewCleanupRef.current();
    setPreviewReady(false);
    setSelectedRegionId(undefined);
    const doc = frameRef.current?.contentDocument;
    if (!doc || !manifest) return;

    doc.documentElement.classList.add("cms-inline-preview");
    const workCollection = manifest.collections?.find(
      (collection) => collection.id === "home.selectedWork",
    );
    const workDraft = workCollection ? dirtyRef.current[workCollection.id] : undefined;
    const workDraftItems = Array.isArray(workDraft) ? normalizeWorkItems(workDraft) : undefined;
    const workItems = workCollection
      ? workItemsFromState(
          workCollection,
          dirtyRef.current,
          fragmentsRef.current,
          registryRef.current,
        )
      : [];
    if (workCollection && workDraftItems) {
      renderCurrentWorkPreview(doc, workItems, workCollection);
    }
    const cleanups: Array<() => void> = [];
    const runtimeRegions: Record<string, CmsRegion> = {};

    const handlePreviewNavigation = (event: Event) => {
      const target = event.target as Element | null;
      const anchor = target?.closest("a");
      if (!anchor) return;
      event.preventDefault();
      const containsEditableRegion =
        anchor.matches("[data-usable-cms-region]") ||
        Boolean(anchor.querySelector("[data-usable-cms-region]"));
      if (containsEditableRegion) return;
      const destination = new URL(anchor.getAttribute("href") || "", doc.location.href);
      if (destination.origin === doc.location.origin) navigateToPage(destination.pathname);
    };
    doc.addEventListener("click", handlePreviewNavigation, true);
    cleanups.push(() => doc.removeEventListener("click", handlePreviewNavigation, true));

    for (const element of doc.querySelectorAll<HTMLElement>("[data-usable-cms-region]")) {
      const id = element.dataset.usableCmsRegion;
      const path = element.dataset.usableCmsPath;
      const fragmentId = element.dataset.usableCmsFragmentId;
      if (!id || !path || !fragmentId) continue;
      const region: CmsRegion = {
        id,
        path,
        fragmentId,
        kind: asRegionKind(element.dataset.usableCmsKind),
        label: element.dataset.usableCmsLabel || "Editable content",
        pageId,
      };
      runtimeRegions[id] = region;
      const collectionValue =
        workDraftItems && region.path?.startsWith("selectedWork.")
          ? readPath({ selectedWork: workDraftItems }, region.path)
          : undefined;
      const liveValue =
        dirtyRef.current[id] ??
        collectionValue ??
        readPath(fragmentsRef.current[fragmentId], region.path || "");

      if (region.kind === "image" && element instanceof HTMLImageElement) {
        element.dataset.cmsEditable = "image";
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `Edit ${region.label}`);
        element.parentElement?.classList.add("cms-image-region");
        if (typeof liveValue === "string" && liveValue) element.src = liveValue;

        const selectImage = (event: Event) => {
          event.preventDefault();
          setNewWorkOpen(false);
          setSelectedRegionId(id);
          setDrawer(null);
        };
        const imageKeydown = (event: KeyboardEvent) => {
          if (!["Enter", " "].includes(event.key)) return;
          selectImage(event);
        };
        element.addEventListener("click", selectImage);
        element.addEventListener("keydown", imageKeydown);
        cleanups.push(() => {
          element.removeEventListener("click", selectImage);
          element.removeEventListener("keydown", imageKeydown);
        });
        continue;
      }

      if (region.path === "bodyBlocks") {
        element.dataset.cmsEditable = "structured";
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `Edit ${region.label}`);
        const selectBlocks = (event: Event) => {
          event.preventDefault();
          setNewWorkOpen(false);
          setSelectedRegionId(id);
          setDrawer(null);
        };
        const blocksKeydown = (event: KeyboardEvent) => {
          if (["Enter", " "].includes(event.key)) selectBlocks(event);
        };
        element.addEventListener("click", selectBlocks);
        element.addEventListener("keydown", blocksKeydown);
        cleanups.push(() => {
          element.removeEventListener("click", selectBlocks);
          element.removeEventListener("keydown", blocksKeydown);
        });
        continue;
      }

      if (
        region.path?.startsWith("selectedWork.") &&
        workCollection &&
        requiresStableCollectionCommands(workCollection)
      ) {
        element.dataset.cmsEditable = "read-only";
        element.removeAttribute("contenteditable");
        element.setAttribute(
          "title",
          "Manage this stable collection in the native Umbraco Block List editor.",
        );
        continue;
      }

      element.dataset.cmsEditable = "text";
      element.contentEditable = "true";
      element.spellcheck = true;
      element.tabIndex = 0;
      element.setAttribute("role", "textbox");
      element.setAttribute("aria-label", `Edit ${region.label}`);
      element.setAttribute("aria-multiline", region.path === "bodyMarkdown" ? "true" : "false");
      if (typeof liveValue === "string" && liveValue && region.path !== "bodyMarkdown")
        setEditableText(element, liveValue);

      const readValue = () => editableValue(element, region, turndownRef.current);
      const focus = () => {
        focusSnapshotRef.current.set(id, { html: element.innerHTML, value: readValue() });
        setNewWorkOpen(false);
        setSelectedRegionId(id);
        setDrawer(null);
      };
      const input = () => updateRegionRef.current(id, readValue());
      const blur = (event: FocusEvent) => {
        if (region.path !== "bodyMarkdown") return;
        const nextTarget = event.relatedTarget;
        if (nextTarget && element.contains(nextTarget as Node)) return;
        refreshArticleControlsRef.current();
      };
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          const previous = focusSnapshotRef.current.get(id);
          if (previous) {
            element.innerHTML = previous.html;
            updateRegionRef.current(id, previous.value);
          }
          element.blur();
        }
        if (event.key === "Enter" && region.path !== "bodyMarkdown") {
          event.preventDefault();
          element.blur();
        }
      };
      const paste = (event: ClipboardEvent) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") || "";
        doc.execCommand("insertText", false, text);
      };
      element.addEventListener("focus", focus);
      element.addEventListener("click", focus);
      element.addEventListener("input", input);
      element.addEventListener("blur", blur);
      element.addEventListener("keydown", keydown);
      element.addEventListener("paste", paste);
      cleanups.push(() => {
        element.removeEventListener("focus", focus);
        element.removeEventListener("click", focus);
        element.removeEventListener("input", input);
        element.removeEventListener("blur", blur);
        element.removeEventListener("keydown", keydown);
        element.removeEventListener("paste", paste);
      });

      if (region.path === "bodyMarkdown") {
        let controlsCleanup: () => void = () => undefined;
        const refreshControls = () => {
          controlsCleanup();
          controlsCleanup = installArticleBodyControls(doc, element, {
            insert: (type, boundaryIndex, insertLabel) => {
              const draftValue = dirtyRef.current[id];
              const current =
                typeof draftValue === "string"
                  ? draftValue
                  : readPath(fragmentsRef.current[fragmentId], path);
              const insertionPoints = articleBodyInsertionPoints(current);
              const insertAt = insertionPoints[boundaryIndex] ?? current.length;
              setNewWorkOpen(false);
              setDrawer(null);
              setSelectedRegionId(id);
              openMediaComposer(region, type, undefined, insertAt, insertLabel);
            },
          });
        };
        refreshArticleControlsRef.current = refreshControls;
        refreshControls();
        cleanups.push(() => {
          controlsCleanup();
          if (refreshArticleControlsRef.current === refreshControls) {
            refreshArticleControlsRef.current = () => undefined;
          }
        });
      }
    }

    if (workCollection && pageId === "home" && !requiresStableCollectionCommands(workCollection)) {
      cleanups.push(
        installCurrentWorkControls(doc, workItems, {
          add: () => {
            setError("");
            setDrawer(null);
            setSelectedRegionId(undefined);
            setNewWorkOpen(true);
          },
          move: moveWorkItem,
          remove: removeWorkItem,
        }),
      );
    }

    setRegistry((current) => ({ ...current, ...runtimeRegions }));
    setPreviewReady(true);
    previewCleanupRef.current = () => {
      for (const cleanup of cleanups) cleanup();
    };
  }

  attachPreviewRef.current = attachPreview;

  function handlePreviewLoad() {
    setPreviewReady(false);
    previewLoadedAtRef.current = Date.now();
    window.clearTimeout(previewAttachTimerRef.current);
    previewAttachTimerRef.current = window.setTimeout(() => attachPreviewRef.current(), 800);
  }

  useEffect(() => {
    if (status !== "ready" || !manifest) return;
    const timer = window.setInterval(() => {
      const doc = frameRef.current?.contentDocument;
      const hydrationWindowElapsed = Date.now() - previewLoadedAtRef.current > 800;
      if (
        hydrationWindowElapsed &&
        doc?.readyState === "complete" &&
        !doc.documentElement.classList.contains("cms-inline-preview")
      ) {
        attachPreviewRef.current();
      }
    }, 300);
    return () => window.clearInterval(timer);
  }, [manifest, status]);

  useEffect(
    () => () => {
      window.clearTimeout(previewAttachTimerRef.current);
      window.clearTimeout(workRemovalUndoTimerRef.current);
      previewCleanupRef.current();
    },
    [],
  );

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    for (const element of doc.querySelectorAll<HTMLElement>("[data-cms-selected]")) {
      delete element.dataset.cmsSelected;
    }
    if (!selectedRegionId) return;
    const selected = Array.from(doc.querySelectorAll<HTMLElement>("[data-usable-cms-region]")).find(
      (element) => element.dataset.usableCmsRegion === selectedRegionId,
    );
    if (selected) selected.dataset.cmsSelected = "true";
  }, [selectedRegionId]);

  async function publish() {
    const broker = brokerRef.current;
    const activePage = managedPages.find((page) => page.id === pageId);
    const publishingPage = activePage?.status === "draft";
    if (!broker || !manifest || (!changes.length && !publishingPage)) return;
    setError("");
    setSaveStatus("publishing");
    try {
      const today = new Date().toISOString().slice(0, 10);
      const publicationChanges: CmsChange[] =
        publishingPage && activePage?.fragmentId
          ? [
              {
                kind: "fragment",
                targetId: activePage.fragmentId,
                path: "status",
                afterRef: JSON.stringify("published"),
              },
              {
                kind: "fragment",
                targetId: activePage.fragmentId,
                path: "publishedAt",
                afterRef: JSON.stringify(today),
              },
              {
                kind: "fragment",
                targetId: activePage.fragmentId,
                path: "updatedAt",
                afterRef: JSON.stringify(today),
              },
            ]
          : [];
      const publishedChanges = mergeChanges(changes, publicationChanges);
      await broker.publish(
        revisionId && !publishingPage
          ? { revisionId }
          : {
              workspaceId: manifest.workspaceId,
              summary: `Publish ${managedPages.find((page) => page.id === pageId)?.title || pageId}`,
              changes: publishedChanges,
            },
      );
      if (publishingPage && activePage) {
        await broker.publishPage(activePage.id);
        setManagedPages((current) =>
          current.map((page) => (page.id === activePage.id ? { ...page, status: "active" } : page)),
        );
      }
      setFragments((current) => {
        const next = { ...current };
        for (const [regionId, value] of Object.entries(dirty)) {
          const region = registry[regionId];
          if (!region?.fragmentId || !region.path) continue;
          next[region.fragmentId] = writePath(next[region.fragmentId], region.path, value);
        }
        for (const change of publicationChanges) {
          if (!change.path) continue;
          next[change.targetId] = writePath(
            next[change.targetId],
            change.path,
            JSON.parse(change.afterRef) as CmsDirtyValue,
          );
        }
        return next;
      });
      window.localStorage.removeItem(draftKeyRef.current);
      setDirty({});
      setRevisionId(undefined);
      clearWorkRemovalUndo();
      setSaveStatus("published");
      showToast(publishingPage ? "Page published" : "Site published");
    } catch (nextError) {
      setError(messageFrom(nextError));
      setSaveStatus("error");
    }
  }

  async function loadVersions() {
    setError("");
    setDrawer("history");
    setSelectedRegionId(undefined);
    try {
      const payload = await brokerRef.current?.versions();
      setVersions(payload?.versions || []);
    } catch (nextError) {
      setError(messageFrom(nextError));
    }
  }

  async function restore(versionId: string) {
    setError("");
    try {
      await brokerRef.current?.restore(versionId);
      showToast("Version restored");
      setPreviewNonce((current) => current + 1);
    } catch (nextError) {
      setError(messageFrom(nextError));
    }
  }

  async function upload(region: CmsRegion, file: File) {
    if (!brokerRef.current || !session?.capabilities?.upload) return;
    setSaveStatus("saving");
    try {
      const preparation = await prepareCmsImageUpload(file);
      const uploaded = await brokerRef.current.upload(preparation.file, {
        regionId: region.id,
        title: region.label,
      });
      const value = uploaded.url || absoluteCmsAssetUrl(uploaded.assetPath);
      if (!value) throw new Error("Usable did not return the uploaded asset path.");
      registerRegion(region);
      updateRegionRef.current(region.id, value);
      applyValueToPreview(region, value);
      showToast(preparation.optimized ? "Image optimized and uploaded" : "Image uploaded");
    } catch (nextError) {
      setError(messageFrom(nextError));
      setSaveStatus("error");
    }
  }

  function updateArticleMarkdown(region: CmsRegion, value: string, refresh = false) {
    updateRegion(region.id, value);
    applyValueToPreview(region, value);
    if (refresh) setPreviewNonce((current) => current + 1);
  }

  function formatArticleMarkdown(region: CmsRegion, format: MarkdownFormat) {
    const textarea = markdownTextareaRef.current;
    if (!textarea) return;
    const currentRaw = valueForRegion(region);
    const media = articleMediaBlocks(currentRaw);
    const current = articleMarkdownForEditor(currentRaw);
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = current.slice(start, end);
    const formatted = formatMarkdownSelection(format, selected);
    const blockFormat = ["bullet", "h2", "h3", "numbered", "quote"].includes(format);
    const suffix = !selected && blockFormat && current.slice(end).trim() ? "\n\n" : "";
    const next = `${current.slice(0, start)}${formatted.value}${suffix}${current.slice(end)}`;
    updateArticleMarkdown(region, articleMarkdownFromEditor(next, media));
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + formatted.selectionStart, start + formatted.selectionEnd);
    });
  }

  function openMediaComposer(
    region: CmsRegion,
    type: ArticleMediaType,
    media?: ArticleMediaBlock,
    insertAt?: number,
    insertLabel?: string,
  ) {
    mediaFilePreparationRef.current += 1;
    setMediaPreparing(false);
    setMediaComposer({
      alignment: media?.alignment || (media?.placement === "hero" ? "wide" : "center"),
      alt: media?.alt || "",
      caption: media?.caption || "",
      editingId: media?.id,
      insertAt: insertAt ?? valueForRegion(region).length,
      insertLabel,
      placement: media?.placement || "inline",
      src: media?.src || "",
      type: media?.type || type,
    });
    setError("");
  }

  function closeMediaComposer() {
    mediaFilePreparationRef.current += 1;
    setMediaPreparing(false);
    setMediaComposer(null);
  }

  async function prepareMediaFile(file: File, type: ArticleMediaType) {
    const requestId = ++mediaFilePreparationRef.current;
    setError("");
    if (type !== "image") {
      setMediaPreparing(false);
      setMediaComposer((current) => (current ? { ...current, file } : current));
      return;
    }

    setMediaPreparing(true);
    try {
      const imagePreparation = await prepareCmsImageUpload(file);
      if (mediaFilePreparationRef.current !== requestId) return;
      setMediaComposer((current) =>
        current ? { ...current, file: imagePreparation.file, imagePreparation } : current,
      );
    } catch (nextError) {
      if (mediaFilePreparationRef.current === requestId) setError(messageFrom(nextError));
    } finally {
      if (mediaFilePreparationRef.current === requestId) setMediaPreparing(false);
    }
  }

  async function saveArticleMedia(region: CmsRegion) {
    const broker = brokerRef.current;
    const composer = mediaComposer;
    if (!broker || !composer || mediaSaving) return;
    if (!composer.file && !composer.src.trim()) {
      setError("Choose a file or enter a media URL.");
      return;
    }
    if (composer.type === "image" && !composer.alt.trim()) {
      setError("Add alternative text for the image.");
      return;
    }

    setMediaSaving(true);
    setError("");
    try {
      let src = composer.src.trim();
      if (composer.file) {
        const uploaded = await broker.upload(composer.file, {
          regionId: region.id,
          title: composer.caption.trim() || composer.alt.trim() || composer.file.name,
        });
        src = uploaded.url || absoluteCmsAssetUrl(uploaded.assetPath) || "";
      }
      if (!src) throw new Error("Usable did not return a media URL.");

      const media: ArticleMediaBlock = {
        id: composer.editingId || `media-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
        type: composer.type,
        src,
        alt: composer.alt,
        caption: composer.caption,
        placement: composer.placement,
        alignment: composer.alignment,
      };
      const current = valueForRegion(region);
      const next = composer.editingId
        ? replaceArticleMedia(current, media)
        : insertArticleMedia(current, media, composer.insertAt);
      updateArticleMarkdown(region, next, media.placement === "hero");
      closeMediaComposer();
      showToast(composer.editingId ? "Media updated" : "Media added to draft");
    } catch (nextError) {
      setError(messageFrom(nextError));
      setSaveStatus("error");
    } finally {
      setMediaSaving(false);
    }
  }

  function deleteArticleMedia(region: CmsRegion, media: ArticleMediaBlock) {
    const next = removeArticleMedia(valueForRegion(region), media.id);
    updateArticleMarkdown(region, next, media.placement === "hero");
    showToast("Media removed from draft");
  }

  function updateSecondaryRegion(region: CmsRegion, value: string) {
    registerRegion(region);
    updateRegionRef.current(region.id, value);
    const selected = selectedRegionId ? registryRef.current[selectedRegionId] : undefined;
    const doc = frameRef.current?.contentDocument;
    if (!selected || !doc) return;
    const selectedElement = Array.from(
      doc.querySelectorAll<HTMLElement>("[data-usable-cms-region]"),
    ).find((candidate) => candidate.dataset.usableCmsRegion === selected.id);
    if (region.kind === "link") {
      const link = selectedElement?.closest("a");
      if (link) link.href = value;
    }
    if (region.path?.endsWith(".alt") && selectedElement instanceof HTMLImageElement) {
      selectedElement.alt = value;
    }
  }

  function discardDraft() {
    setDirty({});
    setRevisionId(undefined);
    setError("");
    setSelectedRegionId(undefined);
    clearWorkRemovalUndo();
    setPreviewNonce((current) => current + 1);
    showToast("Draft discarded");
  }

  function navigateToPage(path: string) {
    window.location.href = `${path}?cms=1`;
  }

  async function createPage() {
    const broker = brokerRef.current;
    if (!broker || !manifest || pageOperation) return;
    const slug = slugify(newPage.slug || newPage.title);
    const path = `/writing/${slug}`;
    if (!slug || !newPage.title.trim() || !newPage.summary.trim() || !newPage.bodyMarkdown.trim()) {
      setError("Title, slug, summary, and article body are required.");
      return;
    }
    if (managedPages.some((page) => page.path === path)) {
      setError("That writing URL is already used by another page.");
      return;
    }

    const id = `article-${slug}`;
    const today = new Date().toISOString().slice(0, 10);
    const bodyMarkdown = newPage.bodyMarkdown.trim();
    const content = {
      type: "article",
      title: newPage.title.trim(),
      slug,
      summary: newPage.summary.trim(),
      publishedAt: today,
      updatedAt: today,
      status: "draft",
      topics: newPage.topics
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean),
      canonicalUrl: `https://www.olavurellefsen.com${path}`,
      bodyBlocks: articleBodyFromMarkdown(bodyMarkdown),
    };

    setPageOperation("creating");
    setError("");
    try {
      const result = await broker.createPage({
        id,
        title: content.title,
        path,
        status: "draft",
        content,
        templateId: "founder-note",
        addToNavigation: false,
        regions: articleRegions({ id }),
      });
      const created = result.page || { id, title: content.title, path };
      setManagedPages((current) => normalizeManagedPages([created], current));
      setNewPage(emptyNewPage());
      setNewPageOpen(false);
      showToast("Draft page created");
      window.location.href = `${created.path || path}?cms=1`;
    } catch (nextError) {
      setError(messageFrom(nextError));
    } finally {
      setPageOperation(null);
    }
  }

  async function hidePage(page: CmsPageReference) {
    const broker = brokerRef.current;
    if (!broker || pageOperation || !page.fragmentId) return;
    if (!window.confirm(`Hide “${page.title}” from the public site? Its CMS fragment is retained.`))
      return;
    setPageOperation("hiding");
    setError("");
    try {
      await broker.deletePage(page.id);
      setManagedPages((current) => current.filter((candidate) => candidate.id !== page.id));
      showToast("Page hidden");
      if (page.id === pageId) window.location.href = "/writing?cms=1";
    } catch (nextError) {
      setError(messageFrom(nextError));
    } finally {
      setPageOperation(null);
    }
  }

  function selectedWorkCollection() {
    return manifest?.collections?.find((collection) => collection.id === "home.selectedWork");
  }

  function currentWorkItems(): WorkItem[] {
    const collection = selectedWorkCollection();
    if (!collection?.fragmentId) return [];
    return workItemsFromState(collection, dirty, fragments, registry);
  }

  function currentWorkItemsFromRefs(): WorkItem[] {
    const collection = selectedWorkCollection();
    if (!collection?.fragmentId) return [];
    return workItemsFromState(
      collection,
      dirtyRef.current,
      fragmentsRef.current,
      registryRef.current,
    );
  }

  function updateCurrentWork(items: WorkItem[], message: string) {
    const collection = selectedWorkCollection();
    if (!collection?.fragmentId) {
      setError("The Current work collection is not available in this CMS manifest.");
      return;
    }
    if (requiresStableCollectionCommands(collection)) {
      setError(stableSelectedWorkReadOnlyMessage);
      return;
    }
    registerRegion({
      id: collection.id,
      kind: "text",
      label: collection.label || "Current work",
      path: collection.path,
      fragmentId: collection.fragmentId,
      pageId: collection.pageId,
      scope: collection.scope,
    });
    setDirty((current) =>
      currentWorkDirtyState(current, items, collection, fragmentsRef.current, registryRef.current),
    );
    const doc = frameRef.current?.contentDocument;
    if (doc && renderCurrentWorkPreview(doc, items, collection)) {
      window.clearTimeout(previewAttachTimerRef.current);
      previewAttachTimerRef.current = window.setTimeout(() => attachPreviewRef.current(), 0);
    }
    showToast(message);
  }

  function addWorkItem() {
    if (
      !newWork.name.trim() ||
      !newWork.role.trim() ||
      !newWork.description.trim() ||
      !newWork.href.trim()
    ) {
      setError("Name, role, description, and link are required.");
      return;
    }
    try {
      new URL(newWork.href);
    } catch {
      setError("Enter a complete work link, including https://.");
      return;
    }
    clearWorkRemovalUndo();
    updateCurrentWork(
      [
        ...currentWorkItemsFromRefs(),
        {
          ...newWork,
          name: newWork.name.trim(),
          role: newWork.role.trim(),
          description: newWork.description.trim(),
          href: newWork.href.trim(),
        },
      ],
      "Work entry added to draft",
    );
    setNewWork(emptyNewWork());
    setNewWorkOpen(false);
    setError("");
    const newIndex = currentWorkItemsFromRefs().length;
    window.setTimeout(() => focusCurrentWorkItem(newIndex), 80);
  }

  function removeWorkItem(index: number) {
    const items = currentWorkItemsFromRefs();
    const item = items[index];
    if (!item) return;
    clearWorkRemovalUndo();
    setToast("");
    setWorkRemovalUndo({ index, item });
    workRemovalUndoTimerRef.current = window.setTimeout(() => {
      setWorkRemovalUndo(null);
      workRemovalUndoTimerRef.current = undefined;
    }, 6000);
    setSelectedRegionId(undefined);
    updateCurrentWork(
      items.filter((_, itemIndex) => itemIndex !== index),
      "",
    );
  }

  function undoWorkItemRemoval() {
    if (!workRemovalUndo) return;
    const { index, item } = workRemovalUndo;
    const items = currentWorkItemsFromRefs();
    items.splice(Math.min(index, items.length), 0, item);
    clearWorkRemovalUndo();
    updateCurrentWork(items, `Restored ${item.name}`);
  }

  function clearWorkRemovalUndo() {
    window.clearTimeout(workRemovalUndoTimerRef.current);
    workRemovalUndoTimerRef.current = undefined;
    setWorkRemovalUndo(null);
  }

  function moveWorkItem(index: number, direction: -1 | 1, focusPreview = true) {
    const items = currentWorkItemsFromRefs();
    const targetIndex = index + direction;
    if (!items[index] || !items[targetIndex]) return;
    clearWorkRemovalUndo();
    [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
    setSelectedRegionId(undefined);
    updateCurrentWork(items, `Moved ${items[targetIndex].name} ${direction < 0 ? "up" : "down"}`);
    if (focusPreview) window.setTimeout(() => focusCurrentWorkItem(targetIndex), 80);
  }

  function focusCurrentWorkItem(index: number) {
    const doc = frameRef.current?.contentDocument;
    const element = doc?.querySelector<HTMLElement>(
      `[data-usable-cms-region="home.work.${index}.name"]`,
    );
    if (!element) return;
    element.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center",
    });
    element.focus();
  }

  async function sendChat() {
    const broker = brokerRef.current;
    const message = chatMessage.trim();
    if (!broker || !manifest || !message || chatSending) return;
    const activePage = managedPages.find((page) => page.id === pageId);
    const fragmentId =
      activePage?.fragmentId ||
      Object.values(registry).find((region) => region.pageId === pageId)?.fragmentId;
    const saved = fragmentId ? fragments[fragmentId] : undefined;
    const draft = Object.entries(dirty).reduce((current, [regionId, value]) => {
      const region = registry[regionId];
      return region?.path ? writePath(current, region.path, value) : current;
    }, saved || {});

    setChatMessage("");
    setChatSending(true);
    setChatLog((current) => [...current, chatEntry("user", message)]);
    try {
      const result = await broker.chat(message, {
        activePageId: pageId,
        activePagePath: publicPath,
        changedPaths: Object.keys(dirty)
          .map((regionId) => registry[regionId]?.path)
          .filter(Boolean),
        draft,
        fragmentId,
        manifest,
        saved,
        workspaceId: manifest.workspaceId,
        capabilities: ["create", "read", "update", "publish", "hide"],
      });
      const applied = applyChatChanges(result, {
        fragmentId,
        manifest,
        pageId,
        applyValue: applyValueToPreview,
        registerRegion,
        updateRegion: updateRegionRef.current,
      });
      const responseText =
        chatResponseText(result) ||
        (applied
          ? "Draft updated. Review it in the canvas, then publish."
          : "CMS request completed.");
      setChatLog((current) => [...current, chatEntry("assistant", responseText, true)]);
      if (applied) showToast("Draft updated by Usable chat");
      else setLoadNonce((current) => current + 1);
    } catch (nextError) {
      const message = messageFrom(nextError);
      setChatLog((current) => [...current, chatEntry("assistant", message, false)]);
      setError(message);
    } finally {
      setChatSending(false);
    }
  }

  function showToast(message: string) {
    if (!message) return;
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function leaveCms() {
    window.location.href = publicPath;
  }

  const selectedRegion = selectedRegionId ? registry[selectedRegionId] : undefined;
  const companionRegions = useMemo(
    () => (selectedRegion && manifest ? companionsFor(selectedRegion, manifest) : []),
    [manifest, selectedRegion],
  );
  const selectedBodyMarkdown =
    selectedRegion?.path === "bodyMarkdown" ? valueForRegion(selectedRegion) : "";
  const selectedArticleMedia = articleMediaBlocks(selectedBodyMarkdown);
  const selectedEditorMarkdown = articleMarkdownForEditor(selectedBodyMarkdown);

  useEffect(() => {
    for (const region of companionRegions) registerRegion(region);
  }, [companionRegions, registerRegion]);

  if (!active) return null;

  if (status !== "ready") {
    const checking = status === "checking";
    return (
      <main className="cms-gate" aria-busy={checking}>
        <div className="cms-gate__mark" aria-hidden="true">
          {checking ? <LoaderCircle className="cms-spin" /> : <LogIn />}
        </div>
        <p className="cms-kicker">Usable CMS</p>
        <h1>Ólavur Ellefsen</h1>
        <p role={status === "unauthorized" || status === "error" ? "alert" : undefined}>
          {checking
            ? "Checking Usable login..."
            : status === "signed-out"
              ? "Sign in with Usable to edit this website."
              : status === "unauthorized"
                ? "Your Usable login may have expired. Sign in again to refresh access."
                : error}
        </p>
        <div className="cms-gate__actions">
          {status === "signed-out" || status === "unauthorized" ? (
            <button
              type="button"
              className="cms-primary-button"
              onClick={() =>
                void brokerRef.current?.login(window.location.href, {
                  forceLogin: status === "unauthorized",
                  sameTab: true,
                })
              }
            >
              <LogIn size={18} />
              {status === "unauthorized" ? "Sign in again" : "Sign in with Usable"}
            </button>
          ) : null}
          <button
            type="button"
            className="cms-secondary-button"
            onClick={leaveCms}
            disabled={checking}
          >
            Leave CMS
          </button>
        </div>
      </main>
    );
  }

  const settingsRegions = (manifest?.regions || []).filter(
    (region) =>
      region.scope === "global" &&
      region.path &&
      !region.path.includes("*") &&
      ["siteDescription"].includes(region.path),
  );
  const workItems = currentWorkItems();
  const selectedWork = selectedWorkCollection();
  const workCollectionReadOnly = selectedWork
    ? requiresStableCollectionCommands(selectedWork)
    : false;
  const writingPages = managedPages.filter((page) => page.path.startsWith("/writing/"));
  const activePage = managedPages.find((page) => page.id === pageId);
  const isUnpublishedPage = activePage?.status === "draft";
  const unpublishedContent = activePage?.fragmentId
    ? fragmentWithDirtyValues(activePage.fragmentId, fragments, registry, dirty)
    : undefined;
  const unpublishedPreview =
    isUnpublishedPage && activePage?.fragmentId
      ? draftArticlePreviewDocument(activePage, unpublishedContent)
      : undefined;

  return (
    <main className="cms-workspace" aria-label="Usable CMS inline editor">
      <header className="cms-topbar">
        <div className="cms-topbar__identity">
          <span className="cms-topbar__mark" aria-hidden="true">
            ÓE
          </span>
          <span>
            <strong>{activePage?.title}</strong>
            <small>{isUnpublishedPage ? "Draft · Usable CMS" : "Usable CMS"}</small>
          </span>
        </div>

        <div className="cms-topbar__tools">
          <button
            type="button"
            className="cms-tool-button"
            aria-pressed={drawer === "pages"}
            onClick={() => {
              setDrawer((current) => (current === "pages" ? null : "pages"));
              setSelectedRegionId(undefined);
            }}
            title="Pages"
          >
            <PanelLeft size={17} /> <span>Pages</span>
          </button>
          <button
            type="button"
            className="cms-tool-button"
            aria-pressed={drawer === "content"}
            onClick={() => {
              setDrawer((current) => (current === "content" ? null : "content"));
              setSelectedRegionId(undefined);
            }}
            title="Manage Current work and Writing"
          >
            <ListPlus size={17} /> <span>Content</span>
          </button>
          <ViewportSwitcher viewport={viewport} onChange={setViewport} />
          <button
            type="button"
            className="cms-icon-button"
            aria-pressed={drawer === "settings"}
            onClick={() => {
              setDrawer((current) => (current === "settings" ? null : "settings"));
              setSelectedRegionId(undefined);
            }}
            aria-label="Site settings"
            title="Site settings"
          >
            <Settings2 size={17} />
          </button>
          <button
            type="button"
            className="cms-icon-button"
            aria-pressed={drawer === "history"}
            onClick={() => void loadVersions()}
            aria-label="Version history"
            title="Version history"
          >
            <History size={17} />
          </button>
          <button
            type="button"
            className="cms-icon-button"
            aria-pressed={chatOpen}
            onClick={() => setChatOpen((current) => !current)}
            aria-label="Open Usable CMS chat"
            title="Usable CMS chat"
          >
            <MessageSquare size={17} />
          </button>
        </div>

        <div className="cms-topbar__actions">
          <span className={`cms-save-state cms-save-state--${saveStatus}`}>
            {saveStatus === "saving" || saveStatus === "publishing" ? (
              <LoaderCircle className="cms-spin" size={15} />
            ) : (
              <Check size={15} />
            )}
            {saveLabel(saveStatus, isUnpublishedPage)}
          </span>
          <button
            type="button"
            className="cms-icon-button"
            disabled={!changes.length}
            onClick={discardDraft}
            aria-label="Discard draft"
            title="Discard draft"
          >
            <Undo2 size={17} />
          </button>
          {isUnpublishedPage ? (
            <button
              type="button"
              className="cms-icon-button"
              disabled
              aria-label="Page is not published yet"
              title="Publish this page before opening its public URL"
            >
              <ExternalLink size={17} />
            </button>
          ) : (
            <a
              className="cms-icon-button"
              href={publicPath}
              target="_blank"
              rel="noreferrer"
              aria-label="View published page"
              title="View published page"
            >
              <ExternalLink size={17} />
            </a>
          )}
          <button
            type="button"
            className="cms-publish-button"
            onClick={() => void publish()}
            disabled={(!changes.length && !isUnpublishedPage) || saveStatus === "publishing"}
          >
            <Send size={16} />
            <span>
              {saveStatus === "publishing"
                ? "Publishing"
                : changes.length || isUnpublishedPage
                  ? "Publish"
                  : "Published"}
            </span>
          </button>
          <button
            type="button"
            className="cms-icon-button"
            onClick={leaveCms}
            aria-label="Leave CMS"
            title="Leave CMS"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <section className="cms-canvas">
        <div className={`cms-preview cms-preview--${viewport}`}>
          {!previewReady ? (
            <span className="cms-preview__loading">
              <LoaderCircle className="cms-spin" size={18} /> Loading page
            </span>
          ) : null}
          {manifest ? (
            <iframe
              key={previewNonce}
              ref={frameRef}
              src={unpublishedPreview ? undefined : `${publicPath}?cms-preview=1`}
              srcDoc={unpublishedPreview}
              title={`${activePage?.title || "Page"} inline editor`}
              onLoad={handlePreviewLoad}
            />
          ) : null}
        </div>
      </section>

      {drawer ? (
        <aside className="cms-drawer" aria-label={`${drawer} panel`}>
          <header>
            <div>
              <span className="cms-kicker">Usable CMS</span>
              <h2>
                {drawer === "content"
                  ? "Content"
                  : drawer === "pages"
                    ? "Pages"
                    : drawer === "history"
                      ? "History"
                      : "Site settings"}
              </h2>
            </div>
            <button
              type="button"
              className="cms-icon-button"
              onClick={() => setDrawer(null)}
              aria-label="Close panel"
              title="Close panel"
            >
              <X size={17} />
            </button>
          </header>
          <div className="cms-drawer__body">
            {error ? (
              <p className="cms-editor__error" role="alert">
                {error}
              </p>
            ) : null}
            {drawer === "content" ? (
              <div className="cms-content-manager">
                <section aria-labelledby="current-work-manager-title">
                  <header>
                    <div>
                      <span className="cms-kicker">Homepage</span>
                      <h3 id="current-work-manager-title">Current work</h3>
                    </div>
                    <button
                      type="button"
                      className="cms-collection-add"
                      disabled={workCollectionReadOnly}
                      onClick={() => {
                        setError("");
                        setNewWorkOpen(true);
                      }}
                    >
                      <Plus size={15} /> Add
                    </button>
                  </header>
                  <ol className="cms-collection-list cms-work-collection-list">
                    {workItems.map((item, index) => (
                      <li className="cms-work-list-item" key={workItemRenderKey(workItems, index)}>
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.role}</small>
                        </span>
                        <fieldset
                          className="cms-work-list-actions"
                          aria-label={`${item.name} order and removal controls`}
                        >
                          <button
                            type="button"
                            onClick={() => moveWorkItem(index, -1, false)}
                            disabled={workCollectionReadOnly || index === 0}
                            aria-label={`Move ${item.name} up`}
                            title="Move up"
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveWorkItem(index, 1, false)}
                            disabled={workCollectionReadOnly || index === workItems.length - 1}
                            aria-label={`Move ${item.name} down`}
                            title="Move down"
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            type="button"
                            className="cms-work-list-actions__remove"
                            disabled={workCollectionReadOnly}
                            onClick={() => removeWorkItem(index)}
                            aria-label={`Remove ${item.name} from Current work`}
                            title="Remove from Current work"
                          >
                            <Trash2 size={15} />
                          </button>
                        </fieldset>
                      </li>
                    ))}
                  </ol>
                  <p className="cms-content-manager__note">
                    {workCollectionReadOnly
                      ? "Selected work uses stable-ID commands and is read-only here. Manage it in the native Umbraco Block List editor."
                      : "Draft additions and removals appear in the preview immediately. Publish to make them public; use Discard draft to undo."}
                  </p>
                </section>

                <section aria-labelledby="writing-manager-title">
                  <header>
                    <div>
                      <span className="cms-kicker">Homepage and Writing</span>
                      <h3 id="writing-manager-title">Writing</h3>
                    </div>
                    <button
                      type="button"
                      className="cms-collection-add"
                      onClick={() => {
                        setError("");
                        setNewPageOpen(true);
                      }}
                    >
                      <Plus size={15} /> Add
                    </button>
                  </header>
                  <ol className="cms-collection-list">
                    {writingPages.map((page) => (
                      <li key={page.id}>
                        <button
                          type="button"
                          className="cms-collection-open"
                          onClick={() => navigateToPage(page.path)}
                        >
                          <span>
                            <strong>{page.title}</strong>
                            <small>
                              {page.status === "draft" ? "Draft · " : ""}
                              {page.path}
                            </small>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void hidePage(page)}
                          disabled={pageOperation !== null || !page.fragmentId}
                          aria-label={`Hide ${page.title} from Writing`}
                          title="Hide page and retain its CMS fragment"
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="cms-content-manager__note">
                    Removing writing hides the page from the public site and keeps its CMS fragment.
                  </p>
                </section>
              </div>
            ) : null}
            {drawer === "pages" ? (
              <>
                <button
                  type="button"
                  className="cms-create-page-button"
                  onClick={() => {
                    setError("");
                    setNewPageOpen(true);
                  }}
                >
                  <Plus size={16} /> New founder note
                </button>
                <nav className="cms-page-list" aria-label="Website pages">
                  {managedPages.map((page) => (
                    <div className="cms-page-row" key={page.id}>
                      <button
                        type="button"
                        aria-current={page.id === pageId ? "page" : undefined}
                        onClick={() => navigateToPage(page.path)}
                      >
                        <span>
                          {page.title}
                          {page.status === "draft" ? (
                            <small className="cms-page-status">Draft</small>
                          ) : null}
                        </span>
                        <ExternalLink size={15} />
                      </button>
                      {page.fragmentId && page.path.startsWith("/writing/") ? (
                        <button
                          type="button"
                          className="cms-page-hide"
                          onClick={() => void hidePage(page)}
                          disabled={pageOperation !== null}
                          aria-label={`Hide ${page.title}`}
                          title="Hide page and retain its CMS fragment"
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </nav>
              </>
            ) : null}
            {drawer === "history" ? (
              <div className="cms-version-list">
                {versions.length ? (
                  versions.map((version) => (
                    <div key={version.id}>
                      <span>
                        {version.summary || "Published version"}
                        <small>{formatDate(version.createdAt)}</small>
                      </span>
                      <button
                        type="button"
                        className="cms-icon-button"
                        onClick={() => void restore(version.id)}
                        disabled={!session?.capabilities?.restore}
                        aria-label="Restore version"
                        title="Restore version"
                      >
                        <RotateCcw size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p>No published versions yet.</p>
                )}
              </div>
            ) : null}
            {drawer === "settings" ? (
              <div className="cms-settings-fields">
                {settingsRegions.map((region) => (
                  <label key={region.id}>
                    <span>{region.label}</span>
                    <textarea
                      rows={4}
                      value={valueForRegion(region)}
                      onChange={(event) => updateRegion(region.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}

      {selectedRegion ? (
        <aside className="cms-inspector" aria-label="Selected element settings">
          <header>
            <div>
              <span className="cms-kicker">Selected</span>
              <h2>{selectedRegion.label}</h2>
            </div>
            <button
              type="button"
              className="cms-icon-button"
              onClick={() => setSelectedRegionId(undefined)}
              aria-label="Close inspector"
              title="Close inspector"
            >
              <X size={17} />
            </button>
          </header>
          <div className="cms-inspector__body">
            {selectedRegion.kind === "text" ? (
              selectedRegion.path === "bodyBlocks" ? (
                <CmsArticleBlocksEditor
                  value={bodyForRegion(selectedRegion, dirty, fragments)}
                  onChange={(value) => updateRegion(selectedRegion.id, value)}
                />
              ) : selectedRegion.path === "bodyMarkdown" ? (
                <div className="cms-markdown-editor">
                  <p className="cms-inspector__hint">
                    Edit the text directly on the page. Use the + controls between sections to add
                    images or video exactly where they belong.
                  </p>
                  <details className="cms-markdown-advanced">
                    <summary>Formatting and Markdown</summary>
                    <div className="cms-markdown-advanced__body">
                      <div
                        className="cms-markdown-toolbar"
                        role="toolbar"
                        aria-label="Article formatting"
                      >
                        <MarkdownTool
                          label="Section heading"
                          onClick={() => formatArticleMarkdown(selectedRegion, "h2")}
                        >
                          <Heading2 size={16} />
                        </MarkdownTool>
                        <MarkdownTool
                          label="Subheading"
                          onClick={() => formatArticleMarkdown(selectedRegion, "h3")}
                        >
                          <Heading3 size={16} />
                        </MarkdownTool>
                        <MarkdownTool
                          label="Bold"
                          onClick={() => formatArticleMarkdown(selectedRegion, "bold")}
                        >
                          <Bold size={16} />
                        </MarkdownTool>
                        <MarkdownTool
                          label="Italic"
                          onClick={() => formatArticleMarkdown(selectedRegion, "italic")}
                        >
                          <Italic size={16} />
                        </MarkdownTool>
                        <MarkdownTool
                          label="Link"
                          onClick={() => formatArticleMarkdown(selectedRegion, "link")}
                        >
                          <Link2 size={16} />
                        </MarkdownTool>
                        <MarkdownTool
                          label="Bulleted list"
                          onClick={() => formatArticleMarkdown(selectedRegion, "bullet")}
                        >
                          <List size={16} />
                        </MarkdownTool>
                        <MarkdownTool
                          label="Numbered list"
                          onClick={() => formatArticleMarkdown(selectedRegion, "numbered")}
                        >
                          <ListOrdered size={16} />
                        </MarkdownTool>
                        <MarkdownTool
                          label="Quote"
                          onClick={() => formatArticleMarkdown(selectedRegion, "quote")}
                        >
                          <Quote size={16} />
                        </MarkdownTool>
                      </div>
                      <label className="cms-inspector__field">
                        <span>Article Markdown</span>
                        <textarea
                          ref={markdownTextareaRef}
                          rows={18}
                          value={selectedEditorMarkdown}
                          onChange={(event) =>
                            updateArticleMarkdown(
                              selectedRegion,
                              articleMarkdownFromEditor(event.target.value, selectedArticleMedia),
                            )
                          }
                        />
                      </label>
                    </div>
                  </details>
                  <section className="cms-media-list" aria-label="Article media">
                    <header>
                      <strong>Media</strong>
                      <span>{selectedArticleMedia.length || "None yet"}</span>
                    </header>
                    {selectedArticleMedia.map((media) => (
                      <article key={media.id} className="cms-media-card">
                        <div className="cms-media-card__preview">
                          {media.type === "video" ? (
                            <Video size={20} />
                          ) : (
                            <Image src={media.src} alt="" width={48} height={42} unoptimized />
                          )}
                        </div>
                        <span>
                          <strong>
                            {media.caption ||
                              media.alt ||
                              (media.type === "video" ? "Video" : "Image")}
                          </strong>
                          <small>
                            {media.placement} · {media.alignment}
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() => openMediaComposer(selectedRegion, media.type, media)}
                          aria-label={`Edit ${media.caption || media.alt || media.type}`}
                          title="Edit media"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteArticleMedia(selectedRegion, media)}
                          aria-label={`Remove ${media.caption || media.alt || media.type}`}
                          title="Remove media"
                        >
                          <Trash2 size={15} />
                        </button>
                      </article>
                    ))}
                  </section>
                </div>
              ) : (
                <p className="cms-inspector__hint">
                  Type directly where the text appears on the page.
                </p>
              )
            ) : null}
            {selectedRegion.kind === "image" ? (
              <>
                <label className="cms-upload-control">
                  <ImageUp size={17} />
                  <span>Replace image</span>
                  <input
                    type="file"
                    accept="image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(selectedRegion, file);
                    }}
                  />
                </label>
                <label className="cms-inspector__field">
                  <span>Image URL</span>
                  <input
                    type="url"
                    value={valueForRegion(selectedRegion)}
                    onChange={(event) => {
                      updateRegion(selectedRegion.id, event.target.value);
                      applyValueToPreview(selectedRegion, event.target.value);
                    }}
                  />
                </label>
              </>
            ) : null}
            {companionRegions.map((region) => (
              <label className="cms-inspector__field" key={region.id}>
                <span>{region.label}</span>
                <input
                  type={region.kind === "link" ? "url" : "text"}
                  value={valueForRegion(region)}
                  onChange={(event) => updateSecondaryRegion(region, event.target.value)}
                />
              </label>
            ))}
          </div>
        </aside>
      ) : null}

      {mediaComposer && selectedRegion?.path === "bodyMarkdown" ? (
        <div className="cms-modal-backdrop" role="presentation">
          <section
            className="cms-page-modal cms-media-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-editor-title"
          >
            <header>
              <div>
                <span className="cms-kicker">Article media</span>
                <h2 id="media-editor-title">
                  {mediaComposer.editingId ? "Edit" : "Add"} {mediaComposer.type}
                </h2>
              </div>
              <button
                type="button"
                className="cms-icon-button"
                onClick={closeMediaComposer}
                aria-label="Close media editor"
                title="Close media editor"
              >
                <X size={17} />
              </button>
            </header>
            <div className="cms-page-form">
              {mediaComposer.insertLabel && !mediaComposer.editingId ? (
                <p className="cms-media-destination">
                  <span>Insert location</span>
                  <strong>After {mediaComposer.insertLabel}</strong>
                </p>
              ) : null}
              <label className="cms-upload-control">
                <ImageUp size={17} />
                <span>
                  {mediaComposer.file
                    ? mediaComposer.file.name
                    : mediaComposer.editingId
                      ? "Replace file (optional)"
                      : "Choose file"}
                </span>
                <input
                  type="file"
                  accept={
                    mediaComposer.type === "video"
                      ? "video/mp4,video/quicktime,video/webm"
                      : "image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp"
                  }
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void prepareMediaFile(file, mediaComposer.type);
                  }}
                />
              </label>
              {mediaPreparing ? (
                <output className="cms-media-optimization" aria-live="polite">
                  <LoaderCircle className="cms-spin" size={15} />
                  Preparing image for the web…
                </output>
              ) : mediaComposer.imagePreparation ? (
                <output className="cms-media-optimization" aria-live="polite">
                  <Check size={15} />
                  <span>
                    {mediaComposer.imagePreparation.optimized ? (
                      <>
                        Optimized for the web:{" "}
                        {formatUploadBytes(mediaComposer.imagePreparation.originalBytes)} →{" "}
                        {formatUploadBytes(mediaComposer.imagePreparation.uploadBytes)}
                        {mediaComposer.imagePreparation.width &&
                        mediaComposer.imagePreparation.height
                          ? " · " +
                            mediaComposer.imagePreparation.width +
                            "×" +
                            mediaComposer.imagePreparation.height
                          : ""}
                      </>
                    ) : (
                      <>
                        Ready to upload ·{" "}
                        {formatUploadBytes(mediaComposer.imagePreparation.uploadBytes)}
                      </>
                    )}
                  </span>
                </output>
              ) : null}
              {mediaImagePreviewSrc ? (
                <figure className="cms-media-preview">
                  <div className="cms-media-preview__canvas">
                    {failedMediaPreviewUrl === mediaImagePreviewSrc ? (
                      <output className="cms-media-preview__error">
                        <ImageOff size={24} aria-hidden="true" />
                        <span>
                          Preview unavailable. Check the image URL or choose another file.
                        </span>
                      </output>
                    ) : (
                      // biome-ignore lint/performance/noImgElement: Blob and arbitrary author-provided URLs need a browser-native preview before upload.
                      <img
                        src={mediaImagePreviewSrc}
                        alt={mediaComposer.alt.trim() || "Selected image preview"}
                        onError={() => setFailedMediaPreviewUrl(mediaImagePreviewSrc)}
                      />
                    )}
                  </div>
                  <figcaption>
                    <strong>Preview</strong>
                    <span>
                      {mediaComposer.file?.name || mediaComposer.caption.trim() || "Current image"}
                    </span>
                  </figcaption>
                </figure>
              ) : null}
              <label>
                <span>Or media URL</span>
                <input
                  type="url"
                  placeholder="https://"
                  value={mediaComposer.src}
                  onChange={(event) =>
                    setMediaComposer((current) =>
                      current ? { ...current, src: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label>
                <span>
                  {mediaComposer.type === "image" ? "Alternative text" : "Accessible label"}
                </span>
                <input
                  value={mediaComposer.alt}
                  onChange={(event) =>
                    setMediaComposer((current) =>
                      current ? { ...current, alt: event.target.value } : current,
                    )
                  }
                />
                <small>Describe the media for people using assistive technology.</small>
              </label>
              <label>
                <span>Caption</span>
                <textarea
                  rows={3}
                  value={mediaComposer.caption}
                  onChange={(event) =>
                    setMediaComposer((current) =>
                      current ? { ...current, caption: event.target.value } : current,
                    )
                  }
                />
              </label>
              <div
                className={`cms-media-options${mediaComposer.insertLabel ? " cms-media-options--single" : ""}`}
              >
                {!mediaComposer.insertLabel ? (
                  <label>
                    <span>Placement</span>
                    <select
                      value={mediaComposer.placement}
                      onChange={(event) =>
                        setMediaComposer((current) =>
                          current
                            ? {
                                ...current,
                                placement: event.target.value as ArticleMediaPlacement,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="inline">Inline</option>
                      <option value="hero">Hero</option>
                    </select>
                  </label>
                ) : null}
                <label>
                  <span>Alignment</span>
                  <select
                    value={mediaComposer.alignment}
                    onChange={(event) =>
                      setMediaComposer((current) =>
                        current
                          ? { ...current, alignment: event.target.value as ArticleMediaAlignment }
                          : current,
                      )
                    }
                  >
                    <option value="center">Centered</option>
                    <option value="wide">Wide</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              </div>
              {error ? (
                <p className="cms-editor__error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <footer>
              <button type="button" className="cms-secondary-button" onClick={closeMediaComposer}>
                Cancel
              </button>
              <button
                type="button"
                className="cms-primary-button"
                onClick={() => void saveArticleMedia(selectedRegion)}
                disabled={mediaSaving || mediaPreparing}
              >
                {mediaSaving || mediaPreparing ? (
                  <LoaderCircle className="cms-spin" size={16} />
                ) : (
                  <ImagePlus size={16} />
                )}
                {mediaPreparing
                  ? "Preparing"
                  : mediaSaving
                    ? "Uploading"
                    : mediaComposer.editingId
                      ? "Save media"
                      : "Add media"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {newWorkOpen ? (
        <aside className="cms-inspector cms-work-inspector" aria-label="Add Current work">
          <header>
            <div>
              <span className="cms-kicker">Current work</span>
              <h2>Add work item</h2>
            </div>
            <button
              type="button"
              className="cms-icon-button"
              onClick={() => setNewWorkOpen(false)}
              aria-label="Close new work inspector"
              title="Close inspector"
            >
              <X size={17} />
            </button>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addWorkItem();
            }}
          >
            <div className="cms-inspector__body cms-work-inspector__body">
              <p className="cms-inspector__hint">
                Add the item here, then edit its visible text directly on the page.
              </p>
              <div className="cms-page-form cms-work-form">
                <label>
                  <span>Name</span>
                  <input
                    value={newWork.name}
                    onChange={(event) =>
                      setNewWork((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Role</span>
                  <input
                    value={newWork.role}
                    onChange={(event) =>
                      setNewWork((current) => ({ ...current, role: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Description</span>
                  <textarea
                    rows={4}
                    value={newWork.description}
                    onChange={(event) =>
                      setNewWork((current) => ({ ...current, description: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Work URL</span>
                  <input
                    type="url"
                    placeholder="https://"
                    value={newWork.href}
                    onChange={(event) =>
                      setNewWork((current) => ({ ...current, href: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Number accent</span>
                  <select
                    value={newWork.accent}
                    onChange={(event) =>
                      setNewWork((current) => ({
                        ...current,
                        accent: event.target.value as WorkItem["accent"],
                      }))
                    }
                  >
                    <option value="coral">Coral</option>
                    <option value="blue">Blue</option>
                    <option value="green">Green</option>
                    <option value="yellow">Yellow</option>
                  </select>
                </label>
              </div>
              {error ? (
                <p className="cms-editor__error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <footer className="cms-work-inspector__actions">
              <button
                type="button"
                className="cms-secondary-button"
                onClick={() => setNewWorkOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="cms-primary-button">
                <Plus size={16} /> Add to draft
              </button>
            </footer>
          </form>
        </aside>
      ) : null}

      {newPageOpen ? (
        <div className="cms-modal-backdrop" role="presentation">
          <section
            className="cms-page-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-page-title"
          >
            <header>
              <div>
                <span className="cms-kicker">Founder note template</span>
                <h2 id="new-page-title">Create a writing page</h2>
              </div>
              <button
                type="button"
                className="cms-icon-button"
                onClick={() => setNewPageOpen(false)}
                aria-label="Close new page dialog"
              >
                <X size={17} />
              </button>
            </header>
            <p>
              This creates one independently editable CMS Page fragment as an unpublished draft.
              Review it in the editor, then publish it when it is ready.
            </p>
            <div className="cms-page-form">
              <label>
                <span>Title</span>
                <input
                  value={newPage.title}
                  onChange={(event) =>
                    setNewPage((current) => ({
                      ...current,
                      title: event.target.value,
                      slug: current.slug || slugify(event.target.value),
                    }))
                  }
                />
              </label>
              <label>
                <span>URL slug</span>
                <input
                  value={newPage.slug}
                  onChange={(event) =>
                    setNewPage((current) => ({ ...current, slug: slugify(event.target.value) }))
                  }
                />
                <small>/writing/{slugify(newPage.slug || newPage.title) || "new-note"}</small>
              </label>
              <label>
                <span>Summary</span>
                <textarea
                  rows={3}
                  value={newPage.summary}
                  onChange={(event) =>
                    setNewPage((current) => ({ ...current, summary: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Topics, separated by commas</span>
                <input
                  value={newPage.topics}
                  onChange={(event) =>
                    setNewPage((current) => ({ ...current, topics: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Article body (Markdown)</span>
                <textarea
                  rows={12}
                  value={newPage.bodyMarkdown}
                  onChange={(event) =>
                    setNewPage((current) => ({ ...current, bodyMarkdown: event.target.value }))
                  }
                />
              </label>
            </div>
            {error ? (
              <p className="cms-editor__error" role="alert">
                {error}
              </p>
            ) : null}
            <footer>
              <button
                type="button"
                className="cms-secondary-button"
                onClick={() => setNewPageOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cms-primary-button"
                onClick={() => void createPage()}
                disabled={pageOperation === "creating"}
              >
                {pageOperation === "creating" ? (
                  <LoaderCircle className="cms-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {pageOperation === "creating" ? "Creating" : "Create draft"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {chatOpen ? (
        <aside className="cms-chat" aria-label="Usable CMS chat">
          <header>
            <div>
              <span className="cms-kicker">Workspace tools</span>
              <h2>Usable chat</h2>
            </div>
            <button
              type="button"
              className="cms-icon-button"
              onClick={() => setChatOpen(false)}
              aria-label="Close Usable CMS chat"
            >
              <X size={17} />
            </button>
          </header>
          <div className="cms-chat__log" aria-live="polite">
            {chatLog.map((entry) => (
              <article key={entry.id} data-role={entry.role} data-ok={entry.ok}>
                <strong>{entry.role === "user" ? "You" : "Usable"}</strong>
                <p>{entry.text}</p>
              </article>
            ))}
          </div>
          <fieldset className="cms-chat__suggestions">
            <legend>Suggested CMS requests</legend>
            {["Summarise this page", "Improve the summary", "List the published notes"].map(
              (suggestion) => (
                <button key={suggestion} type="button" onClick={() => setChatMessage(suggestion)}>
                  {suggestion}
                </button>
              ),
            )}
          </fieldset>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendChat();
            }}
          >
            <textarea
              aria-label="Ask Usable chat to work with CMS content"
              rows={4}
              placeholder="Create, read, update, publish, or hide content…"
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
              disabled={chatSending}
            />
            <button
              type="submit"
              className="cms-primary-button"
              disabled={chatSending || !chatMessage.trim()}
            >
              {chatSending ? <LoaderCircle className="cms-spin" size={16} /> : <Send size={16} />}
              {chatSending ? "Sending" : "Send"}
            </button>
          </form>
        </aside>
      ) : null}

      {error && !drawer ? (
        <p className="cms-floating-error" role="alert">
          {error}
        </p>
      ) : null}
      {workRemovalUndo ? (
        <output className="cms-toast cms-toast--action" aria-live="polite">
          <span>Removed {workRemovalUndo.item.name} from draft</span>
          <button type="button" onClick={undoWorkItemRemoval}>
            <Undo2 size={15} /> Undo
          </button>
        </output>
      ) : toast ? (
        <output className="cms-toast" aria-live="polite">
          {toast}
        </output>
      ) : null}
    </main>
  );
}

function CmsArticleBlocksEditor({
  value,
  onChange,
}: {
  value: ArticleBody;
  onChange: (value: ArticleBody) => void;
}) {
  const update = (index: number, block: ArticleBody["blocks"][number]) => {
    const blocks = [...value.blocks];
    blocks[index] = block;
    onChange({ version: 1, blocks });
  };
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= value.blocks.length) return;
    const blocks = [...value.blocks];
    const [block] = blocks.splice(index, 1);
    blocks.splice(destination, 0, block);
    onChange({ version: 1, blocks });
  };
  const remove = (index: number) => {
    onChange({ version: 1, blocks: value.blocks.filter((_, itemIndex) => itemIndex !== index) });
  };
  const add = (type: ArticleBody["blocks"][number]["type"]) => {
    onChange({ version: 1, blocks: [...value.blocks, newCmsArticleBlock(type)] });
  };

  return (
    <div className="cms-body-blocks">
      <p className="cms-inspector__hint">
        These are the same portable blocks projected into Umbraco. Drafts remain private until
        Publish.
      </p>
      <div className="cms-body-blocks__list">
        {value.blocks.map((block, index) => (
          <section className="cms-body-block" key={block.id}>
            <header>
              <strong>{block.type === "richText" ? "Text section" : block.type}</strong>
              <span>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === value.blocks.length - 1}
                >
                  ↓
                </button>
                <button type="button" onClick={() => remove(index)}>
                  Remove
                </button>
              </span>
            </header>
            {block.type === "heading" ? (
              <div className="cms-body-block__row">
                <select
                  value={block.level}
                  onChange={(event) =>
                    update(index, { ...block, level: Number(event.target.value) as 2 | 3 | 4 })
                  }
                >
                  <option value="2">H2</option>
                  <option value="3">H3</option>
                  <option value="4">H4</option>
                </select>
                <input
                  aria-label="Heading text"
                  value={block.text}
                  onChange={(event) => update(index, { ...block, text: event.target.value })}
                />
              </div>
            ) : null}
            {block.type === "richText" ? (
              <label>
                <span>Section text</span>
                <textarea
                  rows={8}
                  value={block.markdown}
                  onChange={(event) => update(index, { ...block, markdown: event.target.value })}
                />
              </label>
            ) : null}
            {block.type === "list" ? (
              <>
                <select
                  value={block.style}
                  onChange={(event) =>
                    update(index, {
                      ...block,
                      style: event.target.value as "ordered" | "unordered",
                    })
                  }
                >
                  <option value="unordered">Bulleted list</option>
                  <option value="ordered">Numbered list</option>
                </select>
                <textarea
                  aria-label="List items"
                  rows={5}
                  value={block.items.join("\n")}
                  onChange={(event) =>
                    update(index, { ...block, items: event.target.value.split("\n") })
                  }
                />
              </>
            ) : null}
            {block.type === "quote" ? (
              <textarea
                aria-label="Quote"
                rows={5}
                value={block.markdown}
                onChange={(event) => update(index, { ...block, markdown: event.target.value })}
              />
            ) : null}
            {block.type === "media" ? (
              <div className="cms-body-block__media">
                <input
                  aria-label="Asset URL"
                  type="url"
                  placeholder="Asset URL"
                  value={block.media.src}
                  onChange={(event) =>
                    update(index, { ...block, media: { ...block.media, src: event.target.value } })
                  }
                />
                <input
                  aria-label="Alternative text"
                  placeholder="Alternative text"
                  value={block.media.alt}
                  onChange={(event) =>
                    update(index, { ...block, media: { ...block.media, alt: event.target.value } })
                  }
                />
                <textarea
                  aria-label="Caption"
                  placeholder="Caption"
                  rows={3}
                  value={block.media.caption}
                  onChange={(event) =>
                    update(index, {
                      ...block,
                      media: { ...block.media, caption: event.target.value },
                    })
                  }
                />
                <select
                  value={block.media.alignment}
                  onChange={(event) =>
                    update(index, {
                      ...block,
                      media: {
                        ...block.media,
                        alignment: event.target.value as "center" | "wide" | "left" | "right",
                      },
                    })
                  }
                >
                  <option value="center">Center</option>
                  <option value="wide">Wide</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
            ) : null}
          </section>
        ))}
      </div>
      <fieldset className="cms-body-blocks__add">
        <legend>Add:</legend>
        {(["heading", "richText", "list", "quote", "media"] as const).map((type) => (
          <button type="button" key={type} onClick={() => add(type)}>
            {type === "richText" ? "Text" : type}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function bodyForRegion(
  region: CmsRegion,
  dirty: Record<string, CmsDirtyValue>,
  fragments: Record<string, Record<string, unknown>>,
): ArticleBody {
  const draft = articleBodySchema.safeParse(dirty[region.id]);
  if (draft.success) return draft.data;
  const fragment = fragments[region.fragmentId || ""];
  const canonical = articleBodySchema.safeParse(readPathValue(fragment, "bodyBlocks"));
  if (canonical.success) return canonical.data;
  return articleBodyFromMarkdown(readPath(fragment, "bodyMarkdown"));
}

function newCmsArticleBlock(
  type: ArticleBody["blocks"][number]["type"],
): ArticleBody["blocks"][number] {
  const id = `block-${crypto.randomUUID()}`;
  switch (type) {
    case "heading":
      return { id, type, level: 2, text: "New section" };
    case "richText":
      return { id, type, markdown: "Start writing here." };
    case "list":
      return { id, type, style: "unordered", items: ["First item"] };
    case "quote":
      return { id, type, markdown: "Quotation" };
    case "media":
      return {
        id,
        type,
        media: {
          id: `asset-${crypto.randomUUID()}`,
          type: "image",
          src: "",
          alt: "",
          caption: "",
          placement: "inline",
          alignment: "center",
        },
      };
  }
}

function ViewportSwitcher({
  viewport,
  onChange,
}: {
  viewport: CmsViewport;
  onChange: (viewport: CmsViewport) => void;
}) {
  const options = [
    { id: "desktop" as const, label: "Desktop preview", icon: Monitor },
    { id: "tablet" as const, label: "Tablet preview", icon: Tablet },
    { id: "mobile" as const, label: "Mobile preview", icon: Smartphone },
  ];
  return (
    <fieldset className="cms-viewport-switcher">
      <legend>Preview size</legend>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            aria-label={option.label}
            aria-pressed={viewport === option.id}
            title={option.label}
            onClick={() => onChange(option.id)}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </fieldset>
  );
}

function companionsFor(selected: CmsRegion, manifest: CmsManifest): CmsRegion[] {
  const companions: CmsRegion[] = [];
  const add = (template: CmsRegion | undefined, path?: string, label?: string) => {
    if (!template?.fragmentId || !path) return;
    companions.push({
      ...template,
      id: `${template.id}:${path}`,
      path,
      label: label || template.label,
      fragmentId: selected.fragmentId || template.fragmentId,
    });
  };

  if (selected.kind === "image" && selected.path?.endsWith(".src")) {
    const altPath = selected.path.replace(/\.src$/, ".alt");
    add(
      manifest.regions.find((region) => region.path === altPath),
      altPath,
      "Alternative text",
    );
  }

  if (selected.path?.endsWith(".linkLabel")) {
    const hrefPath = selected.path.replace(/\.linkLabel$/, ".href");
    add(
      manifest.regions.find((region) => region.path === hrefPath),
      hrefPath,
      "Link URL",
    );
  }

  const navigationMatch = selected.path?.match(/^navigation\.(\d+)\.label$/);
  if (navigationMatch) {
    const path = `navigation.${navigationMatch[1]}.href`;
    add(
      manifest.regions.find((region) => region.path === "navigation.*.href"),
      path,
      "Navigation URL",
    );
  }

  const workMatch = selected.path?.match(/^selectedWork\.(\d+)\./);
  if (workMatch) {
    companions.push({
      id: `home.work.${workMatch[1]}.href`,
      kind: "link",
      label: "Work URL",
      path: `selectedWork.${workMatch[1]}.href`,
      fragmentId: selected.fragmentId,
      pageId: selected.pageId,
    });
  }

  return companions;
}

function editableValue(element: HTMLElement, region: CmsRegion, turndown: TurndownService) {
  if (region.path === "bodyMarkdown") {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const control of clone.querySelectorAll("[data-cms-article-insert-control]")) {
      control.remove();
    }
    return turndown.turndown(clone.innerHTML).trim();
  }
  const clone = element.cloneNode(true) as HTMLElement;
  for (const decorative of clone.querySelectorAll('[aria-hidden="true"]')) decorative.remove();
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function setEditableText(element: HTMLElement, value: string) {
  const decorative = Array.from(element.children)
    .filter((child) => child.getAttribute("aria-hidden") === "true")
    .map((child) => child.cloneNode(true));
  element.textContent = value;
  for (const child of decorative) {
    element.append(element.ownerDocument.createTextNode(" "), child);
  }
}

function asRegionKind(value?: string): CmsRegion["kind"] {
  return value === "link" || value === "image" ? value : "text";
}

function parseContent(content: unknown): Record<string, unknown> {
  if (content && typeof content === "object" && !Array.isArray(content))
    return content as Record<string, unknown>;
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function readPath(content: Record<string, unknown> | undefined, path: string): string {
  const value = readPathValue(content, path);
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

function readPathValue(content: Record<string, unknown> | undefined, path: string): unknown {
  let value: unknown = content;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return "";
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function writePath(
  content: Record<string, unknown> | undefined,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const root = structuredClone(content || {});
  const parts = path.split(".");
  let target = root;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1) || path] = value;
  return root;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeWorkItems(value: unknown): WorkItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.name !== "string" ||
      typeof record.role !== "string" ||
      typeof record.description !== "string" ||
      typeof record.href !== "string" ||
      !["coral", "blue", "green", "yellow"].includes(String(record.accent))
    )
      return [];
    return [
      {
        ...(typeof record.$id === "string" ? { $id: record.$id } : {}),
        name: record.name,
        role: record.role,
        description: record.description,
        href: record.href,
        accent: record.accent as WorkItem["accent"],
      },
    ];
  });
}

function workItemRenderKey(items: WorkItem[], index: number): string {
  const item = items[index];
  const stableKey = stableCollectionItemKey(item, "$id");
  if (stableKey) return stableKey;
  const identity = [item.accent, item.name, item.role, item.description, item.href].join("\u001f");
  const occurrence = items
    .slice(0, index)
    .filter(
      (candidate) =>
        [
          candidate.accent,
          candidate.name,
          candidate.role,
          candidate.description,
          candidate.href,
        ].join("\u001f") === identity,
    ).length;
  return `${identity}\u001f${occurrence}`;
}

const stableSelectedWorkReadOnlyMessage =
  "Selected work is read-only here because this editor cannot emit item-ID-bound collection commands. Manage it in the native Umbraco Block List editor.";

function discardLegacyStableCollectionDrafts(
  draft: Record<string, CmsDirtyValue>,
  manifest: CmsManifest,
): Record<string, CmsDirtyValue> {
  const next = { ...draft };
  for (const collection of manifest.collections || []) {
    if (requiresStableCollectionCommands(collection)) delete next[collection.id];
  }
  return next;
}

function workItemLocation(regionId: string, path?: string) {
  const match =
    path?.match(/^selectedWork\.(\d+)\.(description|href|name|role)$/) ||
    regionId.match(/^home\.work\.(\d+)\.(description|href|name|role)$/);
  if (!match) return undefined;
  return { field: match[2] as WorkItemField, index: Number(match[1]) };
}

function workItemsFromState(
  collection: CmsCollection,
  dirty: Record<string, CmsDirtyValue>,
  fragments: Record<string, Record<string, unknown>>,
  registry: Record<string, CmsRegion>,
): WorkItem[] {
  if (!collection.fragmentId) return [];
  const collectionDraft = dirty[collection.id];
  const value = Array.isArray(collectionDraft)
    ? collectionDraft
    : readPathValue(fragments[collection.fragmentId], collection.path);
  const items = normalizeWorkItems(value);

  for (const [regionId, draftValue] of Object.entries(dirty)) {
    if (typeof draftValue !== "string") continue;
    const location = workItemLocation(regionId, registry[regionId]?.path);
    if (location && items[location.index]) {
      items[location.index][location.field] = draftValue;
    }
  }
  return items;
}

function currentWorkDirtyState(
  current: Record<string, CmsDirtyValue>,
  items: WorkItem[],
  collection: CmsCollection,
  fragments: Record<string, Record<string, unknown>>,
  registry: Record<string, CmsRegion>,
) {
  const next = { ...current };
  for (const regionId of Object.keys(next)) {
    if (regionId !== collection.id && workItemLocation(regionId, registry[regionId]?.path)) {
      delete next[regionId];
    }
  }
  const baseline = collection.fragmentId
    ? readPathValue(fragments[collection.fragmentId], collection.path)
    : [];
  if (sameValue(items, baseline)) delete next[collection.id];
  else next[collection.id] = items;
  return next;
}

function installArticleBodyControls(
  doc: Document,
  body: HTMLElement,
  handlers: {
    insert: (type: ArticleMediaType, boundaryIndex: number, insertLabel: string) => void;
  },
) {
  for (const existing of body.querySelectorAll("[data-cms-article-insert-control]")) {
    existing.remove();
  }

  const style = doc.createElement("style");
  style.dataset.cmsArticleInsertStyles = "true";
  style.textContent = `
    html.cms-inline-preview .cms-article-insert-control {
      position: relative;
      z-index: 30;
      height: 18px;
      margin: -9px 0;
      font-family: ui-sans-serif, system-ui, sans-serif;
      pointer-events: none;
    }
    html.cms-inline-preview .cms-article-insert-control__rail {
      position: absolute;
      top: 50%;
      left: -48px;
      display: flex;
      align-items: center;
      gap: 7px;
      transform: translateY(-50%);
      pointer-events: auto;
    }
    html.cms-inline-preview .cms-article-insert-control button {
      min-width: 34px;
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #bdc9c4;
      border-radius: 999px;
      background: #fbfcfa;
      color: #193630;
      box-shadow: 0 4px 14px rgb(19 43 39 / 10%);
      font: inherit;
      font-size: 12px;
      font-weight: 720;
      line-height: 1;
      cursor: pointer;
      transition: 160ms ease;
      transition-property: opacity, border-color, background-color, color, transform;
    }
    html.cms-inline-preview .cms-article-insert-control__trigger {
      width: 34px;
      padding: 0;
      opacity: .22;
      font-size: 22px;
      font-weight: 400;
    }
    html.cms-inline-preview .cms-article-insert-control:hover .cms-article-insert-control__trigger,
    html.cms-inline-preview .cms-article-insert-control:focus-within .cms-article-insert-control__trigger,
    html.cms-inline-preview .cms-article-insert-control.is-open .cms-article-insert-control__trigger,
    html.cms-inline-preview .body > :not([data-cms-article-insert-control]):hover + .cms-article-insert-control .cms-article-insert-control__trigger,
    html.cms-inline-preview .article-prose > :not([data-cms-article-insert-control]):hover + .cms-article-insert-control .cms-article-insert-control__trigger {
      opacity: 1;
      border-color: #ff7d61;
      color: #c84634;
      transform: scale(1.04);
    }
    html.cms-inline-preview .cms-article-insert-control__menu {
      position: absolute;
      top: 50%;
      right: calc(100% + 55px);
      display: flex;
      gap: 5px;
      padding: 4px;
      border: 1px solid #bdc9c4;
      border-radius: 6px;
      background: #fbfcfa;
      box-shadow: 0 8px 24px rgb(19 43 39 / 16%);
      transform: translateY(-50%);
      pointer-events: auto;
    }
    html.cms-inline-preview .cms-article-insert-control__menu[hidden] { display: none; }
    html.cms-inline-preview .cms-article-insert-control__menu button {
      min-width: auto;
      min-height: 34px;
      padding: 0 11px;
      border-radius: 4px;
      box-shadow: none;
    }
    html.cms-inline-preview .cms-article-insert-control button:hover,
    html.cms-inline-preview .cms-article-insert-control button:focus-visible {
      border-color: #ff7d61;
      outline: 2px solid rgb(255 125 97 / 24%);
      outline-offset: 2px;
      background: #fff6f3;
      color: #b83c2d;
    }
    @media (max-width: 700px) {
      html.cms-inline-preview .cms-article-insert-control__rail { left: -6px; }
      html.cms-inline-preview .cms-article-insert-control__menu {
        position: fixed;
        z-index: 50;
        right: 12px;
        bottom: 12px;
        left: 12px;
        top: auto;
        justify-content: stretch;
        transform: none;
      }
      html.cms-inline-preview .cms-article-insert-control__trigger {
        min-width: 44px;
        min-height: 44px;
        opacity: .7;
      }
      html.cms-inline-preview .cms-article-insert-control__menu button {
        flex: 1;
        min-height: 44px;
      }
    }
  `;
  doc.head.append(style);

  const cleanups: Array<() => void> = [];
  const controls: HTMLElement[] = [];
  const contentBlocks = Array.from(body.children).filter(
    (element) => !element.hasAttribute("data-cms-article-insert-control"),
  ) as HTMLElement[];

  const closeMenus = () => {
    for (const control of controls) {
      control.classList.remove("is-open");
      const menu = control.querySelector<HTMLElement>(".cms-article-insert-control__menu");
      const trigger = control.querySelector<HTMLButtonElement>(
        ".cms-article-insert-control__trigger",
      );
      if (menu) menu.hidden = true;
      trigger?.setAttribute("aria-expanded", "false");
    }
  };

  contentBlocks.forEach((block, boundaryIndex) => {
    const insertLabel = articleBlockLabel(block);
    const control = doc.createElement("div");
    control.className = "cms-article-insert-control";
    control.dataset.cmsArticleInsertControl = String(boundaryIndex);
    control.contentEditable = "false";
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", `Insert media after ${insertLabel}`);

    const rail = doc.createElement("div");
    rail.className = "cms-article-insert-control__rail";
    const trigger = doc.createElement("button");
    trigger.type = "button";
    trigger.className = "cms-article-insert-control__trigger";
    trigger.textContent = "+";
    trigger.title = `Add media after ${insertLabel}`;
    trigger.setAttribute("aria-label", `Add media after ${insertLabel}`);
    trigger.setAttribute("aria-expanded", "false");

    const menu = doc.createElement("div");
    menu.className = "cms-article-insert-control__menu";
    menu.hidden = true;
    menu.setAttribute("aria-label", `Choose media after ${insertLabel}`);

    const activate = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const opening = menu.hidden;
      closeMenus();
      menu.hidden = !opening;
      control.classList.toggle("is-open", opening);
      trigger.setAttribute("aria-expanded", String(opening));
    };
    trigger.addEventListener("click", activate);
    cleanups.push(() => trigger.removeEventListener("click", activate));

    for (const [type, text] of [
      ["image", "Image"],
      ["video", "Video"],
    ] as const) {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-label", `Add ${type} after ${insertLabel}`);
      const choose = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenus();
        handlers.insert(type, boundaryIndex, insertLabel);
      };
      button.addEventListener("click", choose);
      cleanups.push(() => button.removeEventListener("click", choose));
      menu.append(button);
    }

    rail.append(trigger);
    control.append(rail, menu);
    block.after(control);
    controls.push(control);
    cleanups.push(() => control.remove());
  });

  const closeFromOutside = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest("[data-cms-article-insert-control]")) closeMenus();
  };
  doc.addEventListener("click", closeFromOutside);
  cleanups.push(() => doc.removeEventListener("click", closeFromOutside));
  cleanups.push(() => style.remove());

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function articleBlockLabel(block: HTMLElement) {
  const mediaLabel =
    block.querySelector("figcaption")?.textContent ||
    block.querySelector("img")?.getAttribute("alt") ||
    block.querySelector("video")?.getAttribute("aria-label");
  const text = (mediaLabel || block.textContent || block.tagName.toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
  const shortened = text.length > 54 ? `${text.slice(0, 51).trimEnd()}…` : text;
  return `“${shortened || "article section"}”`;
}

function installCurrentWorkControls(
  doc: Document,
  items: WorkItem[],
  handlers: {
    add: () => void;
    move: (index: number, direction: -1 | 1) => void;
    remove: (index: number) => void;
  },
) {
  const list = doc.querySelector<HTMLOListElement>(".work-list");
  if (!list) return () => undefined;
  for (const existing of doc.querySelectorAll("[data-cms-collection-control]")) existing.remove();

  const cleanups: Array<() => void> = [];
  const rows = Array.from(list.children).filter(
    (element): element is HTMLLIElement => element.tagName === "LI",
  );
  const actionButton = (label: string, text: string, disabled: boolean, action: () => void) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.disabled = disabled;
    button.setAttribute("aria-label", label);
    button.title = label;
    const activate = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    button.addEventListener("click", activate);
    cleanups.push(() => button.removeEventListener("click", activate));
    return button;
  };

  rows.forEach((row, index) => {
    const item = items[index];
    if (!item) return;
    const controls = doc.createElement("div");
    controls.className = "cms-work-item-controls";
    controls.dataset.cmsCollectionControl = "work-item";
    controls.setAttribute("aria-label", `${item.name} order and removal controls`);
    controls.append(
      actionButton(`Move ${item.name} up`, "↑", index === 0, () => handlers.move(index, -1)),
      actionButton(`Move ${item.name} down`, "↓", index === rows.length - 1, () =>
        handlers.move(index, 1),
      ),
      actionButton(`Remove ${item.name} from Current work`, "×", false, () =>
        handlers.remove(index),
      ),
    );
    controls.lastElementChild?.classList.add("cms-work-item-controls__remove");
    row.append(controls);
    cleanups.push(() => controls.remove());
  });

  const collectionActions = doc.createElement("div");
  collectionActions.className = "cms-work-collection-actions";
  collectionActions.dataset.cmsCollectionControl = "current-work";
  const addButton = actionButton("Add work item", "+ Add work item", false, handlers.add);
  addButton.className = "cms-work-collection-actions__add";
  const hint = doc.createElement("p");
  hint.textContent = "Changes remain in draft until Publish.";
  collectionActions.append(addButton, hint);
  list.after(collectionActions);
  cleanups.push(() => collectionActions.remove());

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function renderCurrentWorkPreview(
  doc: Document,
  items: WorkItem[],
  collection: CmsCollection,
): boolean {
  const list = doc.querySelector<HTMLOListElement>(".work-list");
  if (!list || !collection.fragmentId) return false;

  const region = (element: HTMLElement, index: number, field: "name" | "role" | "description") => {
    element.dataset.usableCmsRegion = `home.work.${index}.${field}`;
    element.dataset.usableCmsKind = "text";
    element.dataset.usableCmsLabel = `Work ${index + 1} ${field}`;
    element.dataset.usableCmsPath = `selectedWork.${index}.${field}`;
    element.dataset.usableCmsFragmentId = collection.fragmentId || "";
  };

  const rows = items.map((item, index) => {
    const row = doc.createElement("li");
    row.dataset.accent = item.accent;

    const link = doc.createElement("a");
    link.href = item.href;

    const number = doc.createElement("span");
    number.className = "work-list__number";
    number.textContent = String(index + 1).padStart(2, "0");

    const title = doc.createElement("div");
    title.className = "work-list__title";
    const name = doc.createElement("h3");
    name.textContent = item.name;
    region(name, index, "name");
    const role = doc.createElement("p");
    role.textContent = item.role;
    region(role, index, "role");
    title.append(name, role);

    const description = doc.createElement("p");
    description.className = "work-list__description";
    description.textContent = item.description;
    region(description, index, "description");

    const arrow = doc.createElement("span");
    arrow.className = "work-list__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";

    link.append(number, title, description, arrow);
    row.append(link);
    return row;
  });

  list.replaceChildren(...rows);
  return true;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "The CMS request failed.";
}

function isCmsAuthenticationError(error: unknown): boolean {
  if (typeof error === "object" && error && "status" in error && error.status === 401) {
    return true;
  }

  return /(?:^|\D)401(?:\D|$)/.test(messageFrom(error));
}

function previewableImageSource(value: string): string {
  const source = value.trim();
  if (!source) return "";
  if (source.startsWith("/") || source.startsWith("blob:") || source.startsWith("data:image/")) {
    return source;
  }

  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:" ? source : "";
  } catch {
    return "";
  }
}

function mergeChanges(changes: CmsChange[], required: CmsChange[]) {
  const merged = new Map(
    changes.map((change) => [`${change.targetId}:${change.path || ""}`, change]),
  );
  for (const change of required) {
    merged.set(`${change.targetId}:${change.path || ""}`, change);
  }
  return [...merged.values()];
}

function draftArticlePreviewDocument(
  page: CmsPageReference,
  content: Record<string, unknown> | undefined,
) {
  const fragmentId = page.fragmentId;
  if (!fragmentId) return undefined;
  const title = draftString(content?.title) || page.title;
  const summary = draftString(content?.summary) || "Add a short summary for this founder note.";
  const legacyBody = draftString(content?.bodyMarkdown) || "Start writing your founder note here.";
  const parsedBody = articleBodySchema.safeParse(content?.bodyBlocks);
  const body = parsedBody.success ? parsedBody.data : articleBodyFromMarkdown(legacyBody);
  const bodyMarkdown = articleMarkdownFromBody(body);
  const directiveHero = firstArticleHeroMedia(bodyMarkdown);
  const heroImage =
    content?.heroImage && typeof content.heroImage === "object"
      ? (content.heroImage as Record<string, unknown>)
      : undefined;
  const heroSrc = draftString(heroImage?.src);
  const heroAlt = draftString(heroImage?.alt) || "Draft article image";
  const region = (field: string, label: string, kind: CmsRegion["kind"] = "text") =>
    [
      `data-usable-cms-region="${escapePreviewHtml(articleRegionId(page.id, field))}"`,
      `data-usable-cms-path="${escapePreviewHtml(field)}"`,
      `data-usable-cms-fragment-id="${escapePreviewHtml(fragmentId)}"`,
      `data-usable-cms-kind="${kind}"`,
      `data-usable-cms-label="${escapePreviewHtml(label)}"`,
    ].join(" ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base href="/" />
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; background: #f2f5f1; color: #17211f; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: clamp(28px, 6vw, 88px); }
      article { max-width: 920px; margin: 0 auto; }
      .draft-label { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: #f1c86a; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      header { padding-block: clamp(42px, 8vw, 100px) 48px; border-bottom: 1px solid #bcc8c2; }
      h1 { max-width: 860px; margin: 26px 0 18px; font-family: ui-serif, Georgia, serif; font-size: clamp(44px, 8vw, 88px); font-weight: 500; line-height: .98; letter-spacing: -.04em; }
      .summary { max-width: 720px; margin: 0; font-size: clamp(19px, 2vw, 25px); line-height: 1.5; color: #495753; }
      figure { margin: 48px 0 0; }
      img, video { display: block; width: 100%; max-height: 720px; object-fit: cover; border-radius: 18px; }
      article > .article-media img, article > .article-media video { aspect-ratio: 16 / 9; object-fit: cover; }
      figcaption { margin-top: 12px; color: #5a6864; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
      .body { max-width: 720px; margin: 56px auto; font-family: ui-serif, Georgia, serif; font-size: 20px; line-height: 1.72; }
      .body h2, .body h3 { color: #17211f; line-height: 1.15; margin-top: 2.2em; }
      .body p { margin: 0 0 1.25em; }
      .body ul, .body ol { margin: 0 0 1.5em; padding-left: 1.4em; }
      .body blockquote { margin: 1.8em 0; padding-left: 1.2em; border-left: 3px solid #d8654f; color: #495753; }
      .body a { color: #236b84; }
      .body .article-media { clear: both; margin: 42px 0; }
      .body .article-media--wide { width: min(920px, calc(100vw - 56px)); margin-left: 50%; transform: translateX(-50%); }
      .body .article-media--left { width: min(48%, 340px); float: left; margin: 12px 28px 22px 0; }
      .body .article-media--right { width: min(48%, 340px); float: right; margin: 12px 0 22px 28px; }
      [data-cms-editable="text"]:focus, [data-cms-editable="image"]:focus { outline: 3px solid #d8654f; outline-offset: 6px; }
    </style>
  </head>
  <body>
    <article>
      <header>
        <span class="draft-label">Unpublished draft</span>
        <h1 ${region("title", "Article title")}>${escapePreviewHtml(title)}</h1>
        <p class="summary" ${region("summary", "Article summary")}>${escapePreviewHtml(summary)}</p>
      </header>
      ${
        directiveHero
          ? renderArticleMediaPreview(directiveHero)
          : heroSrc
            ? `<figure><img src="${escapePreviewHtml(heroSrc)}" alt="${escapePreviewHtml(heroAlt)}" ${region("heroImage.src", "Article image", "image")} /></figure>`
            : ""
      }
      <div class="body" ${region("bodyBlocks", "Article body")}>${renderArticleMarkdownPreview(bodyMarkdown)}</div>
    </article>
  </body>
</html>`;
}

function draftString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function MarkdownTool({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function formatMarkdownSelection(format: MarkdownFormat, selected: string) {
  const selection = selected || markdownPlaceholder(format);
  if (format === "h2" || format === "h3") {
    const prefix = format === "h2" ? "## " : "### ";
    const value = selection
      .split("\n")
      .map((line) => `${prefix}${line.replace(/^#{1,6}\s+/, "")}`)
      .join("\n");
    return { value, selectionStart: prefix.length, selectionEnd: value.length };
  }
  if (["bullet", "numbered", "quote"].includes(format)) {
    const lines = selection.split("\n");
    const value = lines
      .map((line, index) => {
        if (format === "bullet") return `- ${line.replace(/^[-*]\s+/, "")}`;
        if (format === "numbered") return `${index + 1}. ${line.replace(/^\d+\.\s+/, "")}`;
        return `> ${line.replace(/^>\s?/, "")}`;
      })
      .join("\n");
    return { value, selectionStart: format === "numbered" ? 3 : 2, selectionEnd: value.length };
  }
  const wrappers: Record<
    Exclude<MarkdownFormat, "bullet" | "h2" | "h3" | "numbered" | "quote">,
    [string, string]
  > = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    link: ["[", "](https://)"],
  };
  const [before, after] = wrappers[format as keyof typeof wrappers];
  const value = `${before}${selection}${after}`;
  return { value, selectionStart: before.length, selectionEnd: before.length + selection.length };
}

function markdownPlaceholder(format: MarkdownFormat) {
  if (format === "h2") return "Section heading";
  if (format === "h3") return "Subheading";
  if (format === "bullet" || format === "numbered") return "List item";
  if (format === "quote") return "Quote";
  if (format === "link") return "link text";
  return "text";
}

function createArticleTurndownService() {
  const service = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });
  service.addRule("articleMedia", {
    filter: (node) =>
      node.nodeName === "FIGURE" &&
      (node as HTMLElement).hasAttribute("data-article-media-directive"),
    replacement: (_content, node) => {
      const directive = (node as HTMLElement).getAttribute("data-article-media-directive");
      return directive ? `\n\n${directive}\n\n` : "";
    },
  });
  service.addRule("cmsArticleInsertControl", {
    filter: (node) =>
      node.nodeName === "DIV" &&
      (node as HTMLElement).hasAttribute("data-cms-article-insert-control"),
    replacement: () => "",
  });
  return service;
}

function absoluteCmsAssetUrl(assetPath?: string) {
  if (!assetPath) return undefined;
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  return new URL(assetPath, "https://cms.usable.dev").toString();
}

function fragmentWithDirtyValues(
  fragmentId: string,
  fragments: Record<string, Record<string, unknown>>,
  registry: Record<string, CmsRegion>,
  dirty: Record<string, CmsDirtyValue>,
) {
  let content = structuredClone(fragments[fragmentId] || {});
  for (const [regionId, value] of Object.entries(dirty)) {
    const region = registry[regionId];
    if (region?.fragmentId !== fragmentId || !region.path) continue;
    content = writePath(content, region.path, value);
  }
  return content;
}

function escapePreviewHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] || character;
  });
}

function saveLabel(status: SaveStatus, unpublished = false) {
  if (status === "saving") return "Saving";
  if (status === "saved") return "Draft saved";
  if (status === "changed") return "Changed";
  if (status === "publishing") return "Publishing";
  if (status === "error") return "Needs attention";
  return unpublished ? "Draft" : "Published";
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function normalizeManagedPages(
  incoming: CmsPageReference[] | undefined,
  baseline: CmsPageReference[],
) {
  const pages = new Map(baseline.map((page) => [page.id, page]));
  for (const page of incoming || []) {
    if (!page?.id || !page.path?.startsWith("/")) continue;
    pages.set(page.id, { ...pages.get(page.id), ...page, title: page.title || page.id });
  }
  return [...pages.values()]
    .filter((page) => page.status !== "archived" && page.status !== "hidden")
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title));
}

function mergeManifests(local: CmsManifest, remote: CmsManifest): CmsManifest {
  return {
    ...local,
    ...remote,
    siteId: remote.siteId || local.siteId,
    workspaceId: remote.workspaceId || local.workspaceId,
    regions: remote.regions?.length ? remote.regions : local.regions,
    collections: remote.collections?.length ? remote.collections : local.collections,
    pages: normalizeManagedPages(remote.pages, local.pages || []),
    pageTemplates: remote.pageTemplates?.length ? remote.pageTemplates : local.pageTemplates,
  };
}

function registryFromManifest(manifest: CmsManifest, pageId: string): Record<string, CmsRegion> {
  const scalarRegions = manifest.regions.filter(
    (region) =>
      region.path &&
      region.fragmentId &&
      !region.path.includes("*") &&
      (region.scope === "global" || !region.pageId || region.pageId === pageId),
  );
  const collectionRegions: CmsRegion[] = (manifest.collections || [])
    .filter(
      (collection) =>
        collection.path &&
        collection.fragmentId &&
        (collection.scope === "global" || !collection.pageId || collection.pageId === pageId),
    )
    .map((collection) => ({
      ...collection,
      kind: "text",
      label: collection.label || collection.id,
    }));

  return Object.fromEntries(
    [...scalarRegions, ...collectionRegions].map((region) => [region.id, region]),
  );
}

function emptyNewPage(): NewPageDraft {
  return {
    bodyMarkdown: "Start writing here.",
    slug: "",
    summary: "",
    title: "",
    topics: "Usable",
  };
}

function emptyNewWork(): NewWorkDraft {
  return {
    accent: "coral",
    description: "",
    href: "https://",
    name: "",
    role: "",
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ð/g, "d")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function chatEntry(role: ChatEntry["role"], text: string, ok?: boolean): ChatEntry {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    role,
    text,
    ok,
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function chatResponseText(result: Record<string, unknown>) {
  const nested = [
    recordValue(result.result),
    recordValue(result.data),
    recordValue(result.payload),
  ];
  for (const value of [result, ...nested]) {
    if (!value) continue;
    for (const key of ["message", "summary", "text", "response"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
  }
}

function applyChatChanges(
  result: Record<string, unknown>,
  context: {
    fragmentId?: string;
    manifest: CmsManifest;
    pageId: string;
    applyValue: (region: CmsRegion, value: string) => void;
    registerRegion: (region: CmsRegion) => void;
    updateRegion: (regionId: string, value: string) => void;
  },
) {
  const nested = [
    recordValue(result.result),
    recordValue(result.data),
    recordValue(result.payload),
  ];
  const changes = [result, ...nested]
    .map((value) => value?.changes)
    .find((value): value is unknown[] => Array.isArray(value));
  let applied = false;

  for (const change of changes || []) {
    const record = recordValue(change);
    const path = typeof record?.path === "string" ? record.path : undefined;
    if (!path) continue;
    const targetId = typeof record?.targetId === "string" ? record.targetId : context.fragmentId;
    if (context.fragmentId && targetId && targetId !== context.fragmentId) continue;
    let value = record?.value ?? record?.after;
    if (value === undefined && typeof record?.afterRef === "string") {
      try {
        value = JSON.parse(record.afterRef);
      } catch {
        value = record.afterRef;
      }
    }
    if (typeof value !== "string") continue;
    const template = context.manifest.regions.find(
      (region) => region.path === path && (!region.pageId || region.pageId === context.pageId),
    );
    if (!template) continue;
    const region = { ...template, fragmentId: targetId || template.fragmentId };
    context.registerRegion(region);
    context.updateRegion(region.id, value);
    context.applyValue(region, value);
    applied = true;
  }
  const returnedDraft = [
    result.content,
    result.draft,
    ...nested.flatMap((value) => (value ? [value.content, value.draft] : [])),
  ]
    .map(parseContent)
    .find((value) => Object.keys(value).length > 0);
  if (returnedDraft) {
    for (const template of context.manifest.regions) {
      if (
        !template.path ||
        template.path.includes("*") ||
        (template.pageId && template.pageId !== context.pageId)
      )
        continue;
      const value = readPath(returnedDraft, template.path);
      if (!value) continue;
      const region = {
        ...template,
        fragmentId: context.fragmentId || template.fragmentId,
      };
      context.registerRegion(region);
      context.updateRegion(region.id, value);
      context.applyValue(region, value);
      applied = true;
    }
  }
  return applied;
}
