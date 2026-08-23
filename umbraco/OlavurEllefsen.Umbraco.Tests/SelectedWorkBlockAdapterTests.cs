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

        string projected = adapter.Project(content, Guid.NewGuid());
        JsonArray? roundTripped = adapter.ToCanonical(projected);

        Assert.True(JsonNode.DeepEquals(content["selectedWork"], roundTripped));
        Assert.True(adapter.MatchesCanonical(content, projected));
    }

    [Fact]
    public void NativeLayoutControlsOrderAndSupportsDeletion()
    {
        SelectedWorkBlockAdapter adapter = new();
        JsonObject native = JsonNode.Parse(adapter.Project(Content(), Guid.NewGuid()))!.AsObject();
        JsonArray layout = native["layout"]!["Umbraco.BlockList"]!.AsArray();
        JsonNode? first = layout[0];
        layout.RemoveAt(0);
        layout.Add(first);

        JsonArray? reordered = adapter.ToCanonical(native.ToJsonString());
        Assert.Equal(["Two", "One"], reordered!.Select(item => item!["name"]!.GetValue<string>()).ToArray());

        layout.RemoveAt(1);
        JsonArray? deleted = adapter.ToCanonical(native.ToJsonString());
        Assert.Equal(["Two"], deleted!.Select(item => item!["name"]!.GetValue<string>()).ToArray());
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
}
