function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseCmsFragmentContent(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trimStart();
  const withoutFrontmatter = trimmed.startsWith("---")
    ? trimmed.replace(/^---[\s\S]*?\n---\s*\n?/, "")
    : trimmed;
  const unfenced = withoutFrontmatter
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}

export function pageIdFromTags(tags) {
  for (const prefix of ["cms-page:", "ucms:page:", "page:"]) {
    const value = tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
    if (value) return value;
  }
  return undefined;
}

export function cmsPageArray(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.pages)) return payload.pages;
  if (payload.manifest && typeof payload.manifest === "object") {
    if (Array.isArray(payload.manifest.pages)) return payload.manifest.pages;
  }
  if (payload.site && typeof payload.site === "object") {
    if (Array.isArray(payload.site.pages)) return payload.site.pages;
  }
  return [];
}

function normalizeCmsPage(value) {
  if (!value || typeof value !== "object") return null;
  const id = stringValue(value.id) || stringValue(value.pageId);
  const path = stringValue(value.path) || stringValue(value.route);
  const fragmentId =
    stringValue(value.fragmentId) ||
    (value.fragment && typeof value.fragment === "object"
      ? stringValue(value.fragment.id)
      : undefined);
  if (!id || !path?.startsWith("/") || !fragmentId) return null;
  return {
    id,
    title: stringValue(value.title) || id,
    path,
    fragmentId,
    order: typeof value.order === "number" ? value.order : undefined,
    status: stringValue(value.status),
  };
}

function contentPath(content) {
  if (!content || typeof content !== "object") return undefined;
  if (content.type === "article" && stringValue(content.slug)) {
    return `/writing/${content.slug.trim()}`;
  }
  return stringValue(content.path) || stringValue(content.route);
}

function explicitWorkspaceStatus(tags) {
  for (const status of ["archived", "hidden", "published", "draft"]) {
    if (tags?.includes(`cms-${status}`)) return status;
  }
  return undefined;
}

function workspaceCandidate(fragment) {
  const fragmentId = stringValue(fragment?.id) || stringValue(fragment?.fragmentId);
  const id = pageIdFromTags(fragment?.tags);
  if (!fragmentId || !id) return null;
  const content = parseCmsFragmentContent(fragment.content);
  const path = contentPath(content);
  if (!path?.startsWith("/")) return null;
  return {
    id,
    title: stringValue(content?.title) || stringValue(fragment.title) || id,
    path,
    fragmentId,
    content,
    status: explicitWorkspaceStatus(fragment.tags) || stringValue(content?.status),
    explicitStatus: Boolean(explicitWorkspaceStatus(fragment.tags)),
    updatedAt: stringValue(fragment.updatedAt) || stringValue(fragment.createdAt) || "",
  };
}

function candidateRank(candidate) {
  if (candidate.explicitStatus) {
    if (candidate.status === "hidden" || candidate.status === "archived") return 10;
    if (candidate.status === "published") return 9;
    if (candidate.status === "draft") return 7;
  }
  if (candidate.status === "published") return 8;
  if (candidate.status === "draft") return 6;
  if (candidate.status === "hidden" || candidate.status === "archived") return 5;
  return 0;
}

function selectWorkspaceCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    const rank = candidateRank(right) - candidateRank(left);
    if (rank) return rank;
    const freshness = right.updatedAt.localeCompare(left.updatedAt);
    if (freshness) return freshness;
    return left.fragmentId.localeCompare(right.fragmentId);
  })[0];
}

function isVisiblePage(page) {
  return page.status !== "archived" && page.status !== "hidden";
}

export function selectUsablePageReferences({
  fallbackPages,
  bindingPageFragmentIds,
  workspaceFragments,
  cmsPagesPayload,
}) {
  const selected = new Map();
  const workspaceByPage = new Map();

  for (const fragment of workspaceFragments || []) {
    const candidate = workspaceCandidate(fragment);
    if (!candidate) continue;
    const candidates = workspaceByPage.get(candidate.id) || [];
    candidates.push(candidate);
    workspaceByPage.set(candidate.id, candidates);
  }
  for (const [id, candidates] of workspaceByPage) {
    selected.set(id, selectWorkspaceCandidate(candidates));
  }

  for (const [id, fragmentId] of Object.entries(bindingPageFragmentIds || {})) {
    const fallback = fallbackPages.find((page) => page.id === id);
    selected.set(id, {
      id,
      title: fallback?.title || id,
      path:
        fallback?.path ||
        (id.startsWith("article-") ? `/writing/${id.slice("article-".length)}` : `/${id}`),
      fragmentId,
      order: fallbackPages.findIndex((page) => page.id === id),
    });
  }

  for (const value of cmsPageArray(cmsPagesPayload)) {
    const page = normalizeCmsPage(value);
    if (!page) continue;
    const existing = selected.get(page.id);
    selected.set(page.id, {
      ...existing,
      ...page,
      fragmentId: bindingPageFragmentIds[page.id] || page.fragmentId || existing?.fragmentId,
    });
  }

  return [...selected.values()]
    .filter(isVisiblePage)
    .sort(
      (left, right) =>
        (left.order ?? 999) - (right.order ?? 999) || left.title.localeCompare(right.title),
    );
}

export function auditUsablePageTopology({
  globalContent,
  fallbackPages,
  bindingPageFragmentIds,
  workspaceFragments,
  cmsPagesPayload,
}) {
  const selected = selectUsablePageReferences({
    fallbackPages,
    bindingPageFragmentIds,
    workspaceFragments,
    cmsPagesPayload,
  });
  const candidatesByPage = new Map();
  for (const fragment of workspaceFragments || []) {
    const pageId = pageIdFromTags(fragment.tags);
    const fragmentId = stringValue(fragment.id) || stringValue(fragment.fragmentId);
    if (!pageId || !fragmentId) continue;
    const candidates = candidatesByPage.get(pageId) || [];
    const content = parseCmsFragmentContent(fragment.content);
    candidates.push({
      fragmentId,
      status:
        explicitWorkspaceStatus(fragment.tags) || stringValue(content?.status) || "unspecified",
      containsPagesArray: Array.isArray(content?.pages),
    });
    candidatesByPage.set(pageId, candidates);
  }
  const selectedByPage = new Map(selected.map((page) => [page.id, page.fragmentId]));
  return {
    storageModel: "one-global-plus-one-fragment-per-page",
    globalContainsPagesArray: Array.isArray(globalContent?.pages),
    physicalPageFragments: [...candidatesByPage.values()].reduce(
      (total, candidates) => total + candidates.length,
      0,
    ),
    logicalPageIds: candidatesByPage.size,
    selectablePages: selected.length,
    selected: selected.map(({ id, fragmentId, path, status }) => ({
      pageId: id,
      fragmentId,
      path,
      status: status || "active",
    })),
    duplicates: [...candidatesByPage]
      .filter(([, candidates]) => candidates.length > 1)
      .map(([pageId, candidates]) => ({
        pageId,
        selectedFragmentId: selectedByPage.get(pageId),
        candidates,
      })),
    pageFragmentsContainingPagesArrays: [...candidatesByPage].flatMap(([pageId, candidates]) =>
      candidates
        .filter((candidate) => candidate.containsPagesArray)
        .map((candidate) => ({ pageId, fragmentId: candidate.fragmentId })),
    ),
  };
}
