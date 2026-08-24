using System.Text.Json.Nodes;

namespace OlavurEllefsen.Umbraco.Sync;

internal static class CollectionCompatibilityCodec
{
    public static JsonArray LegacyScalarArray(JsonNode? canonical, string valuePath = "$value")
    {
        JsonArray result = [];
        foreach (JsonNode? item in canonical as JsonArray ?? [])
        {
            result.Add(item is JsonObject wrapped && wrapped[valuePath] is JsonNode value
                ? value.DeepClone()
                : item?.DeepClone());
        }
        return result;
    }

    public static JsonObject LegacyObject(JsonObject canonical, string identityPath = "$id")
    {
        JsonObject result = canonical.DeepClone().AsObject();
        result.Remove(identityPath);
        return result;
    }
}
