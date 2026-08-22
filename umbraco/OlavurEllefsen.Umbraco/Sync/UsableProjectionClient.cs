using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace OlavurEllefsen.Umbraco.Sync;

public sealed class UsableProjectionClient(HttpClient httpClient, IConfiguration configuration)
{
    public async Task<string> VerifyPublishedAsync(
        string fragmentId,
        JsonObject content,
        string expectedCanonicalHash,
        CancellationToken cancellationToken)
    {
        JsonObject canonical = await ReadAsync(fragmentId, cancellationToken);
        string canonicalHash = OlavurSyncService.Hash(canonical);
        string candidateHash = OlavurSyncService.Hash(content);

        if (string.Equals(canonicalHash, candidateHash, StringComparison.Ordinal))
            return canonicalHash;

        if (!string.Equals(canonicalHash, expectedCanonicalHash, StringComparison.Ordinal))
            throw new UsableProjectionConflictException(
                "Usable content changed after this Umbraco projection was loaded. Refresh the projection before saving.");

        throw new UsableProjectionDraftRequiredException(
            "This edit is not published in Usable. Use Save Usable draft, then Publish in the structured content editor.");
    }

    private async Task<JsonObject> ReadAsync(string fragmentId, CancellationToken cancellationToken)
    {
        using HttpRequestMessage request = CreateRequest(HttpMethod.Get, fragmentId);
        using HttpResponseMessage response = await httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new UsableProjectionException(
                $"Usable canonical content could not be read (HTTP {(int)response.StatusCode}).");

        JsonNode root = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken))
            ?? throw new UsableProjectionException("Usable returned an empty canonical response.");
        JsonNode? contentNode = root["fragment"]?["content"] ?? root["content"];
        if (contentNode is JsonObject contentObject) return contentObject;
        string? raw = contentNode?.GetValue<string>();
        return ParseFragmentContent(raw)
            ?? throw new UsableProjectionException("Usable returned canonical content that was not valid JSON.");
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string fragmentId)
    {
        string token = configuration["UsableProjection:ServerToken"]
            ?? Environment.GetEnvironmentVariable("USABLE_CMS_SERVER_TOKEN")
            ?? throw new UsableProjectionException(
                "Usable canonical verification is not configured. Set a server-side read token.");
        string origin = (configuration["UsableProjection:ApiBaseUrl"]
            ?? Environment.GetEnvironmentVariable("USABLE_API_BASE_URL")
            ?? "https://usable.dev").TrimEnd('/');
        HttpRequestMessage request = new(method, $"{origin}/api/memory-fragments/{fragmentId}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    internal static JsonObject? ParseFragmentContent(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        string candidate = raw.Trim();
        if (candidate.StartsWith("---", StringComparison.Ordinal))
        {
            int closing = candidate.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (closing >= 0) candidate = candidate[(closing + 4)..].Trim();
        }
        if (candidate.StartsWith("```", StringComparison.Ordinal))
        {
            int firstNewline = candidate.IndexOf('\n');
            int closingFence = candidate.LastIndexOf("```", StringComparison.Ordinal);
            if (firstNewline >= 0 && closingFence > firstNewline)
                candidate = candidate[(firstNewline + 1)..closingFence].Trim();
        }
        try
        {
            return JsonNode.Parse(candidate) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

public class UsableProjectionException(string message) : Exception(message);

public sealed class UsableProjectionConflictException(string message) : UsableProjectionException(message);

public sealed class UsableProjectionDraftRequiredException(string message) : UsableProjectionException(message);
