using System.Text.Json.Nodes;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Core.Services;

namespace OlavurEllefsen.Umbraco.Sync;

public sealed class UsableProjectionSavingHandler(
    ProjectionWriteGuard writeGuard,
    UsableProjectionClient usable,
    IContentService contentService,
    ArticleRichTextAdapter articleRichText,
    SelectedWorkBlockAdapter selectedWork) : INotificationAsyncHandler<ContentSavingNotification>
{
    private static readonly string[] ImmutableAliases =
    [
        OlavurSyncService.KindAlias,
        OlavurSyncService.PageIdAlias,
        OlavurSyncService.PathAlias,
        OlavurSyncService.SelectedWorkModeAlias,
        OlavurSyncService.SourceAlias,
        OlavurSyncService.SourceHashAlias,
    ];

    public async Task HandleAsync(
        ContentSavingNotification notification,
        CancellationToken cancellationToken)
    {
        if (writeGuard.IsSuppressed) return;
        List<IContent> projected = notification.SavedEntities
            .Where(x => x.ContentType.Alias is
                OlavurSyncService.DocumentTypeAlias or
                OlavurSyncService.HomeDocumentTypeAlias or
                OlavurSyncService.ArticleDocumentTypeAlias)
            .ToList();
        if (projected.Count == 0) return;
        if (projected.Count > 1)
        {
            Cancel(notification, "Save projected documents individually so every Usable publication can be verified.");
            return;
        }

        IContent candidate = projected[0];
        IContent? persisted = candidate.Id > 0 ? contentService.GetById(candidate.Id) : null;
        if (persisted is null)
        {
            Cancel(notification, "New pages must be created through Usable CMS before they can appear in Umbraco.");
            return;
        }

        foreach (string alias in ImmutableAliases)
        {
            if (OlavurSyncService.Value(candidate, alias) == OlavurSyncService.Value(persisted, alias))
                continue;
            Cancel(notification, "Projection identity fields are managed by Usable and cannot be edited in Umbraco.");
            return;
        }

        string source = OlavurSyncService.Value(persisted, OlavurSyncService.SourceAlias);
        if (!OlavurSyncService.TryCanonicalSource(source, out _, out string fragmentId))
        {
            Cancel(notification, "This document is not mapped to a canonical Usable fragment. Refresh the projection.");
            return;
        }

        try
        {
            JsonObject content = OlavurSyncService.CanonicalContent(candidate);
            JsonObject persistedContent = OlavurSyncService.CanonicalContent(persisted);
            bool nativeArticle = candidate.ContentType.Alias == OlavurSyncService.ArticleDocumentTypeAlias;
            bool nativeHome = candidate.ContentType.Alias == OlavurSyncService.HomeDocumentTypeAlias;
            if (nativeArticle || nativeHome)
            {
                if (nativeHome)
                {
                    SelectedWorkProjectionKeyMode storedMode = SelectedWorkMode(candidate);
                    await usable.RequireSelectedWorkProjectionKeyModeAsync(
                        storedMode,
                        SelectedWorkBlockAdapter.SchemaPlanFingerprint,
                        cancellationToken);
                    if (storedMode == SelectedWorkProjectionKeyMode.LegacyShadow &&
                        !selectedWork.PreservesLegacyIdentityState(
                            OlavurSyncService.Value(persisted, OlavurSyncService.SelectedWorkAlias),
                            OlavurSyncService.Value(candidate, OlavurSyncService.SelectedWorkAlias)))
                        throw new UsableProjectionException(
                            "Stable Selected Work identity metadata changed or is missing. Refresh the projection before saving.");
                }
                bool nativeMatches = nativeArticle
                    ? ArticleNativeMatches(candidate, content)
                    : HomeNativeMatches(candidate, content);
                if (!nativeMatches)
                    throw new UsableProjectionDraftRequiredException(
                        "The native Umbraco fields do not match the Usable draft payload. Wait for the publishing panel to synchronize, then save again.");

                ValidateAllowedChanges(candidate, persisted, persistedContent, content);

                JsonObject publishedPayload = OlavurSyncService.ParseObject(
                    OlavurSyncService.Value(candidate, OlavurSyncService.PublishedPayloadAlias));
                JsonObject persistedPublishedPayload = OlavurSyncService.ParseObject(
                    OlavurSyncService.Value(persisted, OlavurSyncService.PublishedPayloadAlias));
                JsonObject publishedContent = PublishedContent(publishedPayload);
                JsonObject persistedPublishedContent = PublishedContent(persistedPublishedPayload);
                if (JsonNode.DeepEquals(publishedContent, persistedPublishedContent)) return;
                if (!JsonNode.DeepEquals(publishedPayload, OlavurSyncService.ParseObject(
                        OlavurSyncService.Value(candidate, OlavurSyncService.PayloadAlias))))
                    throw new UsableProjectionException(
                        "The published projection must match the current Usable draft before Umbraco can publish it.");

                ValidateAllowedChanges(candidate, persisted, persistedPublishedContent, publishedContent);
                string nativeVerifiedHash = await usable.VerifyPublishedAsync(
                    fragmentId,
                    publishedContent,
                    OlavurSyncService.Value(persisted, OlavurSyncService.SourceHashAlias),
                    cancellationToken);
                candidate.SetValue(OlavurSyncService.SourceHashAlias, nativeVerifiedHash);
                return;
            }
            if (JsonNode.DeepEquals(content, persistedContent)) return;
            ValidateAllowedChanges(candidate, persisted, persistedContent, content);

            string verifiedHash = await usable.VerifyPublishedAsync(
                fragmentId,
                content,
                OlavurSyncService.Value(persisted, OlavurSyncService.SourceHashAlias),
                cancellationToken);
            candidate.SetValue(OlavurSyncService.SourceHashAlias, verifiedHash);
        }
        catch (Exception exception) when (exception is UsableProjectionException or System.Text.Json.JsonException)
        {
            Cancel(notification, exception.Message);
        }
    }

    private bool ArticleNativeMatches(IContent candidate, JsonObject content)
    {
        if (OlavurSyncService.Value(candidate, OlavurSyncService.ArticleTitleAlias) !=
            content["title"]?.GetValue<string>()) return false;
        if (OlavurSyncService.Value(candidate, OlavurSyncService.ArticleSummaryAlias) !=
            content["summary"]?.GetValue<string>()) return false;
        if (!articleRichText.MatchesCanonical(
                content,
                OlavurSyncService.Value(candidate, OlavurSyncService.ArticleBodyAlias))) return false;

        JsonArray expectedTopics = CollectionCompatibilityCodec.LegacyScalarArray(content["topics"]);
        JsonArray actualTopics;
        try
        {
            actualTopics = JsonNode.Parse(OlavurSyncService.Value(candidate, OlavurSyncService.ArticleTopicsAlias)) as JsonArray ?? [];
        }
        catch { return false; }
        return JsonNode.DeepEquals(expectedTopics, actualTopics);
    }

    private bool HomeNativeMatches(IContent candidate, JsonObject content)
    {
        SelectedWorkProjectionKeyMode mode = SelectedWorkMode(candidate);
        return selectedWork.MatchesCanonical(
            content,
            OlavurSyncService.Value(candidate, OlavurSyncService.SelectedWorkAlias),
            mode);
    }

    private static SelectedWorkProjectionKeyMode SelectedWorkMode(IContent content) =>
        OlavurSyncService.Value(content, OlavurSyncService.SelectedWorkModeAlias) == "managed-v2"
            ? SelectedWorkProjectionKeyMode.ManagedV2
            : SelectedWorkProjectionKeyMode.LegacyShadow;

    private static JsonObject PublishedContent(JsonObject payload) =>
        payload["content"] as JsonObject ?? new JsonObject();

    private static void ValidateAllowedChanges(
        IContent candidate,
        IContent persisted,
        JsonObject persistedContent,
        JsonObject content)
    {
        if (content.Count == 0)
            throw new UsableProjectionException("Projected content must be a non-empty JSON object.");
        if (OlavurSyncService.Value(candidate, OlavurSyncService.KindAlias) == "page" &&
            !HasUnchangedPageEnvelope(candidate, persisted))
            throw new UsableProjectionException(
                "Page ID and path are managed by Usable. Edit only the article fields.");

        IReadOnlyList<string> disallowed = ProjectionEditPolicy.DisallowedChanges(
            OlavurSyncService.Value(candidate, OlavurSyncService.KindAlias),
            OlavurSyncService.Value(candidate, OlavurSyncService.PageIdAlias),
            persistedContent,
            content);
        if (disallowed.Count > 0)
            throw new UsableProjectionException(
                $"These changes are outside the Usable CMS manifest: {string.Join(", ", disallowed)}.");
    }

    private static bool HasUnchangedPageEnvelope(IContent candidate, IContent persisted)
    {
        JsonObject next = OlavurSyncService.ParseObject(
            OlavurSyncService.Value(candidate, OlavurSyncService.PayloadAlias));
        JsonObject current = OlavurSyncService.ParseObject(
            OlavurSyncService.Value(persisted, OlavurSyncService.PayloadAlias));
        return new[] { "id", "title", "path" }
            .All(key => JsonNode.DeepEquals(next[key], current[key]));
    }

    private static void Cancel(ContentSavingNotification notification, string message) =>
        notification.CancelOperation(
            new EventMessage("Usable canonical content", message, EventMessageType.Error));
}
