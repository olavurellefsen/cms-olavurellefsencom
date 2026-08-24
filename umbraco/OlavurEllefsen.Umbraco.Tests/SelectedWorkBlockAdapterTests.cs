using System.Text.Json.Nodes;
using OlavurEllefsen.Umbraco.Sync;
using Xunit;

namespace OlavurEllefsen.Umbraco.Tests;

public sealed class SelectedWorkBlockAdapterTests
{
    [Fact]
    public void SelectedWorkRoundTripsThroughNativeBlockList()
    {
        JsonObject content = Content();
        SelectedWorkBlockAdapter adapter = new();

        string projected = adapter.Project(content, Guid.NewGuid(), SelectedWorkProjectionKeyMode.LegacyShadow);
        JsonArray? roundTripped = adapter.ToCanonical(projected, SelectedWorkProjectionKeyMode.LegacyShadow);

        Assert.True(JsonNode.DeepEquals(content["selectedWork"], roundTripped));
        Assert.True(adapter.MatchesCanonical(content, projected, SelectedWorkProjectionKeyMode.LegacyShadow));
    }

    [Fact]
    public void NativeLayoutControlsOrderAndSupportsDeletion()
    {
        SelectedWorkBlockAdapter adapter = new();
        JsonObject native = JsonNode.Parse(adapter.Project(
            Content(), Guid.NewGuid(), SelectedWorkProjectionKeyMode.LegacyShadow))!.AsObject();
        JsonArray layout = native["layout"]!["Umbraco.BlockList"]!.AsArray();
        JsonNode? first = layout[0];
        layout.RemoveAt(0);
        layout.Add(first);

        JsonArray? reordered = adapter.ToCanonical(
            native.ToJsonString(), SelectedWorkProjectionKeyMode.LegacyShadow);
        Assert.Equal(["Two", "One"], reordered!.Select(item => item!["name"]!.GetValue<string>()).ToArray());

        layout.RemoveAt(1);
        JsonArray? deleted = adapter.ToCanonical(
            native.ToJsonString(), SelectedWorkProjectionKeyMode.LegacyShadow);
        Assert.Equal(["Two"], deleted!.Select(item => item!["name"]!.GetValue<string>()).ToArray());
    }

    [Fact]
    public void ManagedV2UsesCanonicalIdsWithoutEditOrOrdinalChurn()
    {
        JsonObject content = Content();
        JsonArray items = content["selectedWork"]!.AsArray();
        items[0]!["$id"] = "11111111-1111-4111-8111-111111111111";
        items[1]!["$id"] = "22222222-2222-4222-8222-222222222222";
        SelectedWorkBlockAdapter adapter = new();

        JsonObject projected = JsonNode.Parse(adapter.Project(
            content, Guid.NewGuid(), SelectedWorkProjectionKeyMode.ManagedV2))!.AsObject();
        JsonArray layout = projected["layout"]!["Umbraco.BlockList"]!.AsArray();
        JsonNode? first = layout[0];
        layout.RemoveAt(0);
        layout.Add(first);
        JsonObject firstContent = projected["contentData"]!.AsArray()[0]!.AsObject();
        JsonObject name = firstContent["values"]!.AsArray()
            .OfType<JsonObject>().Single(value => value["alias"]!.GetValue<string>() == "workName");
        JsonObject canonicalId = firstContent["values"]!.AsArray()
            .OfType<JsonObject>().Single(value => value["alias"]!.GetValue<string>() == "workCanonicalId");
        name["value"] = "Edited";

        JsonArray? canonical = adapter.ToCanonical(
            projected.ToJsonString(), SelectedWorkProjectionKeyMode.ManagedV2);

        Assert.Equal(
            ["22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111"],
            canonical!.Select(item => item!["$id"]!.GetValue<string>()).ToArray());
        Assert.Equal(["Two", "Edited"], canonical!.Select(item => item!["name"]!.GetValue<string>()).ToArray());
        Assert.Equal(
            "11111111-1111-4111-8111-111111111111",
            firstContent["key"]!.GetValue<Guid>().ToString());
        Assert.Equal(
            "11111111-1111-4111-8111-111111111111",
            canonicalId["value"]!.GetValue<string>());
    }

