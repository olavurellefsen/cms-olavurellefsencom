
using OlavurEllefsen.Umbraco.Sync;
using OlavurEllefsen.Umbraco.Identity;
using Microsoft.AspNetCore.DataProtection;
using Umbraco.Cms.Core.Notifications;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

string? dataProtectionPath = builder.Configuration["DataProtection:KeysPath"];
if (!string.IsNullOrWhiteSpace(dataProtectionPath))
{
    Directory.CreateDirectory(dataProtectionPath);
    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionPath))
        .SetApplicationName("OlavurEllefsen.Umbraco");
}

builder.Services.AddSingleton<OlavurSyncService>();
builder.Services.AddSingleton<ArticleBodyBlockAdapter>();
builder.Services.AddSingleton<ArticleRichTextAdapter>();
builder.Services.AddSingleton<SelectedWorkBlockAdapter>();
builder.Services.AddSingleton<ProjectionWriteGuard>();
builder.Services.AddHttpClient<UsableProjectionClient>();
builder.Services.Configure<UsableIdentityOptions>(builder.Configuration.GetSection(UsableIdentityOptions.SectionName));
builder.Services.AddHttpClient<UsableIdentitySessionService>();

IUmbracoBuilder umbracoBuilder = builder.CreateUmbracoBuilder()
    .AddBackOffice()
    .AddWebsite()
    .AddDeliveryApi()
    .AddComposers();

if (builder.Configuration.GetValue<bool>($"{UsableIdentityOptions.SectionName}:Enabled"))
    umbracoBuilder.AddUsableBackOfficeAuthentication();

umbracoBuilder
    .AddNotificationAsyncHandler<ContentSavingNotification, UsableProjectionSavingHandler>()
    .Build();

WebApplication app = builder.Build();


await app.BootUmbracoAsync();


app.UseUmbraco()
    .WithMiddleware(u =>
    {
        u.UseBackOffice();
        u.UseWebsite();
    })
    .WithEndpoints(u =>
    {
        u.UseBackOfficeEndpoints();
        u.UseWebsiteEndpoints();
    });

app.MapOlavurSyncEndpoints();
app.MapGet("/health", () => Results.Text("ok", "text/plain"));

await app.RunAsync();
