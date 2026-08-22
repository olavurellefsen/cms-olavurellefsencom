using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;

namespace OlavurEllefsen.Umbraco.Identity;

public sealed record BrokerSessionResponse(HttpStatusCode StatusCode, string Body)
{
    public bool IsSuccess => (int)StatusCode is >= 200 and < 300;
}

public sealed class UsableIdentitySessionService(
    HttpClient http,
    IOptions<UsableIdentityOptions> configuredOptions,
    IExternalLoginWithKeyService externalLogins)
{
    private readonly UsableIdentityOptions options = configuredOptions.Value;

    public async Task<BrokerSessionResponse> CreateAsync(Guid userKey, CancellationToken cancellationToken)
    {
        List<IIdentityUserToken> stored = externalLogins.GetExternalLoginTokens(userKey).ToList();
        string provider = UsableBackOfficeAuthentication.ProviderName;
        string? accessToken = Token(stored, provider, "access_token");
        string? refreshToken = Token(stored, provider, "refresh_token");
        DateTimeOffset? expiresAt = ParseExpiry(Token(stored, provider, "expires_at"));

        if (string.IsNullOrWhiteSpace(accessToken))
            return new BrokerSessionResponse(HttpStatusCode.Unauthorized, "{\"error\":\"usable_external_login_required\"}");

        if (!expiresAt.HasValue || expiresAt.Value <= DateTimeOffset.UtcNow.AddMinutes(2))
        {
            if (string.IsNullOrWhiteSpace(refreshToken))
                return new BrokerSessionResponse(HttpStatusCode.Unauthorized, "{\"error\":\"usable_external_login_expired\"}");

            TokenRefreshResult refreshed = await RefreshAsync(refreshToken, cancellationToken);
            accessToken = refreshed.AccessToken;
            SaveTokens(userKey, stored, provider, refreshed);
        }

        return await ExchangeAsync(accessToken, cancellationToken);
    }

    public async Task<BrokerSessionResponse> ExchangeAsync(string accessToken, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        UriBuilder endpoint = new($"{options.CmsOrigin.TrimEnd('/')}/api/broker/federated-session");
        endpoint.Query = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["site"] = options.SiteId,
            ["token"] = options.SiteCredential,
            ["origin"] = options.PublicOrigin,
        }).ReadAsStringAsync(cancellationToken).GetAwaiter().GetResult();

        using HttpRequestMessage request = new(HttpMethod.Post, endpoint.Uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.TryAddWithoutValidation("Origin", options.PublicOrigin);
        using HttpResponseMessage response = await http.SendAsync(request, cancellationToken);
        string body = await response.Content.ReadAsStringAsync(cancellationToken);
        return new BrokerSessionResponse(response.StatusCode, body);
    }

    private async Task<TokenRefreshResult> RefreshAsync(string refreshToken, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        using HttpRequestMessage request = new(
            HttpMethod.Post,
            $"{options.Issuer.TrimEnd('/')}/protocol/openid-connect/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = options.ClientId,
                ["client_secret"] = options.ClientSecret,
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = refreshToken,
            }),
        };
        using HttpResponseMessage response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException("The Usable identity session could not be renewed.");

        using JsonDocument payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        string? accessToken = payload.RootElement.GetProperty("access_token").GetString();
        if (string.IsNullOrWhiteSpace(accessToken))
            throw new InvalidOperationException("Usable identity renewal did not return an access token.");
        string? rotatedRefresh = payload.RootElement.TryGetProperty("refresh_token", out JsonElement refresh)
            ? refresh.GetString()
            : null;
        int expiresIn = payload.RootElement.TryGetProperty("expires_in", out JsonElement expiry)
            ? expiry.GetInt32()
            : 900;
        return new TokenRefreshResult(accessToken, rotatedRefresh ?? refreshToken, DateTimeOffset.UtcNow.AddSeconds(expiresIn));
    }

    private void SaveTokens(
        Guid userKey,
        IReadOnlyCollection<IIdentityUserToken> stored,
        string provider,
        TokenRefreshResult refreshed)
    {
        Dictionary<(string Provider, string Name), string> tokens = stored.ToDictionary(
            token => (token.LoginProvider, token.Name),
            token => token.Value);
        tokens[(provider, "access_token")] = refreshed.AccessToken;
        tokens[(provider, "refresh_token")] = refreshed.RefreshToken;
        tokens[(provider, "expires_at")] = refreshed.ExpiresAt.ToString("o", CultureInfo.InvariantCulture);
        externalLogins.Save(userKey, tokens.Select(token =>
            new ExternalLoginToken(token.Key.Provider, token.Key.Name, token.Value)));
    }

    private static string? Token(IEnumerable<IIdentityUserToken> tokens, string provider, string name) =>
        tokens.FirstOrDefault(token =>
            string.Equals(token.LoginProvider, provider, StringComparison.Ordinal) &&
            string.Equals(token.Name, name, StringComparison.Ordinal))?.Value;

    private static DateTimeOffset? ParseExpiry(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out DateTimeOffset parsed)
            ? parsed
            : null;

    private void EnsureConfigured()
    {
        if (!options.Enabled || string.IsNullOrWhiteSpace(options.ClientId) ||
            string.IsNullOrWhiteSpace(options.ClientSecret) || string.IsNullOrWhiteSpace(options.SiteId) ||
            string.IsNullOrWhiteSpace(options.SiteCredential))
            throw new InvalidOperationException("Usable backoffice identity is not configured.");
    }

    private sealed record TokenRefreshResult(string AccessToken, string RefreshToken, DateTimeOffset ExpiresAt);
}
