namespace OlavurEllefsen.Umbraco.Sync;

public static class OlavurSyncEndpoints
{
    public static IEndpointRouteBuilder MapOlavurSyncEndpoints(this IEndpointRouteBuilder endpoints)
    {
        RouteGroupBuilder group = endpoints.MapGroup("/api/olavur-sync");
        group.AddEndpointFilter(async (context, next) =>
        {
            IConfiguration configuration = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            string? configuredKey = configuration["OlavurSync:ApiKey"];
            string suppliedKey = context.HttpContext.Request.Headers["X-Olavur-Sync-Key"].ToString();
            if (string.IsNullOrWhiteSpace(configuredKey) ||
                !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(configuredKey),
                    System.Text.Encoding.UTF8.GetBytes(suppliedKey)))
            {
                return Results.Unauthorized();
            }
            return await next(context);
        });

        group.MapGet("/export", (OlavurSyncService sync) =>
        {
            SiteSnapshot snapshot = sync.Export();
            return Results.Ok(snapshot);
        });

        group.MapGet("/status", (OlavurSyncService sync) => Results.Ok(new
        {
            hash = sync.CurrentHash(),
            documents = sync.DocumentCount(),
            contractVersion = 3,
            canonicalProvider = "usable",
        }));

        group.MapPost("/import", async (ImportRequest request, OlavurSyncService sync) =>
        {
            string currentHash = sync.CurrentHash();
            if (!request.Force && !string.IsNullOrWhiteSpace(request.ExpectedTargetHash) &&
                !string.Equals(request.ExpectedTargetHash, currentHash, StringComparison.Ordinal))
            {
                return Results.Conflict(new
                {
                    error = "target_changed",
                    message = "The Umbraco projection changed during refresh. Export and review before retrying.",
                    currentHash,
                });
            }
            return Results.Ok(await sync.ImportAsync(request));
        });

        return endpoints;
    }
}
