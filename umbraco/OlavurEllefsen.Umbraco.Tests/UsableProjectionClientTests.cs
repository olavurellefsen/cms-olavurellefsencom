using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using OlavurEllefsen.Umbraco.Sync;
using Xunit;

namespace OlavurEllefsen.Umbraco.Tests;

public sealed class UsableProjectionClientTests
{
    [Fact]
    public async Task VerifyPublishedAcceptsContentAlreadyPublishedInUsable()
    {
        JsonObject candidate = JsonNode.Parse("{\"title\":\"Published\"}")!.AsObject();
        List<HttpMethod> methods = [];
        StubHandler handler = new(request =>
        {
            methods.Add(request.Method);
            return Task.FromResult(Fragment(candidate));
        });
        UsableProjectionClient client = CreateClient(handler);

        string result = await client.VerifyPublishedAsync(
            Guid.NewGuid().ToString(),
            candidate,
            OlavurSyncService.Hash(JsonNode.Parse("{\"title\":\"Old\"}")!.AsObject()),
            CancellationToken.None);

        Assert.Equal(OlavurSyncService.Hash(candidate), result);
        Assert.Equal([HttpMethod.Get], methods);
    }

    [Fact]
    public async Task VerifyPublishedRejectsAStaleProjection()
    {
        JsonObject canonical = JsonNode.Parse("{\"title\":\"Changed in Usable\"}")!.AsObject();
        List<HttpMethod> methods = [];
        StubHandler handler = new(request =>
        {
            methods.Add(request.Method);
            return Task.FromResult(Fragment(canonical));
        });
        UsableProjectionClient client = CreateClient(handler);

        await Assert.ThrowsAsync<UsableProjectionConflictException>(() => client.VerifyPublishedAsync(
            Guid.NewGuid().ToString(),
            JsonNode.Parse("{\"title\":\"Changed in Umbraco\"}")!.AsObject(),
            OlavurSyncService.Hash(JsonNode.Parse("{\"title\":\"Old\"}")!.AsObject()),
            CancellationToken.None));

        Assert.Equal([HttpMethod.Get], methods);
    }

    [Fact]
    public async Task VerifyPublishedRequiresUsableDraftAndPublishWhenCanonicalIsUnchanged()
    {
        JsonObject canonical = JsonNode.Parse("{\"title\":\"Old\"}")!.AsObject();
        UsableProjectionClient client = CreateClient(new StubHandler(_ =>
            Task.FromResult(Fragment(canonical))));

        await Assert.ThrowsAsync<UsableProjectionDraftRequiredException>(() => client.VerifyPublishedAsync(
            Guid.NewGuid().ToString(),
            JsonNode.Parse("{\"title\":\"Draft\"}")!.AsObject(),
            OlavurSyncService.Hash(canonical),
            CancellationToken.None));
    }

    [Fact]
    public void FragmentParserAcceptsFrontmatterAndFencedJson()
    {
        JsonObject? parsed = UsableProjectionClient.ParseFragmentContent(
            "---\nkind: cms-page\n---\n```json\n{\"type\":\"article\"}\n```");

        Assert.Equal("article", parsed?["type"]?.GetValue<string>());
    }

    [Fact]
    public void EditPolicyAllowsDeclaredArticleFieldsAndRejectsIdentityFields()
    {
        JsonObject current = JsonNode.Parse(
            "{\"type\":\"article\",\"title\":\"Old\",\"slug\":\"stable\",\"topics\":[\"AI\"]}")!.AsObject();
        JsonObject allowed = current.DeepClone().AsObject();
        allowed["title"] = "New";
        JsonObject rejected = allowed.DeepClone().AsObject();
        rejected["slug"] = "changed";

        Assert.Empty(ProjectionEditPolicy.DisallowedChanges("page", "article-runtime", current, allowed));
        Assert.Equal(
            ["slug"],
            ProjectionEditPolicy.DisallowedChanges("page", "article-runtime", current, rejected));
    }

