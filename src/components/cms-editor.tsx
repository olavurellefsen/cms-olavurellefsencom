"use client";

import {
  Check,
  ExternalLink,
  FileText,
  History,
  ImageUp,
  LoaderCircle,
  LogIn,
  RotateCcw,
  Save,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
};

type CmsSession = {
  signedIn: boolean;
  authorized: boolean;
  user?: { email?: string; name?: string };
  capabilities?: { edit?: boolean; publish?: boolean; restore?: boolean; upload?: boolean };
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
  content(input: { fragmentIds: string[] }): Promise<{
    fragments: Array<{ id: string; content: unknown }>;
  }>;
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
  ): Promise<{
    assetPath?: string;
    url?: string;
  }>;
  versions(): Promise<{ versions: CmsVersion[] }>;
  restore(versionId: string): Promise<unknown>;
};

declare global {
  interface Window {
    usableCmsBroker?: CmsBroker;
  }
}

const pages = [
  { id: "home", label: "Home", path: "/" },
  { id: "writing", label: "Writing", path: "/writing" },
  { id: "about", label: "About", path: "/about" },
  {
    id: "article-why-writing-here",
    label: "Why I am writing here",
    path: "/writing/why-i-am-writing-here",
  },
];

type EditorStatus = "checking" | "signed-out" | "unauthorized" | "ready" | "error";
type SaveStatus = "published" | "changed" | "saving" | "saved" | "publishing" | "error";

