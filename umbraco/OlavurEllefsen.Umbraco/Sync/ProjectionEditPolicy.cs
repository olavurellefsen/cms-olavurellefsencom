using System.Text.Json.Nodes;

namespace OlavurEllefsen.Umbraco.Sync;

internal static class ProjectionEditPolicy
{
    private static readonly string[] GlobalPaths =
    [
        "siteName",
        "siteDescription",
        "navigation.*.label",
        "navigation.*.href",
        "author.portrait.src",
        "author.portrait.alt",
        "footer",
    ];

    private static readonly Dictionary<string, string[]> PagePaths = new(StringComparer.Ordinal)
    {
        ["home"] =
        [
            "eyebrow",
            "headline",
            "introduction",
            "currentFocus.label",
            "currentFocus.title",
            "currentFocus.body",
            "currentFocus.href",
            "currentFocus.linkLabel",
            "selectedWorkTitle",
            "selectedWork",
            "selectedWork.*.name",
            "selectedWork.*.role",
            "selectedWork.*.description",
            "selectedWork.*.href",
            "selectedWork.*.accent",
            "latestWritingTitle",
        ],
        ["writing"] = ["eyebrow", "headline", "introduction"],
        ["about"] =
        [
            "eyebrow",
            "headline",
            "lead",
            "body.*",
            "principlesTitle",
            "principles.*",
            "contactTitle",
            "contactBody",
        ],
    };

    private static readonly string[] ArticlePaths =
    [
        "title",
        "summary",
        "bodyBlocks",
        "bodyBlocks.version",
        "bodyBlocks.blocks",
        "bodyBlocks.blocks.*.id",
        "bodyBlocks.blocks.*.type",
        "bodyBlocks.blocks.*.level",
        "bodyBlocks.blocks.*.text",
        "bodyBlocks.blocks.*.markdown",
        "bodyBlocks.blocks.*.style",
        "bodyBlocks.blocks.*.items",
        "bodyBlocks.blocks.*.items.*",
        "bodyBlocks.blocks.*.media",
        "bodyBlocks.blocks.*.media.id",
        "bodyBlocks.blocks.*.media.type",
        "bodyBlocks.blocks.*.media.src",
        "bodyBlocks.blocks.*.media.alt",
        "bodyBlocks.blocks.*.media.caption",
        "bodyBlocks.blocks.*.media.placement",
        "bodyBlocks.blocks.*.media.alignment",
        "bodyMarkdown",
        "heroImage.src",
        "heroImage.alt",
        "topics",
        "topics.*",
        "topics.*.$value",
    ];

    public static IReadOnlyList<string> DisallowedChanges(
        string kind,
        string pageId,
        JsonObject current,
        JsonObject candidate)
    {
        string[] allowed = kind == "global"
            ? GlobalPaths
            : PagePaths.TryGetValue(pageId, out string[]? pagePaths)
                ? pagePaths
                : current["type"]?.GetValue<string>() == "article" &&
                    candidate["type"]?.GetValue<string>() == "article"
                    ? ArticlePaths
                    : [];
        JsonObject comparableCurrent = current.DeepClone().AsObject();
        JsonObject comparableCandidate = candidate.DeepClone().AsObject();
        IEnumerable<string> stableCollectionChanges = pageId == "home"
            ? StableCollectionChanges(current, candidate, "selectedWork")
            : current["type"]?.GetValue<string>() == "article" &&
              candidate["type"]?.GetValue<string>() == "article"
                ? StableCollectionChanges(current, candidate, "topics")
                : [];
        if (pageId == "home")
        {
            comparableCurrent.Remove("selectedWork");
            comparableCandidate.Remove("selectedWork");
        }
        if (current["type"]?.GetValue<string>() == "article" &&
            candidate["type"]?.GetValue<string>() == "article")
        {
            comparableCurrent.Remove("topics");
            comparableCandidate.Remove("topics");
        }
        return stableCollectionChanges
            .Concat(ChangedPaths(comparableCurrent, comparableCandidate))
            .Where(path => !allowed.Any(pattern => Matches(pattern, path)))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();
    }

