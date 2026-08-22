using System.Net;
using Microsoft.Extensions.Options;
using OlavurEllefsen.Umbraco.Identity;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;
using Xunit;

namespace OlavurEllefsen.Umbraco.Tests;

public sealed class UsableIdentitySessionServiceTests
{
    [Fact]
    public async Task ExchangeUsesBearerIdentityAndExactSiteBindingWithoutForwardingRefreshCredentials()
    {
        HttpRequestMessage? captured = null;
        StubHandler handler = new(request =>
        {
            captured = request;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"sessionToken\":\"bs1.opaque\"}"),
            });
        });
        UsableIdentitySessionService service = new(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(IdentityOptions()),
            new ExternalLoginStub());

        BrokerSessionResponse result = await service.ExchangeAsync("marketplace-access", CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Bearer", captured?.Headers.Authorization?.Scheme);
        Assert.Equal("marketplace-access", captured?.Headers.Authorization?.Parameter);
        Assert.Equal("https://www.example.test", captured?.Headers.GetValues("Origin").Single());
        Assert.Equal("site-id", Query(captured?.RequestUri, "site"));
        Assert.Equal("ucms1.public", Query(captured?.RequestUri, "token"));
        Assert.Equal("https://www.example.test", Query(captured?.RequestUri, "origin"));
        Assert.DoesNotContain("refresh", captured?.RequestUri?.Query ?? "", StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task LocalUmbracoUserWithoutExternalTokensFallsBackWithoutCallingUsable()
    {
        StubHandler handler = new(_ => throw new InvalidOperationException("HTTP should not be called"));
        UsableIdentitySessionService service = new(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(IdentityOptions()),
            new ExternalLoginStub());

        BrokerSessionResponse result = await service.CreateAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(HttpStatusCode.Unauthorized, result.StatusCode);
        Assert.Contains("usable_external_login_required", result.Body);
    }

    private static UsableIdentityOptions IdentityOptions() => new()
    {
        Enabled = true,
        Issuer = "https://identity.example.test/realms/memory-mesh",
        ClientId = "umbraco-client",
        ClientSecret = "secret",
        CmsOrigin = "https://cms.example.test",
        SiteId = "site-id",
        SiteCredential = "ucms1.public",
        PublicOrigin = "https://www.example.test",
    };

    private static string? Query(Uri? uri, string key)
    {
        if (uri is null) return null;
        return uri.Query.TrimStart('?').Split('&')
            .Select(pair => pair.Split('=', 2))
            .Where(pair => pair.Length == 2 && Uri.UnescapeDataString(pair[0]) == key)
            .Select(pair => Uri.UnescapeDataString(pair[1].Replace('+', ' ')))
            .SingleOrDefault();
    }

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => response(request);
    }

    private sealed class ExternalLoginStub : IExternalLoginWithKeyService
    {
        public IEnumerable<IIdentityUserLogin> GetExternalLogins(Guid userOrMemberKey) => [];
        public IEnumerable<IIdentityUserToken> GetExternalLoginTokens(Guid userOrMemberKey) => [];
        public IEnumerable<IIdentityUserLogin> Find(string loginProvider, string providerKey) => [];
        public void Save(Guid userOrMemberKey, IEnumerable<IExternalLogin> logins) => throw new NotSupportedException();
        public void Save(Guid userOrMemberKey, IEnumerable<IExternalLoginToken> tokens) => throw new NotSupportedException();
        public void DeleteUserLogins(Guid userOrMemberKey) => throw new NotSupportedException();
    }
}
