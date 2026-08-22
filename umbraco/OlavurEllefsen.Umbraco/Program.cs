
using OlavurEllefsen.Umbraco.Sync;
using Umbraco.Cms.Core.Notifications;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

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

await app.RunAsync();
