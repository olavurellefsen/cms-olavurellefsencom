
using OlavurEllefsen.Umbraco.Sync;
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
builder.Services.AddSingleton<ProjectionWriteGuard>();
builder.Services.AddHttpClient<UsableProjectionClient>();

builder.CreateUmbracoBuilder()
    .AddBackOffice()
    .AddWebsite()
    .AddDeliveryApi()
    .AddComposers()
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
