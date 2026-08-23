using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using OlavurEllefsen.Umbraco.Identity;
using OlavurEllefsen.Umbraco.Sync;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;
using Xunit;

namespace OlavurEllefsen.Umbraco.Tests;

public sealed class OlavurSyncEndpointAuthorizationTests
{
    [Fact]
    public async Task CmsSessionRequiresBackOfficeAccessPolicy()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.Services.AddSingleton<IBackOfficeSecurityAccessor>(_ => null!);
        builder.Services.AddSingleton<UsableIdentitySessionService>(_ => null!);
        builder.Services.AddSingleton<OlavurSyncService>(_ => null!);
        await using WebApplication app = builder.Build();

        app.MapOlavurSyncEndpoints();

        RouteEndpoint endpoint = ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(candidate => candidate.RoutePattern.RawText == "/api/olavur-sync/cms-session");

        Assert.Contains(
            endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>(),
            authorization => authorization.Policy == AuthorizationPolicies.BackOfficeAccess);
    }
}