    [Fact]
    public void ManagedV2RejectsItemsWithoutCanonicalIds()
    {
        SelectedWorkBlockAdapter adapter = new();
        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => adapter.Project(
            Content(), Guid.NewGuid(), SelectedWorkProjectionKeyMode.ManagedV2));
        Assert.Contains("UUID $id", error.Message);
    }

    [Fact]
    public void LegacyShadowRejectsCanonicalMetadataTampering()
    {
        JsonObject content = Content();
        content["selectedWork"]![0]!["$id"] = "11111111-1111-4111-8111-111111111111";
        content["selectedWork"]![1]!["$id"] = "22222222-2222-4222-8222-222222222222";
        SelectedWorkBlockAdapter adapter = new();
        JsonObject projected = JsonNode.Parse(adapter.Project(
            content, Guid.NewGuid(), SelectedWorkProjectionKeyMode.LegacyShadow))!.AsObject();

        Assert.True(adapter.MatchesCanonical(
            content, projected.ToJsonString(), SelectedWorkProjectionKeyMode.LegacyShadow));
        JsonObject metadata = projected["contentData"]![0]!["values"]!.AsArray()
            .OfType<JsonObject>().Single(value => value["alias"]!.GetValue<string>() == "workCanonicalId");
        Assert.Equal("Umbraco.Label", metadata["editorAlias"]!.GetValue<string>());
        metadata["value"] = "33333333-3333-4333-8333-333333333333";

        Assert.False(adapter.MatchesCanonical(
            content, projected.ToJsonString(), SelectedWorkProjectionKeyMode.LegacyShadow));
    }

    [Fact]
    public void LegacyShadowRejectsPartiallyManagedCanonicalIdentity()
    {
        JsonObject content = Content();
        content["selectedWork"]![0]!["$id"] = "11111111-1111-4111-8111-111111111111";
        SelectedWorkBlockAdapter adapter = new();
        string projected = adapter.Project(
            content, Guid.NewGuid(), SelectedWorkProjectionKeyMode.LegacyShadow);

        Assert.False(adapter.MatchesCanonical(
            content, projected, SelectedWorkProjectionKeyMode.LegacyShadow));
    }

    [Fact]
    public void LegacyShadowRejectsEditWhenPersistedBlockLosesCanonicalIdentity()
    {
        JsonObject content = ManagedContent();
        SelectedWorkBlockAdapter adapter = new();
        string baseline = adapter.Project(
            content, Guid.NewGuid(), SelectedWorkProjectionKeyMode.LegacyShadow);
        JsonObject candidate = JsonNode.Parse(baseline)!.AsObject();
        JsonObject second = candidate["contentData"]![1]!.AsObject();
        JsonArray values = second["values"]!.AsArray();
        values.Remove(values.OfType<JsonObject>()
            .Single(value => value["alias"]!.GetValue<string>() == "workCanonicalId"));
        values.OfType<JsonObject>()
            .Single(value => value["alias"]!.GetValue<string>() == "workName")["value"] = "Two edited";

        Assert.False(adapter.PreservesLegacyIdentityState(baseline, candidate.ToJsonString()));
    }

    [Fact]
    public void LegacyShadowPreservesIdentityAcrossEditReorderAddAndRemove()
    {
        JsonObject content = ManagedContent();
        SelectedWorkBlockAdapter adapter = new();
        string baseline = adapter.Project(
            content, Guid.NewGuid(), SelectedWorkProjectionKeyMode.LegacyShadow);
        JsonObject candidate = JsonNode.Parse(baseline)!.AsObject();
        JsonArray layout = candidate["layout"]!["Umbraco.BlockList"]!.AsArray();
        JsonArray data = candidate["contentData"]!.AsArray();

        // Remove the first canonical item and move/edit the second one.
        layout.RemoveAt(0);
        JsonObject remaining = data[1]!.AsObject();
        remaining["values"]!.AsArray().OfType<JsonObject>()
            .Single(value => value["alias"]!.GetValue<string>() == "workName")["value"] = "Two edited";

        // A genuinely new native key has no managed identity metadata yet.
        Guid newKey = Guid.Parse("33333333-3333-4333-8333-333333333333");
        layout.Add(new JsonObject { ["contentKey"] = newKey });
        JsonObject added = JsonNode.Parse(remaining.ToJsonString())!.AsObject();
        added["key"] = newKey;
        JsonArray addedValues = added["values"]!.AsArray();
        addedValues.Remove(addedValues.OfType<JsonObject>()
            .Single(value => value["alias"]!.GetValue<string>() == "workCanonicalId"));
        addedValues.OfType<JsonObject>()
            .Single(value => value["alias"]!.GetValue<string>() == "workName")["value"] = "Three";
        data.Add(added);

        Assert.True(adapter.PreservesLegacyIdentityState(baseline, candidate.ToJsonString()));
    }

    [Fact]
    public void ScalarCompatibilityUnwrapsTopicsWithoutMutatingCanonicalIds()
    {
        JsonArray canonical = JsonNode.Parse("""
        [
          { "$id": "11111111-1111-4111-8111-111111111111", "$value": "Usable" },
          { "$id": "22222222-2222-4222-8222-222222222222", "$value": "Umbraco" }
        ]
        """)!.AsArray();

        JsonArray legacy = CollectionCompatibilityCodec.LegacyScalarArray(canonical);

        Assert.Equal(["Usable", "Umbraco"], legacy.Select(item => item!.GetValue<string>()).ToArray());
        Assert.Equal(
            "11111111-1111-4111-8111-111111111111",
            canonical[0]!["$id"]!.GetValue<string>());
    }

    private static JsonObject Content() => JsonNode.Parse("""
    {
      "type": "home",
      "selectedWork": [
        {
          "name": "One",
          "role": "Builder",
          "description": "First project",
          "href": "/one",
          "accent": "blue"
        },
        {
          "name": "Two",
          "role": "Advisor",
          "description": "Second project",
          "href": "/two",
          "accent": "green"
        }
      ]
    }
    """)!.AsObject();

    private static JsonObject ManagedContent()
    {
        JsonObject content = Content();
        content["selectedWork"]![0]!["$id"] = "11111111-1111-4111-8111-111111111111";
        content["selectedWork"]![1]!["$id"] = "22222222-2222-4222-8222-222222222222";
        return content;
    }
}
