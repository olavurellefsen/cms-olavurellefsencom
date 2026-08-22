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
        return ChangedPaths(current, candidate)
            .Where(path => !allowed.Any(pattern => Matches(pattern, path)))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();
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
