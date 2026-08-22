using OlavurEllefsen.Umbraco.Identity;
using Umbraco.Cms.Api.Management.Security;
using Xunit;

namespace OlavurEllefsen.Umbraco.Tests;

public sealed class UsableBackOfficeAuthenticationTests
{
    [Fact]
    public void UsableProviderDisablesLocalLogin()
    {
        BackOfficeExternalLoginProviderOptions options = new();

        new UsableBackOfficeExternalLoginProviderOptions().Configure(
            UsableBackOfficeAuthentication.ProviderName,
            options);

        Assert.True(options.DenyLocalLogin);
        Assert.NotNull(options.AutoLinkOptions);
    }

    [Fact]
    public void OtherProvidersRemainUnchanged()
    {
        BackOfficeExternalLoginProviderOptions options = new();
        ExternalSignInAutoLinkOptions originalAutoLinkOptions = options.AutoLinkOptions;

        new UsableBackOfficeExternalLoginProviderOptions().Configure("Umbraco.Other", options);

        Assert.False(options.DenyLocalLogin);
        Assert.Same(originalAutoLinkOptions, options.AutoLinkOptions);
    }
}