    [Fact]
    public void EditPolicyAllowsDeclaredCollectionsButRejectsUndeclaredGlobalFields()
    {
        JsonObject home = JsonNode.Parse(
            "{\"type\":\"home\",\"selectedWork\":[{\"name\":\"One\",\"role\":\"Role\"}]}")!.AsObject();
        JsonObject changedHome = home.DeepClone().AsObject();
        changedHome["selectedWork"]![0]!["name"] = "Two";
        JsonObject global = JsonNode.Parse(
            "{\"siteName\":\"Site\",\"author\":{\"email\":\"one@example.com\"}}")!.AsObject();
        JsonObject changedGlobal = global.DeepClone().AsObject();
        changedGlobal["author"]!["email"] = "two@example.com";

        Assert.Empty(ProjectionEditPolicy.DisallowedChanges("page", "home", home, changedHome));
        Assert.Equal(
            ["author.email"],
            ProjectionEditPolicy.DisallowedChanges("global", "global", global, changedGlobal));
    }

    [Fact]
    public void LegacyMarkdownProjectsToStablePortableArticleBlocks()
    {
        const string markdown = "## Introduction\n\nA **formatted** paragraph.\n\n- One\n- Two";

        JsonObject first = ArticleBodyBlockAdapter.FromMarkdown(markdown);
        JsonObject second = ArticleBodyBlockAdapter.FromMarkdown(markdown);

        Assert.True(JsonNode.DeepEquals(first, second));
        Assert.Equal(1, first["version"]?.GetValue<int>());
        Assert.Equal(
            ["heading", "richText"],
            first["blocks"]!.AsArray().Select(block => block!["type"]!.GetValue<string>()).ToArray());
    }

    [Fact]
    public void PortableArticleBlocksRoundTripThroughOneNativeRichTextValue()
    {
        JsonObject content = JsonNode.Parse("""
        {
          "bodyBlocks": {
            "version": 1,
            "blocks": [
              { "id": "heading-one", "type": "heading", "level": 2, "text": "A heading" },
              { "id": "text-one", "type": "richText", "markdown": "A **formatted** paragraph." },
              { "id": "list-one", "type": "list", "style": "unordered", "items": ["One", "Two"] },
              {
                "id": "image-one",
                "type": "media",
                "media": {
                  "id": "asset-one", "type": "image", "src": "https://assets.example/image.webp",
                  "alt": "An example", "caption": "A caption", "placement": "inline", "alignment": "wide"
                }
              }
            ]
          }
        }
        """)!.AsObject();
        ArticleRichTextAdapter adapter = new();

        string projected = adapter.Project(content, Guid.NewGuid());
        JsonObject? roundTripped = adapter.ToCanonical(projected);
        string markup = JsonNode.Parse(projected)!["markup"]!.GetValue<string>();

        Assert.True(JsonNode.DeepEquals(content["bodyBlocks"], roundTripped));
        Assert.Contains("<umb-rte-block data-content-key=", markup);
        Assert.Contains("data-usable-block-id", markup);
    }

    [Fact]
    public void EditPolicyAllowsCanonicalBodyBlocksButStillRejectsArticleIdentityChanges()
    {
        JsonObject current = JsonNode.Parse(
            "{\"type\":\"article\",\"slug\":\"stable\",\"bodyMarkdown\":\"Old\"}")!.AsObject();
        JsonObject candidate = current.DeepClone().AsObject();
        candidate["bodyBlocks"] = ArticleBodyBlockAdapter.FromMarkdown("New");

        Assert.Empty(ProjectionEditPolicy.DisallowedChanges("page", "article-runtime", current, candidate));
        candidate["slug"] = "changed";
        Assert.Equal(
            ["slug"],
            ProjectionEditPolicy.DisallowedChanges("page", "article-runtime", current, candidate));
    }

