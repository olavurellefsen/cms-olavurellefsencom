using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Umbraco.Cms.Api.Management.Security;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Extensions;

namespace OlavurEllefsen.Umbraco.Identity;

public static class UsableBackOfficeAuthentication
{
    public const string SchemeName = "Usable";
    public const string ProviderName = "Umbraco.Usable";

    public static IUmbracoBuilder AddUsableBackOfficeAuthentication(this IUmbracoBuilder builder)
    {
        builder.Services.ConfigureOptions<UsableBackOfficeExternalLoginProviderOptions>();
        builder.Services.ConfigureOptions<ConfigureUsableOpenIdConnectOptions>();
        builder.AddBackOfficeExternalLogins(logins =>
        {
            logins.AddBackOfficeLogin(authentication =>
            {
                string scheme = BackOfficeAuthenticationBuilder.SchemeForBackOffice(SchemeName)
                    ?? throw new InvalidOperationException("Could not create the Usable backoffice authentication scheme.");
                authentication.AddOpenIdConnect(scheme, _ => { });
            });
        });
        return builder;
    }
}

public sealed class UsableBackOfficeExternalLoginProviderOptions : IConfigureNamedOptions<BackOfficeExternalLoginProviderOptions>
{
    public void Configure(string? name, BackOfficeExternalLoginProviderOptions options)
    {
        if (name != UsableBackOfficeAuthentication.ProviderName) return;

        options.AutoLinkOptions = new ExternalSignInAutoLinkOptions(
            autoLinkExternalAccount: true,
            defaultUserGroups: ["editor"],
            defaultCulture: null,
            allowManualLinking: false)
        {
            OnAutoLinking = (user, _) => user.IsApproved = true,
            OnExternalLogin = (_, _) => true,
        };

        // When this provider is enabled, Usable is the sole backoffice identity.
        // Recovery requires explicitly disabling federation and redeploying.
        options.DenyLocalLogin = true;
    }

    public void Configure(BackOfficeExternalLoginProviderOptions options) =>
        Configure(UsableBackOfficeAuthentication.ProviderName, options);
}

public sealed class ConfigureUsableOpenIdConnectOptions(
    IOptions<UsableIdentityOptions> identityOptions) : IConfigureNamedOptions<OpenIdConnectOptions>
{
    public void Configure(string? name, OpenIdConnectOptions options)
    {
        if (name != UsableBackOfficeAuthentication.ProviderName) return;

        UsableIdentityOptions configured = identityOptions.Value;
        options.Authority = configured.Issuer.TrimEnd('/');
        options.ClientId = configured.ClientId;
        options.ClientSecret = configured.ClientSecret;
        options.CallbackPath = configured.CallbackPath;
        options.ResponseType = OpenIdConnectResponseType.Code;
        options.UsePkce = true;
        options.SaveTokens = true;
        options.GetClaimsFromUserInfoEndpoint = true;
        options.RequireHttpsMetadata = !configured.Issuer.StartsWith("http://", StringComparison.OrdinalIgnoreCase);
        options.TokenValidationParameters.NameClaimType = "name";
        options.Scope.Clear();
        foreach (string scope in new[]
                 {
                     "openid", "profile", "email", "offline_access", "workspace.read",
                     "fragments.read", "fragments.create", "fragments.update"
                 })
        {
            options.Scope.Add(scope);
        }

        options.Events.OnTokenValidated = async context =>
        {
            string? accessToken = context.TokenEndpointResponse?.AccessToken;
            if (string.IsNullOrWhiteSpace(accessToken))
            {
                context.Fail("Usable did not return an access token.");
                return;
            }

            UsableIdentitySessionService sessions = context.HttpContext.RequestServices
                .GetRequiredService<UsableIdentitySessionService>();
            BrokerSessionResponse authorization = await sessions.ExchangeAsync(accessToken, context.HttpContext.RequestAborted);
            if (!authorization.IsSuccess)
            {
                context.Fail(authorization.StatusCode == System.Net.HttpStatusCode.Forbidden
                    ? "This Usable account cannot access this site's workspace."
                    : "Usable could not verify workspace access.");
                return;
            }

            ClaimsIdentity? identity = context.Principal?.Identity as ClaimsIdentity;
            string? email = context.Principal?.FindFirst("email")?.Value;
            string? displayName = context.Principal?.FindFirst("name")?.Value
                ?? context.Principal?.FindFirst("preferred_username")?.Value;
            if (identity is not null && !string.IsNullOrWhiteSpace(email) && !identity.HasClaim(x => x.Type == ClaimTypes.Email))
                identity.AddClaim(new Claim(ClaimTypes.Email, email));
            if (identity is not null && !string.IsNullOrWhiteSpace(displayName) && !identity.HasClaim(x => x.Type == ClaimTypes.Name))
                identity.AddClaim(new Claim(ClaimTypes.Name, displayName));
        };
    }

    public void Configure(OpenIdConnectOptions options) =>
        Configure(UsableBackOfficeAuthentication.ProviderName, options);
}
