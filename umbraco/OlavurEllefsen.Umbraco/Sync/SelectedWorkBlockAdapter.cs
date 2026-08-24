using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace OlavurEllefsen.Umbraco.Sync;

public enum SelectedWorkProjectionKeyMode
{
    LegacyShadow,
    ManagedV2,
}

public sealed class SelectedWorkBlockAdapter
{
    internal const string ElementAlias = "olavurSelectedWorkItem";
    internal const string CollectionId = "home.selectedWork";
    internal const int MinItems = 0;
    internal const int MaxItems = 24;
    internal static readonly string SchemaPlanFingerprint = Convert.ToHexStringLower(SHA256.HashData(
        Encoding.UTF8.GetBytes(
            $"olavur-selected-work:v2|editor=Umbraco.BlockList|block={ElementAlias}|" +
            "workCanonicalId=hidden-managed|layout=content=expose|" +
            $"limits={MinItems}..{MaxItems}")));

    public string Project(JsonObject content, Guid elementKey, SelectedWorkProjectionKeyMode keyMode)
    {
        JsonArray layout = [];
        JsonArray contentData = [];
        JsonArray expose = [];
        int ordinal = 0;

        foreach (JsonObject item in content["selectedWork"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            JsonObject legacyItem = CollectionCompatibilityCodec.LegacyObject(item);
            Guid contentKey = keyMode == SelectedWorkProjectionKeyMode.ManagedV2
                ? CanonicalIdentity(item)
                : StableGuid($"{ordinal}\0{legacyItem.ToJsonString()}");
            ordinal++;
            layout.Add(new JsonObject { ["contentKey"] = contentKey });
            contentData.Add(new JsonObject
            {
                ["contentTypeKey"] = elementKey,
                ["key"] = contentKey,
                ["values"] = Values(item),
            });
            expose.Add(new JsonObject
            {
                ["contentKey"] = contentKey,
                ["culture"] = null,
                ["segment"] = null,
            });
        }

        return new JsonObject
        {
            ["layout"] = new JsonObject { ["Umbraco.BlockList"] = layout },
            ["contentData"] = contentData,
            ["settingsData"] = new JsonArray(),
            ["expose"] = expose,
        }.ToJsonString();
    }

    public JsonArray? ToCanonical(string raw, SelectedWorkProjectionKeyMode keyMode)
    {
        JsonObject? value = JsonNode.Parse(raw) as JsonObject;
        JsonArray? layout = value?["layout"]?["Umbraco.BlockList"] as JsonArray;
        JsonArray? data = value?["contentData"] as JsonArray;
        if (layout is null || data is null) return null;

        Dictionary<Guid, JsonObject> contentByKey = data
            .OfType<JsonObject>()
            .Where(item => Guid.TryParse(String(item, "key"), out _))
            .ToDictionary(item => Guid.Parse(String(item, "key")));
        JsonArray result = [];
        foreach (JsonObject layoutItem in layout.OfType<JsonObject>())
        {
            if (!Guid.TryParse(String(layoutItem, "contentKey"), out Guid contentKey) ||
                !contentByKey.TryGetValue(contentKey, out JsonObject? contentItem))
                continue;
            JsonObject values = Properties(contentItem);
            JsonObject canonicalItem = new()
            {
                ["name"] = JsonValue.Create(String(values, "workName")),
                ["role"] = JsonValue.Create(String(values, "workRole")),
                ["description"] = JsonValue.Create(String(values, "workDescription")),
                ["href"] = JsonValue.Create(String(values, "workHref")),
                ["accent"] = JsonValue.Create(NormalizeAccent(String(values, "workAccent"))),
            };
            if (keyMode == SelectedWorkProjectionKeyMode.ManagedV2)
                canonicalItem["$id"] = contentKey.ToString();
            result.Add(canonicalItem);
        }
        return result;
    }

    public bool MatchesCanonical(
        JsonObject content,
        string nativeValue,
        SelectedWorkProjectionKeyMode keyMode)
    {
        JsonArray expected = content["selectedWork"] as JsonArray ?? [];
        if (keyMode == SelectedWorkProjectionKeyMode.LegacyShadow)
        {
            List<Guid> expectedIds = expected.OfType<JsonObject>()
                .Select(item => Guid.TryParse(item["$id"]?.GetValue<string>(), out Guid id) ? id : Guid.Empty)
                .ToList();
            bool hasStableIds = expectedIds.Any(id => id != Guid.Empty);
            if (hasStableIds && expectedIds.Any(id => id == Guid.Empty)) return false;
            if (hasStableIds)
            {
                IReadOnlyList<LegacyBlockIdentity>? actualIds = LegacyBlockIdentities(nativeValue);
                if (actualIds is null || actualIds.Count != expectedIds.Count) return false;
                for (int index = 0; index < expectedIds.Count; index++)
                {
                    LegacyBlockIdentity actualIdentity = actualIds[index];
                    if (actualIdentity.CanonicalId is null)
                    {
                        if (actualIdentity.ContentKey != expectedIds[index]) return false;
                    }
                    else if (!Guid.TryParse(actualIdentity.CanonicalId, out Guid canonicalId) ||
                             canonicalId != expectedIds[index]) return false;
                }
            }
            expected = new JsonArray(expected.OfType<JsonObject>()
                .Select(item => (JsonNode?)CollectionCompatibilityCodec.LegacyObject(item))
                .ToArray());
        }
        JsonArray? actual = ToCanonical(nativeValue, keyMode);
        return actual is not null && JsonNode.DeepEquals(expected, actual);
    }

    public bool PreservesLegacyIdentityState(string baselineNativeValue, string candidateNativeValue)
    {
        try
        {
            IReadOnlyList<LegacyBlockIdentity>? baseline = LegacyBlockIdentities(baselineNativeValue);
            IReadOnlyList<LegacyBlockIdentity>? candidate = LegacyBlockIdentities(candidateNativeValue);
            if (baseline is null || candidate is null) return false;
            if (baseline.Any(identity => identity.CanonicalId is not null) &&
                baseline.Any(identity => NormalizeIdentity(identity.CanonicalId) is null))
                return false;
            if (candidate.Any(identity =>
                    identity.CanonicalId is not null && NormalizeIdentity(identity.CanonicalId) is null))
                return false;

            Dictionary<Guid, string?> baselineByProjectionKey = baseline.ToDictionary(
                identity => identity.ContentKey,
                identity => NormalizeIdentity(identity.CanonicalId));
            HashSet<string> baselineCanonicalIds = baselineByProjectionKey.Values
                .OfType<string>()
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (baselineCanonicalIds.Count != baselineByProjectionKey.Values.Count(value => value is not null))
                return false;
            HashSet<string> suppliedCanonicalIds = new(StringComparer.OrdinalIgnoreCase);
            foreach (LegacyBlockIdentity identity in candidate)
            {
                string? suppliedCanonicalId = NormalizeIdentity(identity.CanonicalId);
                if (baselineByProjectionKey.TryGetValue(identity.ContentKey, out string? expectedCanonicalId))
                {
                    if (!string.Equals(suppliedCanonicalId, expectedCanonicalId, StringComparison.OrdinalIgnoreCase))
                        return false;
                }
                else if (suppliedCanonicalId is not null)
                {
                    // An unseen native key is an explicit add. It must not claim an existing
                    // canonical identity; its projection key becomes the new stable identity.
                    return false;
                }
                else if (baselineCanonicalIds.Contains(identity.ContentKey.ToString()))
                {
                    return false;
                }

                if (suppliedCanonicalId is not null && !suppliedCanonicalIds.Add(suppliedCanonicalId))
                    return false;
            }
            return true;
        }
        catch (Exception exception) when (exception is System.Text.Json.JsonException or InvalidOperationException or ArgumentException)
        {
            return false;
        }
    }

    private static IReadOnlyList<LegacyBlockIdentity>? LegacyBlockIdentities(string raw)
    {
        JsonObject? value = JsonNode.Parse(raw) as JsonObject;
        JsonArray? layout = value?["layout"]?["Umbraco.BlockList"] as JsonArray;
        JsonArray? data = value?["contentData"] as JsonArray;
        if (layout is null || data is null) return null;
        Dictionary<Guid, JsonObject> contentByKey = data
            .OfType<JsonObject>()
            .Where(item => Guid.TryParse(String(item, "key"), out _))
            .ToDictionary(item => Guid.Parse(String(item, "key")));
        List<LegacyBlockIdentity> result = [];
        foreach (JsonObject layoutItem in layout.OfType<JsonObject>())
        {
            if (!Guid.TryParse(String(layoutItem, "contentKey"), out Guid contentKey) ||
                !contentByKey.TryGetValue(contentKey, out JsonObject? contentItem))
                return null;
            JsonObject? canonicalId = contentItem["values"]?.AsArray()
                .OfType<JsonObject>()
                .FirstOrDefault(value => String(value, "alias") == "workCanonicalId");
            result.Add(new LegacyBlockIdentity(
                contentKey,
                canonicalId is null ? null : String(canonicalId, "value")));
        }
        return result;
    }

    private static Guid CanonicalIdentity(JsonObject item)
    {
        if (!Guid.TryParse(item["$id"]?.GetValue<string>(), out Guid identity))
            throw new InvalidOperationException(
                "Managed-v2 Selected Work projection requires a UUID $id on every canonical item.");
        return identity;
    }

    private static JsonArray Values(JsonObject item)
    {
        JsonArray values = [];
        Add("workName", item["name"]);
        Add("workRole", item["role"]);
        Add("workDescription", item["description"], "Umbraco.TextArea");
        Add("workHref", item["href"]);
        Add("workAccent", item["accent"]);
        if (Guid.TryParse(item["$id"]?.GetValue<string>(), out Guid canonicalId))
            Add("workCanonicalId", JsonValue.Create(canonicalId.ToString()), "Umbraco.Label");
        return values;

        void Add(string alias, JsonNode? value, string editor = "Umbraco.TextBox") => values.Add(new JsonObject
        {
            ["editorAlias"] = editor,
            ["alias"] = alias,
            ["value"] = value?.DeepClone(),
            ["culture"] = null,
            ["segment"] = null,
        });
    }

    private static JsonObject Properties(JsonObject contentItem)
    {
        JsonObject result = [];
        foreach (JsonObject value in contentItem["values"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            string alias = String(value, "alias");
            if (!string.IsNullOrWhiteSpace(alias)) result[alias] = value["value"]?.DeepClone();
        }
        return result;
    }

    private static string NormalizeAccent(string accent) =>
        accent is "coral" or "blue" or "green" or "yellow" ? accent : "coral";

    private static string String(JsonObject value, string key) =>
        value[key]?.ToString() ?? string.Empty;

    private static Guid StableGuid(string value)
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return new Guid(hash[..16]);
    }

    private static string? NormalizeIdentity(string? value) =>
        Guid.TryParse(value, out Guid identity) ? identity.ToString() : null;

    private sealed record LegacyBlockIdentity(Guid ContentKey, string? CanonicalId);
}