export function CmsEditor() {
  const [active, setActive] = useState(false);
  const [pageId, setPageId] = useState("home");
  const [status, setStatus] = useState<EditorStatus>("checking");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("published");
  const [session, setSession] = useState<CmsSession | null>(null);
  const [manifest, setManifest] = useState<CmsManifest | null>(null);
  const [fragments, setFragments] = useState<Record<string, Record<string, unknown>>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [revisionId, setRevisionId] = useState<string>();
  const [versions, setVersions] = useState<CmsVersion[]>([]);
  const [tab, setTab] = useState<"content" | "pages" | "history">("content");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const brokerRef = useRef<CmsBroker | null>(null);
  const draftKeyRef = useRef("");
  const restoredDraftRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cms") !== "1") return;
    setActive(true);
    setPageId(pages.find((page) => page.path === window.location.pathname)?.id || "home");
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
    if (status !== "ready" || !brokerRef.current) return;
    let cancelled = false;

    async function load() {
      try {
        const manifestResponse = await fetch("/api/cms/manifest", { cache: "no-store" });
        if (!manifestResponse.ok) throw new Error("The CMS manifest could not be loaded.");
        const nextManifest = (await manifestResponse.json()) as CmsManifest;
        const fragmentIds = Array.from(
          new Set(
            nextManifest.regions
              .filter((region) => region.scope === "global" || region.pageId === pageId)
              .map((region) => region.fragmentId)
              .filter((id): id is string => Boolean(id)),
          ),
        );
        const content = await brokerRef.current?.content({ fragmentIds });
        const nextFragments = Object.fromEntries(
          (content?.fragments || []).map((fragment) => [
            fragment.id,
            parseContent(fragment.content),
          ]),
        );
        if (cancelled) return;
        setManifest(nextManifest);
        setFragments(nextFragments);
        draftKeyRef.current = `usable-cms:draft:${nextManifest.siteId}:${pageId}`;
        const savedDraft = window.localStorage.getItem(draftKeyRef.current);
        if (savedDraft) {
          const parsedDraft = JSON.parse(savedDraft) as Record<string, string>;
          setDirty(parsedDraft);
          setSaveStatus(Object.keys(parsedDraft).length ? "changed" : "published");
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
  }, [pageId, status]);

  const regions = useMemo(
    () =>
      (manifest?.regions || []).filter(
        (region) =>
          Boolean(region.path && region.fragmentId) &&
          !region.path?.includes("*") &&
          (region.scope === "global" || region.pageId === pageId),
      ),
    [manifest, pageId],
  );

  const changes = useMemo(
    () =>
      Object.entries(dirty)
        .map(([regionId, value]) => {
          const region = regions.find((candidate) => candidate.id === regionId);
          if (!region?.fragmentId || !region.path) return null;
          return {
            kind: "fragment" as const,
            targetId: region.fragmentId,
            path: region.path,
            afterRef: JSON.stringify(value),
          };
        })
        .filter((change): change is CmsChange => Boolean(change)),
    [dirty, regions],
  );

  const saveDraft = useCallback(async () => {
    const broker = brokerRef.current;
    if (!broker || !manifest || !changes.length) return;
    setSaveStatus("saving");
    try {
      const result = await broker.draft({
        revisionId,
        workspaceId: manifest.workspaceId,
        summary: `Update ${pages.find((page) => page.id === pageId)?.label || pageId}`,
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
  }, [changes, manifest, pageId, revisionId]);

  useEffect(() => {
    if (!restoredDraftRef.current || !Object.keys(dirty).length) return;
    window.localStorage.setItem(draftKeyRef.current, JSON.stringify(dirty));
    setSaveStatus((current) => (current === "publishing" ? current : "changed"));
    const timer = window.setTimeout(() => void saveDraft(), 900);
    return () => window.clearTimeout(timer);
  }, [dirty, saveDraft]);

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
              summary: `Publish ${pages.find((page) => page.id === pageId)?.label || pageId}`,
              changes,
            },
      );
      setFragments((current) => {
        const next = { ...current };
        for (const [regionId, value] of Object.entries(dirty)) {
          const region = regions.find((candidate) => candidate.id === regionId);
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
    setTab("history");
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
      setDirty((current) => ({ ...current, [region.id]: value }));
      showToast("Image uploaded");
    } catch (nextError) {
      setError(messageFrom(nextError));
      setSaveStatus("error");
    }
  }

  function update(regionId: string, value: string) {
    setDirty((current) => ({ ...current, [regionId]: value }));
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function leaveCms() {
    window.location.href = window.location.pathname;
  }

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

  return (
    <aside className="cms-editor" aria-label="Usable CMS editor">
      <header className="cms-editor__header">
        <div>
          <span className="cms-editor__brand">Usable CMS</span>
          <strong>{pages.find((page) => page.id === pageId)?.label}</strong>
        </div>
        <button
          type="button"
          className="cms-icon-button"
          onClick={leaveCms}
          aria-label="Close editor"
          title="Close editor"
        >
          <X size={19} />
        </button>
      </header>

      <div className="cms-editor__toolbar">
        <span className={`cms-save-state cms-save-state--${saveStatus}`}>
          {saveStatus === "saving" ? (
            <LoaderCircle className="cms-spin" size={15} />
          ) : (
            <Check size={15} />
          )}
          {saveLabel(saveStatus)}
        </span>
        <a
          className="cms-icon-button"
          href={window.location.pathname}
          target="_blank"
          rel="noreferrer"
          aria-label="View published page"
          title="View published page"
        >
          <ExternalLink size={18} />
        </a>
        <button
          type="button"
          className="cms-publish-button"
          onClick={() => void publish()}
          disabled={!changes.length || saveStatus === "publishing"}
        >
          <Send size={16} />{" "}
          {saveStatus === "publishing" ? "Publishing" : changes.length ? "Publish" : "Published"}
        </button>
      </div>

      <nav className="cms-editor__tabs" aria-label="Editor views">
        <button type="button" aria-pressed={tab === "content"} onClick={() => setTab("content")}>
          <FileText size={17} /> Content
        </button>
        <button type="button" aria-pressed={tab === "pages"} onClick={() => setTab("pages")}>
          <Save size={17} /> Pages
        </button>
        <button type="button" aria-pressed={tab === "history"} onClick={() => void loadVersions()}>
          <History size={17} /> History
        </button>
      </nav>

      <div className="cms-editor__body">
        {error ? (
          <p className="cms-editor__error" role="alert">
            {error}
          </p>
        ) : null}
        {tab === "content" ? (
          <div className="cms-fields">
            {regions.map((region) => {
              const value =
                dirty[region.id] ?? readPath(fragments[region.fragmentId || ""], region.path || "");
              const controlId = `cms-field-${region.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
              return (
                <div key={region.id} className="cms-field">
                  <label htmlFor={controlId}>{region.label}</label>
                  {region.kind === "image" ? (
                    <span className="cms-upload-control">
                      <ImageUp size={18} />
                      <span>{value ? "Replace image" : "Upload image"}</span>
                      <input
                        id={controlId}
                        type="file"
                        accept="image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void upload(region, file);
                        }}
                      />
                    </span>
                  ) : region.path?.includes("body") || value.length > 90 ? (
                    <textarea
                      id={controlId}
                      value={value}
                      rows={region.path?.includes("body") ? 8 : 3}
                      onChange={(event) => update(region.id, event.target.value)}
                    />
                  ) : (
                    <input
                      id={controlId}
                      type={region.kind === "link" ? "url" : "text"}
                      value={value}
                      onChange={(event) => update(region.id, event.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {tab === "pages" ? (
          <div className="cms-page-list">
            {pages.map((page) => (
              <a
                key={page.id}
                href={`/cms?page=${page.id}`}
                aria-current={page.id === pageId ? "page" : undefined}
              >
                <span>{page.label}</span>
                <ExternalLink size={16} />
              </a>
            ))}
          </div>
        ) : null}

        {tab === "history" ? (
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
                    <RotateCcw size={17} />
                  </button>
                </div>
              ))
            ) : (
              <p>No published versions yet.</p>
            )}
          </div>
        ) : null}
      </div>

      {toast ? (
        <output className="cms-toast" aria-live="polite">
          {toast}
        </output>
      ) : null}
    </aside>
  );
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
