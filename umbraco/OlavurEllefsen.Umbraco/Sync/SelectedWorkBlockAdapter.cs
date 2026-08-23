using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace OlavurEllefsen.Umbraco.Sync;

public sealed class SelectedWorkBlockAdapter
{
    internal const string ElementAlias = "olavurSelectedWorkItem";

    public string Project(JsonObject content, Guid elementKey)
    {
        JsonArray layout = [];
        JsonArray contentData = [];
        JsonArray expose = [];
        int ordinal = 0;

        foreach (JsonObject item in content["selectedWork"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            Guid contentKey = StableGuid($"{ordinal++}\0{item.ToJsonString()}");
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

    public JsonArray? ToCanonical(string raw)
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
            result.Add(new JsonObject
            {
                ["name"] = JsonValue.Create(String(values, "workName")),
                ["role"] = JsonValue.Create(String(values, "workRole")),
                ["description"] = JsonValue.Create(String(values, "workDescription")),
                ["href"] = JsonValue.Create(String(values, "workHref")),
                ["accent"] = JsonValue.Create(NormalizeAccent(String(values, "workAccent"))),
            });
        }
        return result;
    }

    public bool MatchesCanonical(JsonObject content, string nativeValue)
    {
        JsonArray expected = content["selectedWork"] as JsonArray ?? [];
        JsonArray? actual = ToCanonical(nativeValue);
        return actual is not null && JsonNode.DeepEquals(expected, actual);
    }

    private static JsonArray Values(JsonObject item)
    {
        JsonArray values = [];
        Add("workName", item["name"]);
        Add("workRole", item["role"]);
        Add("workDescription", item["description"], "Umbraco.TextArea");
        Add("workHref", item["href"]);
        Add("workAccent", item["accent"]);
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
}
