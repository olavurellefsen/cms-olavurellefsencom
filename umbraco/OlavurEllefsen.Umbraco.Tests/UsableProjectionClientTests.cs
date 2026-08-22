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
