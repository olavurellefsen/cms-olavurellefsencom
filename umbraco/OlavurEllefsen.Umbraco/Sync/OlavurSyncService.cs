using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.ContentTypeEditing;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Services.ContentTypeEditing;
using Umbraco.Cms.Core.Serialization;
using Umbraco.Cms.Core.Strings;

namespace OlavurEllefsen.Umbraco.Sync;

public sealed class OlavurSyncService(
    IContentService contentService,
    IContentTypeService contentTypeService,
    IContentTypeEditingService contentTypeEditingService,
    IDataTypeService dataTypeService,
    IConfigurationEditorJsonSerializer configurationEditorJsonSerializer,
    PropertyEditorCollection propertyEditors,
    IShortStringHelper shortStringHelper,
    ArticleRichTextAdapter articleRichText,
    SelectedWorkBlockAdapter selectedWork,
    UsableProjectionClient usable,
    ProjectionWriteGuard writeGuard)
{
    internal const string DocumentTypeAlias = "olavurSyncedDocument";
    internal const string HomeDocumentTypeAlias = "olavurHome";
    internal const string ArticleDocumentTypeAlias = "olavurArticle";
    internal const string KindAlias = "syncKind";
    internal const string PageIdAlias = "pageId";
    internal const string PathAlias = "pagePath";
    internal const string PayloadAlias = "payloadJson";
    internal const string PublishedPayloadAlias = "publishedPayloadJson";
    internal const string DraftRevisionAlias = "usableDraftRevisionId";
    internal const string SelectedWorkAlias = "selectedWorkBlocks";
    internal const string SelectedWorkModeAlias = "selectedWorkProjectionMode";
    internal const string BodyBlocksAlias = "articleBodyBlocks";
    internal const string ArticleTitleAlias = "articleTitle";
    internal const string ArticleSummaryAlias = "articleSummary";
    internal const string ArticleBodyAlias = "articleBody";
    internal const string ArticleTopicsAlias = "articleTopics";
    internal const string SourceAlias = "syncSource";
    internal const string SourceHashAlias = "syncSourceHash";
    internal const string StructuredEditorUiAlias = "Olavur.PropertyEditorUi.StructuredContent";
    internal const string HiddenManagedEditorUiAlias = "Olavur.PropertyEditorUi.HiddenManagedValue";

    public SiteSnapshot Export()
    {
        List<IContent> documents = Documents();
        IContent? globalDocument = documents.FirstOrDefault(x => Value(x, KindAlias) == "global");
        JsonObject global = ParseObject(globalDocument is null ? "{}" : Value(globalDocument, PayloadAlias));
        List<SitePage> pages = documents
            .Where(x => Value(x, KindAlias) == "page")
            .Select(x =>
            {
                string payloadValue = x.ContentType.Alias is ArticleDocumentTypeAlias or HomeDocumentTypeAlias
                    ? Value(x, PublishedPayloadAlias)
                    : Value(x, PayloadAlias);
                JsonObject payload = ParseObject(payloadValue);
                string id = Value(x, PageIdAlias);
                string path = Value(x, PathAlias);
                string title = payload["title"]?.GetValue<string>() ?? x.Name ?? id;
                JsonObject content = payload["content"] as JsonObject ?? new JsonObject();
                return new SitePage(id, title, path, content);
            })
            .OrderBy(x => x.Path, StringComparer.Ordinal)
            .ToList();
        SiteSnapshot snapshot = new(global, pages);
        if (globalDocument is not null &&
            TryCanonicalSource(Value(globalDocument, SourceAlias), out string workspaceId, out string globalFragmentId))
        {
            Dictionary<string, string> pageFragmentIds = documents
                .Where(x => Value(x, KindAlias) == "page")
                .Select(x => new
                {
                    PageId = Value(x, PageIdAlias),
                    Source = Value(x, SourceAlias),
                })
                .Where(x => TryCanonicalSource(x.Source, out string pageWorkspaceId, out _) && pageWorkspaceId == workspaceId)
                .ToDictionary(
                    x => x.PageId,
                    x =>
                    {
                        TryCanonicalSource(x.Source, out _, out string fragmentId);
                        return fragmentId;
                    },
                    StringComparer.Ordinal);
            snapshot = snapshot with
            {
                Canonical = new CanonicalProjection("usable", workspaceId, globalFragmentId, pageFragmentIds),
            };
        }
        return snapshot;
    }

    public string CurrentHash() => Hash(Export());

    public int DocumentCount() => Documents().Count;

    public async Task<ImportResult> ImportAsync(ImportRequest request)
    {
        if (request.Snapshot.Canonical is not { Provider: "usable" } canonical)
            throw new InvalidOperationException("A Usable canonical binding is required for projection refreshes.");

        DocumentProjectionSchema projectionSchema = await EnsureDocumentTypesAsync();
        SelectedWorkProjectionKeyMode selectedWorkMode = await usable.GetSelectedWorkProjectionKeyModeAsync(
            SelectedWorkBlockAdapter.SchemaPlanFingerprint,
            CancellationToken.None);
        Dictionary<string, IContent> existing = Documents().ToDictionary(DocumentKey, StringComparer.Ordinal);
        HashSet<string> incomingKeys = new(StringComparer.Ordinal);
        int created = 0;
        int updated = 0;

        using IDisposable _ = writeGuard.Suppress();
        Upsert(
            "global",
            "global",
            "/",
            "Global site settings",
            request.Snapshot.Global,
            canonical.GlobalFragmentId);
        foreach (SitePage page in request.Snapshot.Pages)
        {
            if (!canonical.PageFragmentIds.TryGetValue(page.Id, out string? fragmentId) ||
                string.IsNullOrWhiteSpace(fragmentId))
                throw new InvalidOperationException($"Canonical Usable fragment binding missing for page '{page.Id}'.");

            JsonObject payload = new()
            {
                ["id"] = page.Id,
                ["title"] = page.Title,
                ["path"] = page.Path,
                ["content"] = page.Content.DeepClone(),
            };
            Upsert("page", page.Id, page.Path, page.Title, payload, fragmentId);
        }

        int removed = 0;
        foreach ((string key, IContent stale) in existing)
        {
            if (incomingKeys.Contains(key)) continue;
            contentService.MoveToRecycleBin(stale);
            removed++;
        }

        return new ImportResult(Hash(request.Snapshot), created, updated, removed, DateTimeOffset.UtcNow);

        void Upsert(string kind, string id, string path, string name, JsonObject payload, string fragmentId)
        {
            string key = $"{kind}:{id}";
            incomingKeys.Add(key);
            bool isNew = !existing.TryGetValue(key, out IContent? document);
            JsonObject canonicalContent = kind == "page"
                ? payload["content"] as JsonObject ?? new JsonObject()
                : payload;
            bool isArticle = kind == "page" && canonicalContent["type"]?.GetValue<string>() == "article";
            bool isHome = kind == "page" &&
                (canonicalContent["type"]?.GetValue<string>() == "home" || id == "home");
            IContentType contentType = isArticle
                ? projectionSchema.ArticleType
                : isHome
                    ? projectionSchema.HomeType
                    : projectionSchema.GenericType;
            document ??= contentService.Create(name, -1, contentType);
            if (document.ContentType.Alias != contentType.Alias)
            {
                // Projection documents are rebuildable. Recreate only the local Umbraco projection
                // when an existing article moves onto the dedicated native article document type.
                contentService.MoveToRecycleBin(document);
                document = contentService.Create(name, -1, contentType);
            }
            document.Name = name;
            document.SetValue(KindAlias, kind);
            document.SetValue(PageIdAlias, id);
            document.SetValue(PathAlias, path);
            document.SetValue(PayloadAlias, payload.ToJsonString(JsonOptions));
            if (isArticle)
            {
                document.SetValue(PublishedPayloadAlias, payload.ToJsonString(JsonOptions));
                document.SetValue(DraftRevisionAlias, null);
                document.SetValue(ArticleTitleAlias, canonicalContent["title"]?.GetValue<string>() ?? name);
                document.SetValue(ArticleSummaryAlias, canonicalContent["summary"]?.GetValue<string>() ?? string.Empty);
                document.SetValue(ArticleBodyAlias, articleRichText.Project(canonicalContent, projectionSchema.MediaElementKey));
                document.SetValue(
                    ArticleTopicsAlias,
                    CollectionCompatibilityCodec.LegacyScalarArray(canonicalContent["topics"]).ToJsonString());
            }
            else if (isHome)
            {
                document.SetValue(PublishedPayloadAlias, payload.ToJsonString(JsonOptions));
                document.SetValue(DraftRevisionAlias, null);
                document.SetValue(
                    SelectedWorkModeAlias,
                    selectedWorkMode == SelectedWorkProjectionKeyMode.ManagedV2 ? "managed-v2" : "legacy-shadow");
                document.SetValue(
                    SelectedWorkAlias,
                    selectedWork.Project(
                        canonicalContent,
                        projectionSchema.SelectedWorkElementKey,
                        selectedWorkMode));
            }
            document.SetValue(SourceAlias, CanonicalSource(canonical.WorkspaceId, fragmentId));
            document.SetValue(SourceHashAlias, Hash(canonicalContent));
            contentService.Save(document);
            if (isNew) created++; else updated++;
        }
    }

    private async Task<DocumentProjectionSchema> EnsureDocumentTypesAsync()
    {
        GenericDocumentProjectionSchema generic = await EnsureGenericDocumentTypeAsync();
        SelectedWorkProjectionSchema selectedWorkProjection = await EnsureSelectedWorkProjectionAsync();
        IContentType home = await EnsureHomeDocumentTypeAsync(selectedWorkProjection.DataType);
        Guid mediaElementKey = generic.ElementKeys[ArticleBodyBlockAdapter.MediaElementAlias];
        IDataType articleRichText = await EnsureArticleRichTextDataTypeAsync(mediaElementKey);
        IContentType article = await EnsureArticleDocumentTypeAsync(articleRichText);
        return new DocumentProjectionSchema(
            generic.DocumentType,
            home,
            article,
            mediaElementKey,
            selectedWorkProjection.ElementKey);
    }

    private async Task<IDataType> EnsureArticleRichTextDataTypeAsync(Guid mediaElementKey)
    {
        const string dataTypeName = "Olavur article body";
        IDataType? existing = (await dataTypeService.GetByEditorAliasAsync("Umbraco.RichText"))
            .FirstOrDefault(candidate => candidate.Name == dataTypeName);
        IDataType defaultRichText = (await dataTypeService.GetByEditorAliasAsync("Umbraco.RichText"))
            .First(candidate => candidate.Id < 0);
        RichTextConfiguration configuration = JsonSerializer.Deserialize<RichTextConfiguration>(
            JsonSerializer.Serialize(defaultRichText.ConfigurationObject, JsonOptions), JsonOptions)
            ?? new RichTextConfiguration();
        configuration.Blocks =
        [
            new RichTextConfiguration.RichTextBlockConfiguration
            {
                ContentElementTypeKey = mediaElementKey,
            },
        ];

        if (!propertyEditors.TryGet("Umbraco.RichText", out IDataEditor? editor) || editor is null)
            throw new InvalidOperationException("Umbraco.RichText is not registered.");
        IDictionary<string, object> blockConfigurationData = editor.GetConfigurationEditor()
            .FromConfigurationObject(configuration, configurationEditorJsonSerializer);
        Dictionary<string, object> configurationData = new(defaultRichText.ConfigurationData, StringComparer.Ordinal);
        configurationData["blocks"] = blockConfigurationData["blocks"];
        configurationData["extensions"] = WithoutStringValues(
            configurationData["extensions"],
            "Umb.Tiptap.Embed",
            "Umb.Tiptap.Image",
            "Umb.Tiptap.MediaUpload");
        configurationData["toolbar"] = WithArticleToolbar(WithoutStringValues(
            configurationData["toolbar"],
            "Umb.Tiptap.Toolbar.MediaPicker",
            "Umb.Tiptap.Toolbar.EmbeddedMedia"));
        configurationData.Remove("allowedMediaTypes");
        if (existing is null)
        {
            DataType created = new(editor, configurationEditorJsonSerializer, -1)
            {
                Name = dataTypeName,
                EditorUiAlias = "Umb.PropertyEditorUi.Tiptap",
                ConfigurationData = configurationData,
            };
            await dataTypeService.CreateAsync(created, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
            return (await dataTypeService.GetByEditorAliasAsync("Umbraco.RichText"))
                .First(candidate => candidate.Name == dataTypeName);
        }

        // Keep the full stock Tiptap extension/toolbar configuration while adding the
        // Usable image block. RichTextConfiguration intentionally models only part of it.
        existing.ConfigurationData = configurationData;
        await dataTypeService.UpdateAsync(existing, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        return existing;
    }

    private static object WithoutStringValues(object value, params string[] removed)
    {
        JsonNode? node = JsonNode.Parse(JsonSerializer.Serialize(value, JsonOptions));
        Remove(node);
        return JsonSerializer.Deserialize<object>(node?.ToJsonString() ?? "null", JsonOptions)!;

        void Remove(JsonNode? candidate)
        {
            if (candidate is JsonArray array)
            {
                for (int index = array.Count - 1; index >= 0; index--)
                {
                    if (array[index] is JsonValue item && item.TryGetValue<string>(out string? text) &&
                        removed.Contains(text, StringComparer.Ordinal))
                    {
                        array.RemoveAt(index);
                    }
                    else Remove(array[index]);
                }
            }
            else if (candidate is JsonObject objectValue)
            {
                foreach ((_, JsonNode? child) in objectValue.ToList()) Remove(child);
            }
        }
    }

    private static object WithArticleToolbar(object value)
    {
        JsonArray toolbar = JsonNode.Parse(JsonSerializer.Serialize(value, JsonOptions)) as JsonArray ?? [];
        if (toolbar.FirstOrDefault() is not JsonArray row)
        {
            row = [];
            toolbar.Add(row);
        }
        AddGroup("Umb.Tiptap.Toolbar.StyleSelect", 1);
        AddGroup("Umb.Tiptap.Toolbar.BlockPicker", row.Count);
        return JsonSerializer.Deserialize<object>(toolbar.ToJsonString(), JsonOptions)!;

        void AddGroup(string alias, int index)
        {
            if (row.OfType<JsonArray>().Any(group => group.Any(item => item?.GetValue<string>() == alias))) return;
            row.Insert(Math.Min(index, row.Count), new JsonArray(JsonValue.Create(alias)));
        }
    }

    private async Task<IContentType> EnsureArticleDocumentTypeAsync(IDataType articleRichText)
    {
        IDataType textBox = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextBox")).First();
        IDataType textArea = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextArea")).First();
        IDataType tags = (await dataTypeService.GetByEditorAliasAsync("Umbraco.Tags")).First();
        IDataType structuredContent = await EnsureStructuredContentDataTypeAsync();
        var properties = new (string Alias, string Name, IDataType DataType, bool Mandatory)[]
        {
            (ArticleTitleAlias, "Article title", textBox, true),
            (ArticleSummaryAlias, "Summary", textArea, true),
            (ArticleBodyAlias, "Article body", articleRichText, true),
            (ArticleTopicsAlias, "Topics", tags, false),
            (PayloadAlias, "Usable publishing and hero image", structuredContent, true),
            (KindAlias, "Sync kind", textBox, true),
            (PageIdAlias, "Page ID", textBox, true),
            (PathAlias, "Public path", textBox, true),
            (PublishedPayloadAlias, "Published Usable payload", textArea, true),
            (DraftRevisionAlias, "Usable draft revision", textBox, false),
            (SourceAlias, "Canonical Usable source", textBox, true),
            (SourceHashAlias, "Published source hash", textBox, true),
        };

        IContentType? existing = contentTypeService.Get(ArticleDocumentTypeAlias);
        if (existing is not null)
        {
            bool needsUpdate = false;
            PropertyGroup contentTab = existing.PropertyGroups.First(group => group.Alias == "content");
            if (contentTab.Type != PropertyGroupType.Tab)
            {
                contentTab.Type = PropertyGroupType.Tab;
                needsUpdate = true;
            }
            if (!existing.PropertyGroups.Any(group => group.Alias == "projection"))
            {
                existing.AddPropertyGroup("projection", "Projection details");
                needsUpdate = true;
            }
            PropertyGroup projectionTab = existing.PropertyGroups.First(group => group.Alias == "projection");
            if (projectionTab.Type != PropertyGroupType.Tab)
            {
                projectionTab.Type = PropertyGroupType.Tab;
                needsUpdate = true;
            }
            if (projectionTab.SortOrder != 1) { projectionTab.SortOrder = 1; needsUpdate = true; }
            for (int index = 0; index < properties.Length; index++)
            {
                (string alias, string name, IDataType dataType, bool mandatory) = properties[index];
                IPropertyType? property = existing.PropertyTypes.FirstOrDefault(candidate => candidate.Alias == alias);
                if (property is null)
                {
                    PropertyType created = new(shortStringHelper, dataType, alias)
                    {
                        Name = name,
                        SortOrder = index,
                        Mandatory = mandatory,
                    };
                    existing.AddPropertyType(
                        created,
                        index < 5 ? "content" : "projection",
                        index < 5 ? "Content" : "Projection details");
                    needsUpdate = true;
                    continue;
                }
                if (property.DataTypeKey != dataType.Key)
                {
                    property.DataTypeId = dataType.Id;
                    property.DataTypeKey = dataType.Key;
                    needsUpdate = true;
                }
                if (property.Name != name) { property.Name = name; needsUpdate = true; }
                int expectedSortOrder = index < 5 ? index : index - 5;
                if (property.SortOrder != expectedSortOrder) { property.SortOrder = expectedSortOrder; needsUpdate = true; }
                if (property.Mandatory != mandatory) { property.Mandatory = mandatory; needsUpdate = true; }
                string expectedGroup = index < 5 ? "content" : "projection";
                if (existing.PropertyGroups.First(group => group.PropertyTypes?.Contains(property) == true).Alias != expectedGroup)
                {
                    existing.MovePropertyType(alias, expectedGroup);
                    needsUpdate = true;
                }
            }
            if (needsUpdate)
                await contentTypeService.UpdateAsync(existing, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
            return existing;
        }

        Guid contentGroupKey = Guid.NewGuid();
        Guid projectionGroupKey = Guid.NewGuid();
        ContentTypeCreateModel model = new()
        {
            Alias = ArticleDocumentTypeAlias,
            Name = "Olavur article",
            Description = "A native Umbraco article editor backed by a canonical Usable fragment.",
            Icon = "icon-notepad",
            AllowedAsRoot = true,
            Containers =
            [
                new ContentTypePropertyContainerModel
                {
                    Key = contentGroupKey,
                    Name = "Content",
                    Type = "Tab",
                    SortOrder = 0,
                },
                new ContentTypePropertyContainerModel
                {
                    Key = projectionGroupKey,
                    Name = "Projection details",
                    Type = "Tab",
                    SortOrder = 1,
                },
            ],
            Properties = properties.Select((property, index) =>
                Property(
                    property.Alias,
                    property.Name,
                    property.DataType.Key,
                    index < 5 ? contentGroupKey : projectionGroupKey,
                    index < 5 ? index : index - 5,
                    property.Mandatory)).ToArray(),
        };
        var attempt = await contentTypeEditingService.CreateAsync(model, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        if (!attempt.Success || attempt.Result is null)
            throw new InvalidOperationException($"Could not create Umbraco article type: {attempt.Status}");
        return attempt.Result;
    }

    private async Task<IContentType> EnsureHomeDocumentTypeAsync(IDataType selectedWorkDataType)
    {
        IDataType textBox = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextBox")).First();
        IDataType textArea = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextArea")).First();
        IDataType structuredContent = await EnsureStructuredContentDataTypeAsync();
        IDataType hiddenManagedValue = await EnsureHiddenManagedValueDataTypeAsync();
        var properties = new (string Alias, string Name, IDataType DataType, bool Mandatory)[]
        {
            (SelectedWorkAlias, "Selected work", selectedWorkDataType, false),
            (PayloadAlias, "Home content and Usable publishing", structuredContent, true),
            (SelectedWorkModeAlias, "Selected Work writer phase", hiddenManagedValue, true),
            (KindAlias, "Sync kind", textBox, true),
            (PageIdAlias, "Page ID", textBox, true),
            (PathAlias, "Public path", textBox, true),
            (PublishedPayloadAlias, "Published Usable payload", textArea, true),
            (DraftRevisionAlias, "Usable draft revision", textBox, false),
            (SourceAlias, "Canonical Usable source", textBox, true),
            (SourceHashAlias, "Published source hash", textBox, true),
        };

        IContentType? existing = contentTypeService.Get(HomeDocumentTypeAlias);
        if (existing is not null)
        {
            bool needsUpdate = false;
            if (!existing.PropertyGroups.Any(group => group.Alias == "content"))
            {
                existing.AddPropertyGroup("content", "Content");
                needsUpdate = true;
            }
            PropertyGroup contentTab = existing.PropertyGroups.First(group => group.Alias == "content");
            if (contentTab.Type != PropertyGroupType.Tab)
            {
                contentTab.Type = PropertyGroupType.Tab;
                needsUpdate = true;
            }
            if (!existing.PropertyGroups.Any(group => group.Alias == "projection"))
            {
                existing.AddPropertyGroup("projection", "Projection details");
                needsUpdate = true;
            }
            PropertyGroup projectionTab = existing.PropertyGroups.First(group => group.Alias == "projection");
            if (projectionTab.Type != PropertyGroupType.Tab)
            {
                projectionTab.Type = PropertyGroupType.Tab;
                needsUpdate = true;
            }
            if (projectionTab.SortOrder != 1) { projectionTab.SortOrder = 1; needsUpdate = true; }

            for (int index = 0; index < properties.Length; index++)
            {
                (string alias, string name, IDataType dataType, bool mandatory) = properties[index];
                IPropertyType? property = existing.PropertyTypes.FirstOrDefault(candidate => candidate.Alias == alias);
                string expectedGroup = index < 2 ? "content" : "projection";
                int expectedSortOrder = index < 2 ? index : index - 2;
                if (property is null)
                {
                    PropertyType created = new(shortStringHelper, dataType, alias)
                    {
                        Name = name,
                        SortOrder = expectedSortOrder,
                        Mandatory = mandatory,
                    };
                    existing.AddPropertyType(
                        created,
                        expectedGroup,
                        expectedGroup == "content" ? "Content" : "Projection details");
                    needsUpdate = true;
                    continue;
                }
                if (property.DataTypeKey != dataType.Key)
                {
                    property.DataTypeId = dataType.Id;
                    property.DataTypeKey = dataType.Key;
                    needsUpdate = true;
                }
                if (property.Name != name) { property.Name = name; needsUpdate = true; }
                if (property.SortOrder != expectedSortOrder)
                {
                    property.SortOrder = expectedSortOrder;
                    needsUpdate = true;
                }
                if (property.Mandatory != mandatory) { property.Mandatory = mandatory; needsUpdate = true; }
                if (existing.PropertyGroups.First(group => group.PropertyTypes?.Contains(property) == true).Alias != expectedGroup)
                {
                    existing.MovePropertyType(alias, expectedGroup);
                    needsUpdate = true;
                }
            }
            if (needsUpdate)
                await contentTypeService.UpdateAsync(existing, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
            return existing;
        }

        Guid contentGroupKey = Guid.NewGuid();
        Guid projectionGroupKey = Guid.NewGuid();
        ContentTypeCreateModel model = new()
        {
            Alias = HomeDocumentTypeAlias,
            Name = "Olavur home page",
            Description = "A native Umbraco home-page editor backed by a canonical Usable fragment.",
            Icon = "icon-home",
            AllowedAsRoot = true,
            Containers =
            [
                new ContentTypePropertyContainerModel
                {
                    Key = contentGroupKey,
                    Name = "Content",
                    Type = "Tab",
                    SortOrder = 0,
                },
                new ContentTypePropertyContainerModel
                {
                    Key = projectionGroupKey,
                    Name = "Projection details",
                    Type = "Tab",
                    SortOrder = 1,
                },
            ],
            Properties = properties.Select((property, index) =>
                Property(
                    property.Alias,
                    property.Name,
                    property.DataType.Key,
                    index < 2 ? contentGroupKey : projectionGroupKey,
                    index < 2 ? index : index - 2,
                    property.Mandatory)).ToArray(),
        };
        var attempt = await contentTypeEditingService.CreateAsync(
            model,
            global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        if (!attempt.Success || attempt.Result is null)
            throw new InvalidOperationException($"Could not create Umbraco home-page type: {attempt.Status}");
        return attempt.Result;
    }

    private async Task<GenericDocumentProjectionSchema> EnsureGenericDocumentTypeAsync()
    {
        IDataType structuredContent = await EnsureStructuredContentDataTypeAsync();
        ArticleBodyProjectionSchema articleBody = await EnsureArticleBodyProjectionAsync();
        IContentType? existing = contentTypeService.Get(DocumentTypeAlias);
        if (existing is not null)
        {
            IPropertyType? payload = existing.PropertyTypes.FirstOrDefault(x => x.Alias == PayloadAlias);
            bool needsUpdate = false;
            if (payload is not null && payload.DataTypeKey != structuredContent.Key)
            {
                payload.DataTypeId = structuredContent.Id;
                payload.DataTypeKey = structuredContent.Key;
                needsUpdate = true;
            }
            if (payload is not null && payload.Name != "Structured content (Usable)")
            {
                payload.Name = "Structured content (Usable)";
                needsUpdate = true;
            }
            IPropertyType? nativeBody = existing.PropertyTypes.FirstOrDefault(x => x.Alias == BodyBlocksAlias);
            if (nativeBody is null)
            {
                PropertyType property = new(shortStringHelper, articleBody.DataType, BodyBlocksAlias)
                {
                    Name = "Article body (native blocks)",
                    Description = "Native Umbraco projection of the canonical Usable bodyBlocks field.",
                    SortOrder = 3,
                };
                existing.AddPropertyType(property, "content", "Content");
                needsUpdate = true;
            }
            else if (nativeBody.DataTypeKey != articleBody.DataType.Key)
            {
                nativeBody.DataTypeId = articleBody.DataType.Id;
                nativeBody.DataTypeKey = articleBody.DataType.Key;
                needsUpdate = true;
            }
            Dictionary<string, int> sortOrders = new(StringComparer.Ordinal)
            {
                [KindAlias] = 0,
                [PageIdAlias] = 1,
                [PathAlias] = 2,
                [BodyBlocksAlias] = 3,
                [PayloadAlias] = 4,
                [SourceAlias] = 5,
                [SourceHashAlias] = 6,
            };
            foreach (IPropertyType property in existing.PropertyTypes)
            {
                if (!sortOrders.TryGetValue(property.Alias, out int sortOrder) || property.SortOrder == sortOrder)
                    continue;
                property.SortOrder = sortOrder;
                needsUpdate = true;
            }
            if (needsUpdate)
            {
                await contentTypeService.UpdateAsync(existing, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
            }
            return new GenericDocumentProjectionSchema(existing, articleBody.ElementKeys);
        }

        IDataType textBox = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextBox")).First();
        Guid groupKey = Guid.NewGuid();
        ContentTypeCreateModel model = new()
        {
            Alias = DocumentTypeAlias,
            Name = "Olavur synchronized document",
            Description = "One neutral-contract document synchronized with Usable CMS.",
            Icon = "icon-documents",
            AllowedAsRoot = true,
            Containers = [new ContentTypePropertyContainerModel
            {
                Key = groupKey,
                Name = "Content",
                Type = "Group",
                SortOrder = 0,
            }],
            Properties =
            [
                Property(KindAlias, "Sync kind", textBox.Key, groupKey, 0, true),
                Property(PageIdAlias, "Page ID", textBox.Key, groupKey, 1, true),
                Property(PathAlias, "Public path", textBox.Key, groupKey, 2, true),
                Property(BodyBlocksAlias, "Article body (native blocks)", articleBody.DataType.Key, groupKey, 3),
                Property(PayloadAlias, "Structured content (Usable)", structuredContent.Key, groupKey, 4, true),
                Property(SourceAlias, "Last sync source", textBox.Key, groupKey, 5),
                Property(SourceHashAlias, "Source hash", textBox.Key, groupKey, 6),
            ],
        };
        var attempt = await contentTypeEditingService.CreateAsync(model, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        if (!attempt.Success || attempt.Result is null)
            throw new InvalidOperationException($"Could not create Umbraco document type: {attempt.Status}");
        return new GenericDocumentProjectionSchema(attempt.Result, articleBody.ElementKeys);
    }

    private async Task<ArticleBodyProjectionSchema> EnsureArticleBodyProjectionAsync()
    {
        IDataType textBox = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextBox")).First();
        IDataType textArea = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextArea")).First();
        IDataType richTextEditor = (await dataTypeService.GetByEditorAliasAsync("Umbraco.RichText")).First();
        IContentType heading = await EnsureElementTypeAsync(
            ArticleBodyBlockAdapter.HeadingElementAlias,
            "Article heading",
            "icon-font",
            [
                ("usableBlockId", "Usable block ID", textBox, true),
                ("headingText", "Heading", textBox, true),
                ("headingLevel", "Heading level (2–4)", textBox, true),
            ]);
        IContentType richText = await EnsureElementTypeAsync(
            ArticleBodyBlockAdapter.RichTextElementAlias,
            "Article text",
            "icon-notepad",
            [
                ("usableBlockId", "Usable block ID", textBox, true),
                ("textMarkdown", "Formatted text", richTextEditor, true),
            ]);
        IContentType list = await EnsureElementTypeAsync(
            ArticleBodyBlockAdapter.ListElementAlias,
            "Article list",
            "icon-bulleted-list",
            [
                ("usableBlockId", "Usable block ID", textBox, true),
                ("listStyle", "List style", textBox, true),
                ("listItems", "List items (one per line)", textArea, true),
            ]);
        IContentType quote = await EnsureElementTypeAsync(
            ArticleBodyBlockAdapter.QuoteElementAlias,
            "Article quote",
            "icon-quote",
            [
                ("usableBlockId", "Usable block ID", textBox, true),
                ("quoteMarkdown", "Quote", textArea, true),
            ]);
        IContentType media = await EnsureElementTypeAsync(
            ArticleBodyBlockAdapter.MediaElementAlias,
            "Usable image",
            "icon-picture",
            [
                ("usableBlockId", "Usable block ID", textBox, false),
                ("assetId", "Usable asset ID", textBox, false),
                ("mediaSource", "Asset URL", textBox, true),
                ("mediaAlt", "Alternative text", textBox, true),
                ("mediaCaption", "Caption", textArea, false),
                ("mediaAlignment", "Alignment", textBox, false),
                ("mediaPlacement", "Placement", textBox, false),
                ("mediaType", "Media type", textBox, false),
            ]);
        await PolishMediaElementTypeAsync(media);

        Dictionary<string, Guid> elementKeys = new(StringComparer.Ordinal)
        {
            [heading.Alias] = heading.Key,
            [richText.Alias] = richText.Key,
            [list.Alias] = list.Key,
            [quote.Alias] = quote.Key,
            [media.Alias] = media.Key,
        };
        const string dataTypeName = "Olavur article body blocks";
        IDataType? dataType = (await dataTypeService.GetByEditorAliasAsync("Umbraco.BlockList"))
            .FirstOrDefault(candidate => candidate.Name == dataTypeName);
        BlockListConfiguration configuration = new()
        {
            Blocks =
            [
                new BlockListConfiguration.BlockConfiguration { ContentElementTypeKey = heading.Key },
                new BlockListConfiguration.BlockConfiguration { ContentElementTypeKey = richText.Key },
                new BlockListConfiguration.BlockConfiguration { ContentElementTypeKey = list.Key },
                new BlockListConfiguration.BlockConfiguration { ContentElementTypeKey = quote.Key },
                new BlockListConfiguration.BlockConfiguration { ContentElementTypeKey = media.Key },
            ],
        };
        if (!propertyEditors.TryGet("Umbraco.BlockList", out IDataEditor? editor) || editor is null)
            throw new InvalidOperationException("Umbraco.BlockList is not registered.");
        IDictionary<string, object> configurationData = editor
            .GetConfigurationEditor()
            .FromConfigurationObject(configuration, configurationEditorJsonSerializer);
        if (dataType is null)
        {
            DataType created = new(editor, configurationEditorJsonSerializer, -1)
            {
                Name = dataTypeName,
                EditorUiAlias = "Umb.PropertyEditorUi.BlockList",
                ConfigurationData = configurationData,
            };
            await dataTypeService.CreateAsync(created, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
            dataType = (await dataTypeService.GetByEditorAliasAsync("Umbraco.BlockList"))
                .First(candidate => candidate.Name == dataTypeName);
        }
        else if (dataType.ConfigurationObject is not BlockListConfiguration current ||
                 current.Blocks.Select(x => x.ContentElementTypeKey).SequenceEqual(configuration.Blocks.Select(x => x.ContentElementTypeKey)) is false)
        {
            dataType.ConfigurationData = configurationData;
            await dataTypeService.UpdateAsync(dataType, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        }
        return new ArticleBodyProjectionSchema(dataType, elementKeys);
    }

    private async Task<SelectedWorkProjectionSchema> EnsureSelectedWorkProjectionAsync()
    {
        IDataType textBox = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextBox")).First();
        IDataType textArea = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextArea")).First();
        IDataType hiddenManagedValue = await EnsureHiddenManagedValueDataTypeAsync();
        IContentType element = await EnsureElementTypeAsync(
            SelectedWorkBlockAdapter.ElementAlias,
            "Selected work item",
            "icon-briefcase",
            [
                ("workName", "Name", textBox, true),
                ("workRole", "Role", textBox, true),
                ("workDescription", "Description", textArea, true),
                ("workHref", "Link", textBox, true),
                ("workAccent", "Accent (coral, blue, green, or yellow)", textBox, true),
                ("workCanonicalId", "Managed identity", hiddenManagedValue, false),
            ]);

        const string dataTypeName = "Olavur selected work";
        IDataType? dataType = (await dataTypeService.GetByEditorAliasAsync("Umbraco.BlockList"))
            .FirstOrDefault(candidate => candidate.Name == dataTypeName);
        BlockListConfiguration configuration = new()
        {
            ValidationLimit = new BlockListConfiguration.NumberRange
            {
                Min = SelectedWorkBlockAdapter.MinItems,
                Max = SelectedWorkBlockAdapter.MaxItems,
            },
            Blocks =
            [
                new BlockListConfiguration.BlockConfiguration
                {
                    ContentElementTypeKey = element.Key,
                },
            ],
        };
        if (!propertyEditors.TryGet("Umbraco.BlockList", out IDataEditor? editor) || editor is null)
            throw new InvalidOperationException("Umbraco.BlockList is not registered.");
        IDictionary<string, object> configurationData = editor
            .GetConfigurationEditor()
            .FromConfigurationObject(configuration, configurationEditorJsonSerializer);
        if (dataType is null)
        {
            DataType created = new(editor, configurationEditorJsonSerializer, -1)
            {
                Name = dataTypeName,
                EditorUiAlias = "Umb.PropertyEditorUi.BlockList",
                ConfigurationData = configurationData,
            };
            await dataTypeService.CreateAsync(created, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
            dataType = (await dataTypeService.GetByEditorAliasAsync("Umbraco.BlockList"))
                .First(candidate => candidate.Name == dataTypeName);
        }
        else if (dataType.ConfigurationObject is not BlockListConfiguration current ||
                 current.Blocks.Select(x => x.ContentElementTypeKey)
                     .SequenceEqual(configuration.Blocks.Select(x => x.ContentElementTypeKey)) is false ||
                 current.ValidationLimit?.Min != configuration.ValidationLimit.Min ||
                 current.ValidationLimit?.Max != configuration.ValidationLimit.Max)
        {
            dataType.ConfigurationData = configurationData;
            await dataTypeService.UpdateAsync(dataType, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        }
        return new SelectedWorkProjectionSchema(dataType, element.Key);
    }

    private async Task PolishMediaElementTypeAsync(IContentType media)
    {
        bool needsUpdate = false;
        PropertyGroup contentTab = media.PropertyGroups.First(group => group.Alias == "content");
        if (contentTab.Type != PropertyGroupType.Tab)
        {
            contentTab.Type = PropertyGroupType.Tab;
            needsUpdate = true;
        }
        if (!media.PropertyGroups.Any(group => group.Alias == "projection"))
        {
            media.AddPropertyGroup("projection", "Usable reference");
            needsUpdate = true;
        }
        PropertyGroup projectionTab = media.PropertyGroups.First(group => group.Alias == "projection");
        if (projectionTab.Type != PropertyGroupType.Tab)
        {
            projectionTab.Type = PropertyGroupType.Tab;
            needsUpdate = true;
        }
        if (projectionTab.SortOrder != 1) { projectionTab.SortOrder = 1; needsUpdate = true; }

        string[] technical = ["usableBlockId", "assetId", "mediaType", "mediaPlacement"];
        foreach (string alias in technical)
        {
            IPropertyType? property = media.PropertyTypes.FirstOrDefault(candidate => candidate.Alias == alias);
            if (property is null) continue;
            string currentGroup = media.PropertyGroups
                .First(group => group.PropertyTypes?.Contains(property) == true).Alias;
            if (currentGroup == "projection") continue;
            media.MovePropertyType(alias, "projection");
            needsUpdate = true;
        }

        Dictionary<string, (string Name, string Description)> editorial = new(StringComparer.Ordinal)
        {
            ["mediaSource"] = ("Usable asset URL", "Paste an existing Usable Assets URL. The custom asset browser will replace this field when its API is available."),
            ["mediaAlt"] = ("Alternative text", "Describe the image for people who cannot see it."),
            ["mediaCaption"] = ("Caption", "Optional caption displayed with the image."),
            ["mediaAlignment"] = ("Alignment", "Use center, wide, left, or right."),
        };
        foreach ((string alias, (string name, string description)) in editorial)
        {
            IPropertyType? property = media.PropertyTypes.FirstOrDefault(candidate => candidate.Alias == alias);
            if (property is null) continue;
            if (property.Name != name) { property.Name = name; needsUpdate = true; }
            if (property.Description != description) { property.Description = description; needsUpdate = true; }
        }

        if (needsUpdate)
            await contentTypeService.UpdateAsync(media, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
    }

    private async Task<IContentType> EnsureElementTypeAsync(
        string alias,
        string name,
        string icon,
        IReadOnlyList<(string Alias, string Name, IDataType DataType, bool Mandatory)> properties)
    {
        IContentType? existing = contentTypeService.Get(alias);
        if (existing is not null)
        {
            bool needsUpdate = false;
            for (int index = 0; index < properties.Count; index++)
            {
                (string propertyAlias, string propertyName, IDataType dataType, bool mandatory) = properties[index];
                IPropertyType? property = existing.PropertyTypes.FirstOrDefault(candidate => candidate.Alias == propertyAlias);
                if (property is null)
                {
                    PropertyType created = new(shortStringHelper, dataType, propertyAlias)
                    {
                        Name = propertyName,
                        SortOrder = index,
                        Mandatory = mandatory,
                    };
                    existing.AddPropertyType(created, "content", "Content");
                    needsUpdate = true;
                    continue;
                }
                if (property.DataTypeKey != dataType.Key)
                {
                    property.DataTypeId = dataType.Id;
                    property.DataTypeKey = dataType.Key;
                    needsUpdate = true;
                }
                if (property.Name != propertyName)
                {
                    property.Name = propertyName;
                    needsUpdate = true;
                }
                if (property.SortOrder != index)
                {
                    property.SortOrder = index;
                    needsUpdate = true;
                }
                if (property.Mandatory != mandatory)
                {
                    property.Mandatory = mandatory;
                    needsUpdate = true;
                }
            }
            if (needsUpdate)
                await contentTypeService.UpdateAsync(existing, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
            return existing;
        }
        Guid groupKey = Guid.NewGuid();
        ContentTypeCreateModel model = new()
        {
            Alias = alias,
            Name = name,
            Description = "Structured content block projected from a canonical Usable fragment.",
            Icon = icon,
            IsElement = true,
            AllowedAsRoot = false,
            Containers = [new ContentTypePropertyContainerModel
            {
                Key = groupKey,
                Name = "Content",
                Type = "Group",
                SortOrder = 0,
            }],
            Properties = properties.Select((property, index) =>
                Property(property.Alias, property.Name, property.DataType.Key, groupKey, index, property.Mandatory)).ToArray(),
        };
        var attempt = await contentTypeEditingService.CreateAsync(model, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        if (!attempt.Success || attempt.Result is null)
            throw new InvalidOperationException($"Could not create Umbraco element type '{alias}': {attempt.Status}");
        return attempt.Result;
    }

    private async Task<IDataType> EnsureStructuredContentDataTypeAsync()
    {
        IDataType? existing = (await dataTypeService.GetByEditorUiAlias(StructuredEditorUiAlias)).FirstOrDefault();
        if (existing is not null) return existing;

        IDataType textArea = (await dataTypeService.GetByEditorAliasAsync("Umbraco.TextArea")).First();
        DataType dataType = new(textArea.Editor, configurationEditorJsonSerializer, -1)
        {
            Name = "Olavur structured content",
            EditorUiAlias = StructuredEditorUiAlias,
        };
        await dataTypeService.CreateAsync(dataType, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        return (await dataTypeService.GetByEditorUiAlias(StructuredEditorUiAlias)).FirstOrDefault()
            ?? throw new InvalidOperationException("Could not create the structured content data type.");
    }

    private async Task<IDataType> EnsureHiddenManagedValueDataTypeAsync()
    {
        IDataType? existing = (await dataTypeService.GetByEditorUiAlias(HiddenManagedEditorUiAlias)).FirstOrDefault();
        if (existing is not null) return existing;

        IDataType label = (await dataTypeService.GetByEditorAliasAsync("Umbraco.Label")).First();
        DataType dataType = new(label.Editor, configurationEditorJsonSerializer, -1)
        {
            Name = "Olavur hidden managed value",
            EditorUiAlias = HiddenManagedEditorUiAlias,
        };
        await dataTypeService.CreateAsync(dataType, global::Umbraco.Cms.Core.Constants.Security.SuperUserKey);
        return (await dataTypeService.GetByEditorUiAlias(HiddenManagedEditorUiAlias)).FirstOrDefault()
            ?? throw new InvalidOperationException("Could not create the hidden managed value data type.");
    }

    private List<IContent> Documents()
    {
        List<IContent> documents = [];
        foreach (string alias in new[] { DocumentTypeAlias, HomeDocumentTypeAlias, ArticleDocumentTypeAlias })
        {
            IContentType? type = contentTypeService.Get(alias);
            if (type is null) continue;
            long total;
            documents.AddRange(contentService.GetPagedOfType(type.Id, 0, 1000, out total, null!)
                .Where(document => !document.Trashed));
        }
        return documents;
    }

    private static ContentTypePropertyTypeModel Property(
        string alias, string name, Guid dataTypeKey, Guid containerKey, int sortOrder, bool mandatory = false) => new()
        {
            Key = Guid.NewGuid(),
            Alias = alias,
            Name = name,
            DataTypeKey = dataTypeKey,
            ContainerKey = containerKey,
            SortOrder = sortOrder,
            Validation = new PropertyTypeValidation { Mandatory = mandatory },
        };

    internal static string DocumentKey(IContent content) => $"{Value(content, KindAlias)}:{Value(content, PageIdAlias)}";
    internal static string Value(IContent content, string alias) => content.GetValue<string>(alias) ?? string.Empty;
    internal static JsonObject ParseObject(string value) => JsonNode.Parse(value) as JsonObject ?? new JsonObject();
    internal static JsonObject CanonicalContent(IContent content)
    {
        JsonObject payload = ParseObject(Value(content, PayloadAlias));
        return Value(content, KindAlias) == "page"
            ? payload["content"] as JsonObject ?? new JsonObject()
            : payload;
    }
    internal static string Hash<T>(T value)
    {
        string json = JsonSerializer.Serialize(value, JsonOptions);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }
    internal static string CanonicalSource(string workspaceId, string fragmentId) =>
        $"usable:{workspaceId}:{fragmentId}";

    internal static bool TryCanonicalSource(string source, out string workspaceId, out string fragmentId)
    {
        workspaceId = string.Empty;
        fragmentId = string.Empty;
        string[] parts = source.Split(':', 3, StringSplitOptions.TrimEntries);
        if (parts.Length != 3 || parts[0] != "usable" ||
            !Guid.TryParse(parts[1], out _) || !Guid.TryParse(parts[2], out _))
            return false;
        workspaceId = parts[1];
        fragmentId = parts[2];
        return true;
    }
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private sealed record ArticleBodyProjectionSchema(
        IDataType DataType,
        IReadOnlyDictionary<string, Guid> ElementKeys);

    private sealed record SelectedWorkProjectionSchema(
        IDataType DataType,
        Guid ElementKey);

    private sealed record GenericDocumentProjectionSchema(
        IContentType DocumentType,
        IReadOnlyDictionary<string, Guid> ElementKeys);

    private sealed record DocumentProjectionSchema(
        IContentType GenericType,
        IContentType HomeType,
        IContentType ArticleType,
        Guid MediaElementKey,
        Guid SelectedWorkElementKey);
}