    [Fact]
    public void EditPolicyMatchesStableCollectionsByIdInsteadOfOrdinal()
    {
        JsonObject currentHome = JsonNode.Parse("""
        {
          "type": "home",
          "selectedWork": [
            { "$id": "11111111-1111-4111-8111-111111111111", "name": "One" },
            { "$id": "22222222-2222-4222-8222-222222222222", "name": "Two" }
          ]
        }
        """)!.AsObject();
        JsonObject reorderedHome = currentHome.DeepClone().AsObject();
        JsonArray reorderedWork = reorderedHome["selectedWork"]!.AsArray();
        JsonNode? first = reorderedWork[0];
        reorderedWork.RemoveAt(0);
        reorderedWork.Add(first);
        reorderedWork[1]!["name"] = "One edited";

        Assert.Empty(ProjectionEditPolicy.DisallowedChanges(
            "page", "home", currentHome, reorderedHome));

        JsonObject replacedIdentity = reorderedHome.DeepClone().AsObject();
        replacedIdentity["selectedWork"]![0]!["$id"] =
            "33333333-3333-4333-8333-333333333333";
        Assert.Contains("selectedWork.*.$id", ProjectionEditPolicy.DisallowedChanges(
            "page", "home", reorderedHome, replacedIdentity));

        JsonObject currentArticle = JsonNode.Parse("""
        {
          "type": "article",
          "topics": [
            { "$id": "11111111-1111-4111-8111-111111111111", "$value": "Usable" },
            { "$id": "22222222-2222-4222-8222-222222222222", "$value": "Umbraco" }
          ]
        }
        """)!.AsObject();
        JsonObject editedArticle = currentArticle.DeepClone().AsObject();
        editedArticle["topics"]![0]!["$value"] = "CMS";
        Assert.Empty(ProjectionEditPolicy.DisallowedChanges(
            "page", "article-one", currentArticle, editedArticle));
    }

    [Fact]
    public void EditPolicyRejectsIdentityTamperingAlongsideAnAddition()
    {
        JsonObject current = JsonNode.Parse("""
        {
          "type": "home",
          "selectedWork": [
            { "$id": "11111111-1111-4111-8111-111111111111", "name": "One" },
            { "$id": "22222222-2222-4222-8222-222222222222", "name": "Two" },
            { "$id": "33333333-3333-4333-8333-333333333333", "name": "Three" }
          ]
        }
        """)!.AsObject();

        JsonObject addAndTamper = current.DeepClone().AsObject();
        addAndTamper["selectedWork"]![0]!["$id"] =
            "44444444-4444-4444-8444-444444444444";
        addAndTamper["selectedWork"]!.AsArray().Add(JsonNode.Parse(
            """{ "$id": "55555555-5555-4555-8555-555555555555", "name": "Five" }"""));
        Assert.Contains("selectedWork.*.$id", ProjectionEditPolicy.DisallowedChanges(
            "page", "home", current, addAndTamper));
    }

    [Fact]
    public void EditPolicyRejectsIdentityTamperingAlongsideARemoval()
    {
        JsonObject current = JsonNode.Parse("""
        {
          "type": "home",
          "selectedWork": [
            { "$id": "11111111-1111-4111-8111-111111111111", "name": "One" },
            { "$id": "22222222-2222-4222-8222-222222222222", "name": "Two" },
            { "$id": "33333333-3333-4333-8333-333333333333", "name": "Three" }
          ]
        }
        """)!.AsObject();
        JsonObject removeAndTamper = current.DeepClone().AsObject();
        removeAndTamper["selectedWork"]!.AsArray().RemoveAt(2);
        removeAndTamper["selectedWork"]![0]!["$id"] =
            "44444444-4444-4444-8444-444444444444";
        Assert.Contains("selectedWork.*.$id", ProjectionEditPolicy.DisallowedChanges(
            "page", "home", current, removeAndTamper));
    }

