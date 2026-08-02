"use client";

import {
  Check,
  ExternalLink,
  History,
  ImageUp,
  LoaderCircle,
  LogIn,
  MessageSquare,
  Monitor,
  PanelLeft,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TurndownService from "turndown";
import { articleRegions } from "@/lib/cms/article-regions";
import type { CmsPageReference } from "@/lib/cms/binding";

type CmsRegion = {
  id: string;
  kind: "text" | "link" | "image";
  label: string;
  fragmentId?: string;
  scope?: "global" | "page";
  pageId?: string;
  path?: string;
};

type CmsManifest = {
  siteId: string;
  workspaceId: string;
  regions: CmsRegion[];
  collections?: Array<Record<string, unknown>>;
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

type CmsRevision = { id: string };
type CmsVersion = { id: string; createdAt?: string; summary?: string };

type CmsBroker = {
  session(): Promise<CmsSession>;
  login(returnTo: string, options: { sameTab: true }): Promise<unknown>;
  content(input: { fragmentIds?: string[]; workspaceId?: string }): Promise<{
    fragments: Array<{ id: string; content: unknown }>;
    manifest?: CmsManifest;
  }>;
  pages(input?: Record<string, unknown>): Promise<{ pages?: CmsPageReference[] }>;
  createPage(input: Record<string, unknown>): Promise<{
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
type Drawer = "pages" | "history" | "settings" | null;
type CmsViewport = "desktop" | "tablet" | "mobile";

type ChatEntry = { id: string; role: "assistant" | "user"; text: string; ok?: boolean };

type NewPageDraft = {
  bodyMarkdown: string;
  slug: string;
  summary: string;
  title: string;
  topics: string;
};

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
  const [dirty, setDirty] = useState<Record<string, string>>({});
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
  const [pageOperation, setPageOperation] = useState<"creating" | "hiding" | null>(null);
  const [newPage, setNewPage] = useState<NewPageDraft>(() => emptyNewPage());
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatLog, setChatLog] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "I can create, read, update, publish, and hide CMS pages in this site workspace.",
    },
  ]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const brokerRef = useRef<CmsBroker | null>(null);
  const draftKeyRef = useRef("");
  const restoredDraftRef = useRef(false);
  const previewCleanupRef = useRef<() => void>(() => undefined);
  const attachPreviewRef = useRef<() => void>(() => undefined);
  const previewAttachTimerRef = useRef<number | undefined>(undefined);
  const previewLoadedAtRef = useRef(0);
  const dirtyRef = useRef(dirty);
  const fragmentsRef = useRef(fragments);
  const registryRef = useRef(registry);
  const focusSnapshotRef = useRef(new Map<string, { html: string; value: string }>());
  const updateRegionRef = useRef<(regionId: string, value: string) => void>(() => undefined);
  const turndownRef = useRef(
    new TurndownService({ bulletListMarker: "-", codeBlockStyle: "fenced", headingStyle: "atx" }),
  );

  dirtyRef.current = dirty;
  fragmentsRef.current = fragments;
  registryRef.current = registry;

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
        const fragmentIds = Array.from(
          new Set(
            localManifest.regions
              .filter((region) => region.scope === "global" || region.pageId === pageId)
              .map((region) => region.fragmentId)
              .filter((id): id is string => Boolean(id)),
          ),
        );
        const content = await brokerRef.current?.content({
          fragmentIds,
          workspaceId: localManifest.workspaceId,
        });
        const nextManifest = content?.manifest
          ? mergeManifests(localManifest, content.manifest)
          : localManifest;
        const nextPages = normalizeManagedPages(nextManifest.pages, fallbackPages);
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
        if (matchedPage && matchedPage.id !== pageId) setPageId(matchedPage.id);
        setFragments(nextFragments);
        setRegistry(
          Object.fromEntries(
            nextManifest.regions
              .filter((region) => region.path && region.fragmentId && !region.path.includes("*"))
              .map((region) => [region.id, region]),
          ),
        );
        draftKeyRef.current = `usable-cms:draft:${nextManifest.siteId}:${pageId}`;
        const savedDraft = window.localStorage.getItem(draftKeyRef.current);
        if (savedDraft) {
          const parsedDraft = JSON.parse(savedDraft) as Record<string, string>;
          setDirty(parsedDraft);
          setSaveStatus(Object.keys(parsedDraft).length ? "changed" : "published");
        } else {
          setDirty({});
          setSaveStatus("published");
        }
        restoredDraftRef.current = true;
      } catch (nextError) {
        if (!cancelled) {
          setError(messageFrom(nextError));
          setSaveStatus("error");
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
          return {
            kind: "fragment" as const,
            targetId: region.fragmentId,
            path: region.path,
            afterRef: JSON.stringify(value),
          };
        })
        .filter((change): change is CmsChange => Boolean(change)),
    [dirty, registry],
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

  function updateRegion(regionId: string, value: string) {
    const region = registryRef.current[regionId];
    const baseline = region?.fragmentId
      ? readPath(fragmentsRef.current[region.fragmentId], region.path || "")
      : "";
    setDirty((current) => {
      const next = { ...current };
      if (value === baseline) delete next[regionId];
      else next[regionId] = value;
      return next;
    });
  }

  updateRegionRef.current = updateRegion;

  function valueForRegion(region: CmsRegion): string {
    return dirty[region.id] ?? readPath(fragments[region.fragmentId || ""], region.path || "");
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
    else if (region.path !== "bodyMarkdown") setEditableText(element, value);
  }, []);

  useEffect(() => {
    for (const [regionId, value] of Object.entries(dirty)) {
      const region = registry[regionId];
      if (region) applyValueToPreview(region, value);
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
    const cleanups: Array<() => void> = [];
    const runtimeRegions: Record<string, CmsRegion> = {};

    const blockNavigation = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.closest("a")) return;
      event.preventDefault();
    };
    doc.addEventListener("click", blockNavigation, true);
    cleanups.push(() => doc.removeEventListener("click", blockNavigation, true));

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
      const liveValue =
        dirtyRef.current[id] ?? readPath(fragmentsRef.current[fragmentId], region.path || "");

      if (region.kind === "image" && element instanceof HTMLImageElement) {
        element.dataset.cmsEditable = "image";
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `Edit ${region.label}`);
        element.parentElement?.classList.add("cms-image-region");
        if (liveValue) element.src = liveValue;

        const selectImage = (event: Event) => {
          event.preventDefault();
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

      element.dataset.cmsEditable = "text";
      element.contentEditable = "true";
      element.spellcheck = true;
      element.tabIndex = 0;
      element.setAttribute("role", "textbox");
      element.setAttribute("aria-label", `Edit ${region.label}`);
      element.setAttribute("aria-multiline", region.path === "bodyMarkdown" ? "true" : "false");
      if (liveValue && region.path !== "bodyMarkdown") setEditableText(element, liveValue);

      const readValue = () => editableValue(element, region, turndownRef.current);
      const focus = () => {
        focusSnapshotRef.current.set(id, { html: element.innerHTML, value: readValue() });
        setSelectedRegionId(id);
        setDrawer(null);
      };
      const input = () => updateRegionRef.current(id, readValue());
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
      element.addEventListener("keydown", keydown);
      element.addEventListener("paste", paste);
      cleanups.push(() => {
        element.removeEventListener("focus", focus);
        element.removeEventListener("click", focus);
        element.removeEventListener("input", input);
        element.removeEventListener("keydown", keydown);
        element.removeEventListener("paste", paste);
      });
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
    if (!broker || !manifest || !changes.length) return;
    setError("");
    setSaveStatus("publishing");
    try {
      await broker.publish(
        revisionId
          ? { revisionId }
          : {
              workspaceId: manifest.workspaceId,
              summary: `Publish ${managedPages.find((page) => page.id === pageId)?.title || pageId}`,
              changes,
            },
      );
      setFragments((current) => {
        const next = { ...current };
        for (const [regionId, value] of Object.entries(dirty)) {
          const region = registry[regionId];
          if (!region?.fragmentId || !region.path) continue;
          next[region.fragmentId] = writePath(next[region.fragmentId], region.path, value);
        }
        return next;
      });
      window.localStorage.removeItem(draftKeyRef.current);
      setDirty({});
      setRevisionId(undefined);
      setSaveStatus("published");
      showToast("Site published");
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
      const uploaded = await brokerRef.current.upload(file, {
        regionId: region.id,
        title: region.label,
      });
      const value = uploaded.assetPath || uploaded.url;
      if (!value) throw new Error("Usable did not return the uploaded asset path.");
      registerRegion(region);
      updateRegionRef.current(region.id, value);
      applyValueToPreview(region, value);
      showToast("Image uploaded");
    } catch (nextError) {
      setError(messageFrom(nextError));
      setSaveStatus("error");
    }
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
    const content = {
      type: "article",
      title: newPage.title.trim(),
      slug,
      summary: newPage.summary.trim(),
      publishedAt: today,
      updatedAt: today,
      status: "published",
      topics: newPage.topics
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean),
      canonicalUrl: `https://www.olavurellefsen.com${path}`,
      bodyMarkdown: newPage.bodyMarkdown.trim(),
    };

    setPageOperation("creating");
    setError("");
    try {
      const result = await broker.createPage({
        id,
        title: content.title,
        path,
        content,
        templateId: "founder-note",
        addToNavigation: false,
        regions: articleRegions({ id }),
      });
      const created = result.page || { id, title: content.title, path };
      setManagedPages((current) => normalizeManagedPages([created], current));
      setNewPage(emptyNewPage());
      setNewPageOpen(false);
      showToast("Page created");
      window.location.href = `/cms?page=${encodeURIComponent(created.id || id)}`;
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
                ? "This Usable account does not have access to edit the website."
                : error}
        </p>
        <div className="cms-gate__actions">
          {status === "signed-out" ? (
            <button
              type="button"
              className="cms-primary-button"
              onClick={() => void brokerRef.current?.login(window.location.href, { sameTab: true })}
            >
              <LogIn size={18} /> Sign in with Usable
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

  return (
    <main className="cms-workspace" aria-label="Usable CMS inline editor">
      <header className="cms-topbar">
        <div className="cms-topbar__identity">
          <span className="cms-topbar__mark" aria-hidden="true">
            ÓE
          </span>
          <span>
            <strong>{managedPages.find((page) => page.id === pageId)?.title}</strong>
            <small>Usable CMS</small>
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
            {saveLabel(saveStatus)}
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
          <button
            type="button"
            className="cms-publish-button"
            onClick={() => void publish()}
            disabled={!changes.length || saveStatus === "publishing"}
          >
            <Send size={16} />
            <span>
              {saveStatus === "publishing"
                ? "Publishing"
                : changes.length
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
              src={`${publicPath}?cms-preview=1`}
              title={`${managedPages.find((page) => page.id === pageId)?.title || "Page"} inline editor`}
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
                {drawer === "pages" ? "Pages" : drawer === "history" ? "History" : "Site settings"}
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
                        <span>{page.title}</span>
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
              <p className="cms-inspector__hint">
                Type directly where the text appears on the page.
              </p>
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
              This creates one independently editable CMS Page fragment. The note is published
              immediately and can be hidden later without deleting its fragment.
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
                {pageOperation === "creating" ? "Creating" : "Create page"}
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
      {toast ? (
        <output className="cms-toast" aria-live="polite">
          {toast}
        </output>
      ) : null}
    </main>
  );
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
  if (region.path === "bodyMarkdown") return turndown.turndown(element.innerHTML).trim();
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
  let value: unknown = content;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return "";
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

function writePath(
  content: Record<string, unknown> | undefined,
  path: string,
  value: string,
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

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "The CMS request failed.";
}

function saveLabel(status: SaveStatus) {
  if (status === "saving") return "Saving";
  if (status === "saved") return "Draft saved";
  if (status === "changed") return "Changed";
  if (status === "publishing") return "Publishing";
  if (status === "error") return "Needs attention";
  return "Published";
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

function emptyNewPage(): NewPageDraft {
  return {
    bodyMarkdown: "Start writing here.",
    slug: "",
    summary: "",
    title: "",
    topics: "Usable",
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