    private static IEnumerable<string> StableCollectionChanges(
        JsonObject current,
        JsonObject candidate,
        string path)
    {
        if (current[path] is not JsonArray currentValues ||
            candidate[path] is not JsonArray candidateValues)
        {
            foreach (string changed in ChangedPaths(current[path], candidate[path], path))
                yield return changed;
            yield break;
        }
        List<JsonObject> currentItems = currentValues.OfType<JsonObject>().ToList();
        List<JsonObject> candidateItems = candidateValues.OfType<JsonObject>().ToList();
        if (currentItems.Count != currentValues.Count || candidateItems.Count != candidateValues.Count)
        {
            foreach (string changed in ChangedPaths(currentValues, candidateValues, path))
                yield return changed;
            yield break;
        }

        if (!TryItemsById(currentItems, out Dictionary<string, JsonObject> currentById))
        {
            foreach (string changed in ChangedPaths(currentValues, candidateValues, path))
                yield return changed;
            yield break;
        }
        if (!TryItemsById(candidateItems, out Dictionary<string, JsonObject> candidateById))
        {
            yield return $"{path}.*.$id";
            yield break;
        }

        List<JsonObject> removed = currentById
            .Where(entry => !candidateById.ContainsKey(entry.Key))
            .Select(entry => entry.Value)
            .ToList();
        List<JsonObject> added = candidateById
            .Where(entry => !currentById.ContainsKey(entry.Key))
            .Select(entry => entry.Value)
            .ToList();
        if (removed.Any(oldItem => added.Any(newItem => SameValueExceptIdentity(oldItem, newItem))))
            yield return $"{path}.*.$id";

        if (removed.Count > 0 || added.Count > 0) yield return path;
        foreach ((string identity, JsonObject currentItem) in currentById)
        {
            if (!candidateById.TryGetValue(identity, out JsonObject? candidateItem)) continue;
            foreach (string changed in ChangedPaths(currentItem, candidateItem, $"{path}.*"))
                yield return changed;
        }
    }

    private static bool TryItemsById(
        IEnumerable<JsonObject> items,
        out Dictionary<string, JsonObject> result)
    {
        result = new Dictionary<string, JsonObject>(StringComparer.OrdinalIgnoreCase);
        foreach (JsonObject item in items)
        {
            string? identity = item["$id"]?.GetValue<string>();
            if (!Guid.TryParse(identity, out _) || !result.TryAdd(identity, item)) return false;
        }
        return true;
    }

    private static bool SameValueExceptIdentity(JsonObject current, JsonObject candidate)
    {
        JsonObject comparableCurrent = current.DeepClone().AsObject();
        JsonObject comparableCandidate = candidate.DeepClone().AsObject();
        comparableCurrent.Remove("$id");
        comparableCandidate.Remove("$id");
        return JsonNode.DeepEquals(comparableCurrent, comparableCandidate);
    }

    private static IEnumerable<string> ChangedPaths(JsonNode? current, JsonNode? candidate, string path = "")
    {
        if (JsonNode.DeepEquals(current, candidate)) yield break;
        if (current is JsonObject currentObject && candidate is JsonObject candidateObject)
        {
            foreach (string key in currentObject.Select(x => x.Key)
                         .Union(candidateObject.Select(x => x.Key), StringComparer.Ordinal))
            {
                string childPath = string.IsNullOrEmpty(path) ? key : $"{path}.{key}";
                foreach (string changed in ChangedPaths(currentObject[key], candidateObject[key], childPath))
                    yield return changed;
            }
            yield break;
        }
        if (current is JsonArray currentArray && candidate is JsonArray candidateArray)
        {
            if (currentArray.Count != candidateArray.Count)
            {
                yield return path;
                yield break;
            }
            for (int index = 0; index < currentArray.Count; index++)
            {
                string childPath = string.IsNullOrEmpty(path) ? "*" : $"{path}.*";
                foreach (string changed in ChangedPaths(currentArray[index], candidateArray[index], childPath))
                    yield return changed;
            }
            yield break;
        }
        yield return path;
    }

    private static bool Matches(string pattern, string path)
    {
        string[] expected = pattern.Split('.');
        string[] actual = path.Split('.');
        if (expected.Length != actual.Length) return false;
        return expected.Zip(actual).All(parts => parts.First == "*" || parts.First == parts.Second);
    }
}
