using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using HtmlAgilityPack;
using Markdig;
using Umbraco.Cms.Core.Services;

namespace OlavurEllefsen.Umbraco.Sync;

public sealed partial class ArticleBodyBlockAdapter(IContentTypeService contentTypeService)
{
    internal const string HeadingElementAlias = "olavurArticleHeadingBlock";
    internal const string RichTextElementAlias = "olavurArticleRichTextBlock";
    internal const string ListElementAlias = "olavurArticleListBlock";
    internal const string QuoteElementAlias = "olavurArticleQuoteBlock";
    internal const string MediaElementAlias = "olavurArticleMediaBlock";

    public string Project(JsonObject content, IReadOnlyDictionary<string, Guid> elementKeys)
    {
        JsonObject body = ResolveBody(content);
        JsonArray layout = [];
        JsonArray contentData = [];
        JsonArray expose = [];

        foreach (JsonObject block in body["blocks"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            string type = String(block, "type");
            string? elementAlias = ElementAlias(type);
            if (elementAlias is null || !elementKeys.TryGetValue(elementAlias, out Guid elementKey))
                continue;

            string id = String(block, "id");
            Guid contentKey = StableGuid(string.IsNullOrWhiteSpace(id) ? block.ToJsonString() : id);
            JsonArray values = Values(type, block);
            layout.Add(new JsonObject { ["contentKey"] = contentKey });
            contentData.Add(new JsonObject
            {
                ["contentTypeKey"] = elementKey,
                ["key"] = contentKey,
                ["values"] = values,
            });
            expose.Add(new JsonObject
            {
                ["contentKey"] = contentKey,
                ["culture"] = null,
                ["segment"] = null,
            });
        }

        return new JsonObject
        {
            ["layout"] = new JsonObject { ["Umbraco.BlockList"] = layout },
            ["contentData"] = contentData,
            ["settingsData"] = new JsonArray(),
            ["expose"] = expose,
        }.ToJsonString();
    }

    public JsonObject? ToCanonical(string raw)
    {
        JsonObject? value = JsonNode.Parse(raw) as JsonObject;
        if (value is null) return null;
        JsonArray? layout = value["layout"]?["Umbraco.BlockList"] as JsonArray;
        JsonArray? data = value["contentData"] as JsonArray;
        if (layout is null || data is null) return null;

        Dictionary<Guid, JsonObject> contentByKey = data
            .OfType<JsonObject>()
            .Where(item => Guid.TryParse(String(item, "key"), out _))
            .ToDictionary(item => Guid.Parse(String(item, "key")));
        Dictionary<Guid, string> aliasesByKey = ElementAliases()
            .Select(alias => contentTypeService.Get(alias))
            .Where(type => type is not null)
            .ToDictionary(type => type!.Key, type => type!.Alias);
        JsonArray blocks = [];

        foreach (JsonObject item in layout.OfType<JsonObject>())
        {
            if (!Guid.TryParse(String(item, "contentKey"), out Guid contentKey) ||
                !contentByKey.TryGetValue(contentKey, out JsonObject? contentItem) ||
                !Guid.TryParse(String(contentItem, "contentTypeKey"), out Guid contentTypeKey) ||
                !aliasesByKey.TryGetValue(contentTypeKey, out string? elementAlias))
                continue;

            JsonObject properties = Properties(contentItem);
            JsonObject? block = CanonicalBlock(elementAlias, contentKey, properties);
            if (block is not null) blocks.Add(block);
        }

        return new JsonObject { ["version"] = 1, ["blocks"] = blocks };
    }

    public bool MatchesCanonical(JsonObject content, string nativeValue)
    {
        JsonObject expected = ResolveBody(content);
        JsonObject? actual = ToCanonical(nativeValue);
        return actual is not null && JsonNode.DeepEquals(expected, actual);
    }

    internal static JsonObject ResolveBody(JsonObject content)
    {
        if (content["bodyBlocks"] is JsonObject body && body["version"]?.GetValue<int>() == 1 &&
            body["blocks"] is JsonArray)
            return (JsonObject)body.DeepClone();
        return FromMarkdown(content["bodyMarkdown"]?.GetValue<string>() ?? string.Empty);
    }

    internal static JsonObject FromMarkdown(string markdown)
    {
        JsonArray blocks = [];
        int ordinal = 0;
        foreach (MarkdownSegment segment in MarkdownSegments(markdown))
        {
            if (segment.Media is JsonObject media)
            {
                blocks.Add(new JsonObject
                {
                    ["id"] = String(media, "id"),
                    ["type"] = "media",
                    ["media"] = media.DeepClone(),
                });
                continue;
            }

            foreach (string source in SplitMarkdownSections(segment.Markdown))
            {
                ordinal++;
                blocks.Add(MarkdownBlock(source, ordinal));
            }
        }
        return new JsonObject { ["version"] = 1, ["blocks"] = blocks };
    }

    private static JsonObject MarkdownBlock(string source, int ordinal)
    {
        string value = source.Trim();
        Match heading = HeadingPattern().Match(value);
        if (heading.Success)
            return new JsonObject
            {
                ["id"] = StableId("heading", value, ordinal),
                ["type"] = "heading",
                ["level"] = heading.Groups[1].Value.Length,
                ["text"] = heading.Groups[2].Value,
            };

        return new JsonObject
        {
            ["id"] = StableId("text", value, ordinal),
            ["type"] = "richText",
            ["markdown"] = value,
        };
    }

    private static IEnumerable<string> SplitMarkdownSections(string markdown)
    {
        List<string> body = [];
        foreach (string block in SplitMarkdownBlocks(markdown))
        {
            if (HeadingPattern().IsMatch(block))
            {
                if (body.Count > 0)
                {
                    yield return string.Join("\n\n", body);
                    body.Clear();
                }
                yield return block;
            }
            else body.Add(block);
        }
        if (body.Count > 0) yield return string.Join("\n\n", body);
    }

    private static IEnumerable<string> SplitMarkdownBlocks(string markdown)
    {
        List<string> current = [];
        string? fence = null;
        foreach (string line in markdown.Replace("\r\n", "\n").Split('\n'))
        {
            Match marker = FencePattern().Match(line);
            if (fence is null && marker.Success) fence = marker.Groups[1].Value;
            else if (fence is not null && marker.Success && marker.Groups[1].Value == fence) fence = null;
            if (fence is null && string.IsNullOrWhiteSpace(line))
            {
                if (current.Count > 0)
                {
                    yield return string.Join('\n', current).Trim();
                    current.Clear();
                }
            }
            else current.Add(line);
        }
        if (current.Count > 0) yield return string.Join('\n', current).Trim();
    }

    private static IEnumerable<MarkdownSegment> MarkdownSegments(string markdown)
    {
        int cursor = 0;
        foreach (Match match in MediaDirectivePattern().Matches(markdown))
        {
            if (match.Index > cursor)
                yield return new MarkdownSegment(markdown[cursor..match.Index], null);
            JsonObject? media = DecodeMedia(match.Groups[1].Value);
            if (media is not null) yield return new MarkdownSegment(string.Empty, media);
            else yield return new MarkdownSegment(match.Value, null);
            cursor = match.Index + match.Length;
        }
        if (cursor < markdown.Length) yield return new MarkdownSegment(markdown[cursor..], null);
    }

    private static JsonObject? DecodeMedia(string encoded)
    {
        try
        {
            JsonObject? media = JsonNode.Parse(Uri.UnescapeDataString(encoded)) as JsonObject;
            return media is not null && !string.IsNullOrWhiteSpace(String(media, "id")) ? media : null;
        }
        catch { return null; }
    }

    private static JsonArray Values(string type, JsonObject block)
    {
        JsonArray values = [];
        void Add(string alias, JsonNode? value, string editor = "Umbraco.TextBox") => values.Add(new JsonObject
        {
            ["editorAlias"] = editor,
            ["alias"] = alias,
            ["value"] = value?.DeepClone(),
            ["culture"] = null,
            ["segment"] = null,
        });

        Add("usableBlockId", block["id"]);
        switch (type)
        {
            case "heading":
                Add("headingText", block["text"]);
                Add("headingLevel", block["level"]);
                break;
            case "richText":
                Add("textMarkdown", RichTextValue(String(block, "markdown")), "Umbraco.RichText");
                break;
            case "list":
                Add("listStyle", block["style"]);
                Add("listItems", JsonValue.Create(string.Join('\n', block["items"]?.AsArray().Select(x => x?.GetValue<string>() ?? "") ?? [])), "Umbraco.TextArea");
                break;
            case "quote":
                Add("quoteMarkdown", block["markdown"], "Umbraco.TextArea");
                break;
            case "media":
                JsonObject media = block["media"] as JsonObject ?? new JsonObject();
                Add("assetId", media["id"]);
                Add("mediaType", media["type"]);
                Add("mediaSource", media["src"]);
                Add("mediaAlt", media["alt"]);
                Add("mediaCaption", media["caption"], "Umbraco.TextArea");
                Add("mediaPlacement", media["placement"]);
                Add("mediaAlignment", media["alignment"]);
                break;
        }
        return values;
    }

    private static JsonObject Properties(JsonObject contentItem)
    {
        JsonObject result = [];
        foreach (JsonObject value in contentItem["values"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            string alias = String(value, "alias");
            if (!string.IsNullOrWhiteSpace(alias)) result[alias] = value["value"]?.DeepClone();
        }
        return result;
    }

    private static JsonObject? CanonicalBlock(string alias, Guid key, JsonObject values)
    {
        string id = String(values, "usableBlockId");
        if (string.IsNullOrWhiteSpace(id)) id = $"block-{key:N}";
        return alias switch
        {
            HeadingElementAlias => new JsonObject
            {
                ["id"] = id, ["type"] = "heading",
                ["level"] = int.TryParse(String(values, "headingLevel"), out int level) && level is >= 2 and <= 4 ? level : 2,
                ["text"] = String(values, "headingText"),
            },
            RichTextElementAlias => new JsonObject
            {
                ["id"] = id, ["type"] = "richText", ["markdown"] = RichTextMarkdown(values["textMarkdown"]),
            },
            ListElementAlias => new JsonObject
            {
                ["id"] = id, ["type"] = "list",
                ["style"] = String(values, "listStyle") == "ordered" ? "ordered" : "unordered",
                ["items"] = new JsonArray(String(values, "listItems").Split('\n').Select(x => JsonValue.Create(x.TrimEnd())).ToArray()),
            },
            QuoteElementAlias => new JsonObject
            {
                ["id"] = id, ["type"] = "quote", ["markdown"] = String(values, "quoteMarkdown"),
            },
            MediaElementAlias => new JsonObject
            {
                ["id"] = id,
                ["type"] = "media",
                ["media"] = new JsonObject
                {
                    ["id"] = String(values, "assetId") is { Length: > 0 } assetId ? assetId : id,
                    ["type"] = String(values, "mediaType") == "video" ? "video" : "image",
                    ["src"] = String(values, "mediaSource"),
                    ["alt"] = String(values, "mediaAlt"),
                    ["caption"] = String(values, "mediaCaption"),
                    ["placement"] = String(values, "mediaPlacement") == "hero" ? "hero" : "inline",
                    ["alignment"] = String(values, "mediaAlignment") is "wide" or "left" or "right" ? String(values, "mediaAlignment") : "center",
                },
            },
            _ => null,
        };
    }

    private static string? ElementAlias(string type) => type switch
    {
        "heading" => HeadingElementAlias,
        "richText" => RichTextElementAlias,
        "list" => ListElementAlias,
        "quote" => QuoteElementAlias,
        "media" => MediaElementAlias,
        _ => null,
    };

    private static string[] ElementAliases() =>
        [HeadingElementAlias, RichTextElementAlias, ListElementAlias, QuoteElementAlias, MediaElementAlias];

    private static JsonObject RichTextValue(string markdown) => new()
    {
        ["markup"] = Markdown.ToHtml(markdown).Trim(),
        ["blocks"] = new JsonObject
        {
            ["contentData"] = new JsonArray(),
            ["settingsData"] = new JsonArray(),
            ["expose"] = new JsonArray(),
            ["layout"] = new JsonObject { ["Umbraco.RichText"] = new JsonArray() },
        },
    };

    private static string RichTextMarkdown(JsonNode? value)
    {
        JsonObject? richText = value as JsonObject;
        if (richText is null && value is JsonValue json && json.TryGetValue<string>(out string? raw))
        {
            try { richText = JsonNode.Parse(raw ?? string.Empty) as JsonObject; }
            catch { return raw ?? string.Empty; }
        }
        string markup = richText?["markup"]?.GetValue<string>() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(markup)) return string.Empty;
        HtmlDocument document = new();
        document.LoadHtml(markup);
        string markdown = string.Concat(document.DocumentNode.ChildNodes.Select(RenderHtmlNode));
        return BlankLinesPattern().Replace(markdown.Trim(), "\n\n");
    }

    private static string RenderHtmlNode(HtmlNode node)
    {
        if (node.NodeType == HtmlNodeType.Text) return HtmlEntity.DeEntitize(node.InnerText);
        if (node.NodeType != HtmlNodeType.Element) return string.Empty;
        string children = string.Concat(node.ChildNodes.Select(RenderHtmlNode));
        return node.Name.ToLowerInvariant() switch
        {
            "h2" => $"## {children.Trim()}\n\n",
            "h3" => $"### {children.Trim()}\n\n",
            "h4" => $"#### {children.Trim()}\n\n",
            "p" => $"{children.Trim()}\n\n",
            "strong" or "b" => $"**{children}**",
            "em" or "i" => $"*{children}*",
            "code" when node.ParentNode?.Name != "pre" => $"`{children}`",
            "pre" => $"```\n{HtmlEntity.DeEntitize(node.InnerText).TrimEnd()}\n```\n\n",
            "a" => SafeLink(node.GetAttributeValue("href", string.Empty), children),
            "br" => "\n",
            "blockquote" => $"{string.Join('\n', children.Trim().Split('\n').Select(line => $"> {line}"))}\n\n",
            "ul" => $"{RenderList(node, false)}\n",
            "ol" => $"{RenderList(node, true)}\n",
            _ => children,
        };
    }

    private static string RenderList(HtmlNode node, bool ordered)
    {
        IEnumerable<HtmlNode> items = node.ChildNodes.Where(child => child.Name.Equals("li", StringComparison.OrdinalIgnoreCase));
        return string.Join('\n', items.Select((item, index) =>
            $"{(ordered ? $"{index + 1}." : "-")} {string.Concat(item.ChildNodes.Select(RenderHtmlNode)).Trim()}"));
    }

    private static string SafeLink(string href, string label) =>
        href.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
        href.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
        href.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) ||
        href.StartsWith('/') || href.StartsWith('#')
            ? $"[{label}]({href})"
            : label;