    [Fact]
    public void EditPolicyAllowsRemovingAndAddingDistinctStableItemsInOneSave()
    {
        JsonObject current = JsonNode.Parse("""
        {
          "type": "home",
          "selectedWork": [
            { "$id": "11111111-1111-4111-8111-111111111111", "name": "One" },
            { "$id": "22222222-2222-4222-8222-222222222222", "name": "Two" }
          ]
        }
        """)!.AsObject();
        JsonObject candidate = JsonNode.Parse("""
        {
          "type": "home",
          "selectedWork": [
            { "$id": "22222222-2222-4222-8222-222222222222", "name": "Two edited" },
            { "$id": "33333333-3333-4333-8333-333333333333", "name": "Three" }
          ]
        }
        """)!.AsObject();

        Assert.Empty(ProjectionEditPolicy.DisallowedChanges("page", "home", current, candidate));
    }

    [Fact]
    public async Task CutoverUsesManagedIdsOnlyForExactDurableStableWriterTuple()
    {
        HttpRequestMessage? captured = null;
        StubHandler handler = new(request =>
        {
            captured = request;
            return Task.FromResult(Json(HttpStatusCode.OK, """
            {
              "siteId": "42782a7c-6918-4e84-b08b-cc3c859621ab",
              "collectionId": "home.selectedWork",
              "phase": "stable",
              "writer": "canonical-workflow"
            }
            """));
        });
        UsableProjectionClient client = CreateCutoverClient(handler);

        SelectedWorkProjectionKeyMode result = await client.GetSelectedWorkProjectionKeyModeAsync(
            SelectedWorkBlockAdapter.SchemaPlanFingerprint,
            CancellationToken.None);

        Assert.Equal(SelectedWorkProjectionKeyMode.ManagedV2, result);
        Assert.Equal(HttpMethod.Get, captured?.Method);
        Assert.Null(captured?.Headers.Authorization);
        Assert.Equal(
            "ucmsa1.test-adapter-credential",
            captured?.Headers.GetValues("x-usable-cms-adapter-credential").Single());
        Assert.Equal(
            SelectedWorkBlockAdapter.SchemaPlanFingerprint,
            captured?.Headers.GetValues("x-usable-cms-schema-plan-fingerprint").Single());
        Assert.EndsWith(
            "/api/adapters/umbraco/v1/sites/42782a7c-6918-4e84-b08b-cc3c859621ab/collection-cutovers/home.selectedWork",
            captured?.RequestUri?.AbsoluteUri);
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, "{}")]
    [InlineData(HttpStatusCode.OK, "{\"phase\":\"stable\",\"writer\":\"canonical-workflow\"}")]
    [InlineData(HttpStatusCode.OK, "{\"siteId\":\"42782a7c-6918-4e84-b08b-cc3c859621ab\",\"collectionId\":\"home.selectedWork\",\"phase\":\"compatibility\",\"writer\":\"legacy-bridge\"}")]
    public async Task CutoverFailsClosedUnlessTheCompleteTupleIsStable(
        HttpStatusCode status,
        string response)
    {
        UsableProjectionClient client = CreateCutoverClient(new StubHandler(_ =>
            Task.FromResult(Json(status, response))));

        SelectedWorkProjectionKeyMode result = await client.GetSelectedWorkProjectionKeyModeAsync(
            SelectedWorkBlockAdapter.SchemaPlanFingerprint,
            CancellationToken.None);

        Assert.Equal(SelectedWorkProjectionKeyMode.LegacyShadow, result);
    }

    [Fact]
    public async Task AuthoritativeSaveAcceptsOnlyAFreshlyVerifiedMatchingCompatibilityPhase()
    {
        UsableProjectionClient client = CreateCutoverClient(new StubHandler(_ =>
            Task.FromResult(Json(HttpStatusCode.OK, """
            {
              "siteId": "42782a7c-6918-4e84-b08b-cc3c859621ab",
              "collectionId": "home.selectedWork",
              "phase": "compatibility",
              "writer": "legacy-bridge"
            }
            """))));

        await client.RequireSelectedWorkProjectionKeyModeAsync(
            SelectedWorkProjectionKeyMode.LegacyShadow,
            SelectedWorkBlockAdapter.SchemaPlanFingerprint,
            CancellationToken.None);
        UsableProjectionException changed = await Assert.ThrowsAsync<UsableProjectionException>(() =>
            client.RequireSelectedWorkProjectionKeyModeAsync(
                SelectedWorkProjectionKeyMode.ManagedV2,
                SelectedWorkBlockAdapter.SchemaPlanFingerprint,
                CancellationToken.None));

        Assert.Contains("phase changed", changed.Message);
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, "{}")]
    [InlineData(HttpStatusCode.OK, "{\"phase\":\"compatibility\",\"writer\":\"legacy-bridge\"}")]
    public async Task AuthoritativeSaveRejectsWhenDurablePhaseCannotBeVerified(
        HttpStatusCode status,
        string response)
    {
        UsableProjectionClient client = CreateCutoverClient(new StubHandler(_ =>
            Task.FromResult(Json(status, response))));

        UsableProjectionException unavailable = await Assert.ThrowsAsync<UsableProjectionException>(() =>
            client.RequireSelectedWorkProjectionKeyModeAsync(
                SelectedWorkProjectionKeyMode.LegacyShadow,
                SelectedWorkBlockAdapter.SchemaPlanFingerprint,
                CancellationToken.None));

        Assert.Contains("could not be verified", unavailable.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ucms1.public-browser-credential")]
    [InlineData("ucmsa1.")]
    public async Task CutoverNeverReusesAnUnprovisionedOrPublicSiteCredential(
        string? adapterCredential)
    {
        int requests = 0;
        IConfiguration configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["UsableIdentity:CmsOrigin"] = "https://cms.usable.test",
                ["UsableIdentity:SiteId"] = "42782a7c-6918-4e84-b08b-cc3c859621ab",
                ["UsableIdentity:SiteCredential"] = "ucms1.public-browser-credential",
                ["UsableProjection:AdapterCredential"] = adapterCredential,
            })
            .Build();
        UsableProjectionClient client = new(new HttpClient(new StubHandler(_ =>
        {
            requests++;
            return Task.FromResult(Json(HttpStatusCode.OK, "{}"));
        })), configuration);

        SelectedWorkProjectionKeyMode result = await client.GetSelectedWorkProjectionKeyModeAsync(
            SelectedWorkBlockAdapter.SchemaPlanFingerprint,
            CancellationToken.None);

        Assert.Equal(SelectedWorkProjectionKeyMode.LegacyShadow, result);
        Assert.Equal(0, requests);
    }

    private static UsableProjectionClient CreateClient(HttpMessageHandler handler)
    {
        IConfiguration configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["UsableProjection:ApiBaseUrl"] = "https://usable.test",
                ["UsableProjection:ServerToken"] = "test-token",
            })
            .Build();
        return new UsableProjectionClient(new HttpClient(handler), configuration);
    }

    private static UsableProjectionClient CreateCutoverClient(HttpMessageHandler handler)
    {
        IConfiguration configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["UsableIdentity:CmsOrigin"] = "https://cms.usable.test",
                ["UsableIdentity:SiteId"] = "42782a7c-6918-4e84-b08b-cc3c859621ab",
                ["UsableIdentity:SiteCredential"] = "ucms1.public-browser-credential",
                ["UsableProjection:AdapterCredential"] = "ucmsa1.test-adapter-credential",
            })
            .Build();
        return new UsableProjectionClient(new HttpClient(handler), configuration);
    }

    private static HttpResponseMessage Fragment(JsonObject content) => Json(
        HttpStatusCode.OK,
        new JsonObject
        {
            ["fragment"] = new JsonObject { ["content"] = content.ToJsonString() },
        }.ToJsonString());

    private static HttpResponseMessage Json(HttpStatusCode status, string json) => new(status)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };

    private sealed class StubHandler(
        Func<HttpRequestMessage, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => response(request);
    }
}
