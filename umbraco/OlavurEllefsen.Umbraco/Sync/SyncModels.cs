using System.Text.Json.Nodes;

namespace OlavurEllefsen.Umbraco.Sync;

public sealed record SitePage(string Id, string Title, string Path, JsonObject Content);

public sealed record SiteSnapshot(JsonObject Global, IReadOnlyList<SitePage> Pages)
{
    public IReadOnlyList<JsonObject> PageTemplates { get; init; } = [];
    public CanonicalProjection? Canonical { get; init; }
}

public sealed record CanonicalProjection(
    string Provider,
    string WorkspaceId,
    string GlobalFragmentId,
    IReadOnlyDictionary<string, string> PageFragmentIds);

public sealed record ImportRequest(SiteSnapshot Snapshot, string? ExpectedTargetHash, string Source, bool Force = false);

public sealed record ImportResult(string Hash, int Created, int Updated, int Removed, DateTimeOffset SynchronizedAt);
