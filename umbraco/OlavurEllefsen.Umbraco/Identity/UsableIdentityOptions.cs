namespace OlavurEllefsen.Umbraco.Identity;

public sealed class UsableIdentityOptions
{
    public const string SectionName = "UsableIdentity";

    public bool Enabled { get; set; }
    public string Issuer { get; set; } = "https://auth.flowcore.io/realms/memory-mesh";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string CallbackPath { get; set; } = "/signin-usable";
    public string CmsOrigin { get; set; } = "https://cms.usable.dev";
    public string SiteId { get; set; } = "";
    public string SiteCredential { get; set; } = "";
    public string PublicOrigin { get; set; } = "https://www.olavurellefsen.com";
}