    private static string String(JsonObject value, string key) => value[key] switch
    {
        JsonValue json when json.TryGetValue<string>(out string? text) => text ?? string.Empty,
        JsonValue json when json.TryGetValue<int>(out int number) => number.ToString(),
        _ => string.Empty,
    };

    private static Guid StableGuid(string value)
    {
        byte[] bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value))[..16];
        return new Guid(bytes);
    }

    private static string StableId(string kind, string value, int ordinal)
    {
        uint hash = 2166136261;
        foreach (char character in $"{kind}\0{value}")
        {
            hash ^= character;
            hash *= 16777619;
        }
        return $"block-{Base36(hash)}-{ordinal}";
    }

    private static string Base36(uint value)
    {
        const string alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value == 0) return "0";
        StringBuilder result = new();
        while (value > 0)
        {
            result.Insert(0, alphabet[(int)(value % 36)]);
            value /= 36;
        }
        return result.ToString();
    }

    private sealed record MarkdownSegment(string Markdown, JsonObject? Media);

    [GeneratedRegex(@"^(#{2,4})\s+([\s\S]*)$")]
    private static partial Regex HeadingPattern();
    [GeneratedRegex(@"^\s*[-*+]\s+")]
    private static partial Regex UnorderedListPattern();
    [GeneratedRegex(@"^\s*\d+\.\s+")]
    private static partial Regex OrderedListPattern();
    [GeneratedRegex(@"^\s*>\s?")]
    private static partial Regex QuotePattern();
    [GeneratedRegex(@"^\s*(```|~~~)")]
    private static partial Regex FencePattern();
    [GeneratedRegex(@"<!--\s*usable-media:([^\s]+)\s*-->")]
    private static partial Regex MediaDirectivePattern();
    [GeneratedRegex(@"\n[\t ]*\n(?:[\t ]*\n)+")]
    private static partial Regex BlankLinesPattern();
}
