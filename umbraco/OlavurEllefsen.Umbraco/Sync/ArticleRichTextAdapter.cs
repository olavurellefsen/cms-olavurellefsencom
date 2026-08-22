using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using HtmlAgilityPack;
using Markdig;

namespace OlavurEllefsen.Umbraco.Sync;

/// <summary>
/// Projects the portable Usable bodyBlocks contract into one native Umbraco Tiptap value.
/// Ordinary prose stays ordinary rich text; Usable assets are embedded RTE blocks.
/// </summary>
public sealed partial class ArticleRichTextAdapter
{
    public string Project(JsonObject content, Guid mediaElementKey)
    {
        JsonObject body = ArticleBodyBlockAdapter.ResolveBody(content);
        JsonArray contentData = [];
        JsonArray layout = [];
        JsonArray expose = [];
        StringBuilder markup = new();

        foreach (JsonObject block in body["blocks"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            string id = String(block, "id");
            string type = String(block, "type");
            switch (type)
            {
                case "heading":
                    int level = Int(block, "level") is >= 2 and <= 4 ? Int(block, "level") : 2;
                    markup.Append($"<h{level} data-usable-block-id=\"{Attribute(id)}\">{Text(String(block, "text"))}</h{level}>\n");
                    break;
                case "richText":
                    markup.Append($"<div data-usable-block-id=\"{Attribute(id)}\">{Markdown.ToHtml(String(block, "markdown")).Trim()}</div>\n");
                    break;
                case "list":
                    string tag = String(block, "style") == "ordered" ? "ol" : "ul";
                    markup.Append($"<{tag} data-usable-block-id=\"{Attribute(id)}\">");
                    foreach (JsonNode? item in block["items"]?.AsArray() ?? [])
                        markup.Append($"<li>{Text(item?.GetValue<string>() ?? string.Empty)}</li>");
                    markup.Append($"</{tag}>\n");
                    break;
                case "quote":
                    markup.Append($"<blockquote data-usable-block-id=\"{Attribute(id)}\">{Markdown.ToHtml(String(block, "markdown")).Trim()}</blockquote>\n");
                    break;
                case "media":
                    JsonObject media = block["media"] as JsonObject ?? new JsonObject();
                    Guid contentKey = StableGuid(string.IsNullOrWhiteSpace(id) ? media.ToJsonString() : id);
                    markup.Append($"<umb-rte-block data-content-key=\"{contentKey}\"></umb-rte-block>\n");
                    layout.Add(new JsonObject { ["contentKey"] = contentKey });
                    contentData.Add(new JsonObject
                    {
                        ["contentTypeKey"] = mediaElementKey,
                        ["key"] = contentKey,
                        ["values"] = MediaValues(id, media),
                    });
                    expose.Add(new JsonObject
                    {
                        ["contentKey"] = contentKey,
                        ["culture"] = null,
                        ["segment"] = null,
                    });
                    break;
            }
        }

        return new JsonObject
        {
            ["markup"] = markup.ToString().Trim(),
            ["blocks"] = new JsonObject
            {
                ["layout"] = new JsonObject { ["Umbraco.RichText"] = layout },
                ["contentData"] = contentData,
                ["settingsData"] = new JsonArray(),
                ["expose"] = expose,
            },
        }.ToJsonString();
    }

    public JsonObject? ToCanonical(string raw)
    {
        JsonObject? value;
        try { value = JsonNode.Parse(raw) as JsonObject; }
        catch { return null; }
        if (value is null) return null;

        string markup = value["markup"]?.GetValue<string>() ?? string.Empty;
        JsonArray contentData = value["blocks"]?["contentData"] as JsonArray ?? [];
        Dictionary<Guid, JsonObject> mediaByKey = contentData
            .OfType<JsonObject>()
            .Where(item => Guid.TryParse(String(item, "key"), out _))
            .ToDictionary(item => Guid.Parse(String(item, "key")));

        HtmlDocument document = new();
        document.LoadHtml(markup);
        JsonArray blocks = [];
        List<HtmlNode> prose = [];
        int ordinal = 0;

        void FlushProse()
        {
            if (prose.Count == 0) return;
            ordinal++;
            string markdown = NormalizeMarkdown(string.Concat(prose.Select(RenderHtmlNode)));
            if (!string.IsNullOrWhiteSpace(markdown))
            {
                string id = prose.FirstOrDefault()?.GetAttributeValue("data-usable-block-id", string.Empty) ?? string.Empty;
                blocks.Add(new JsonObject
                {
                    ["id"] = string.IsNullOrWhiteSpace(id) ? StableId("text", markdown, ordinal) : id,
                    ["type"] = "richText",
                    ["markdown"] = markdown,
                });
            }
            prose.Clear();
        }

        foreach (HtmlNode node in document.DocumentNode.ChildNodes)
        {
            if (node.NodeType == HtmlNodeType.Text && string.IsNullOrWhiteSpace(node.InnerText)) continue;
            string name = node.Name.ToLowerInvariant();
            if (name == "umb-rte-block")
            {
                FlushProse();
                if (Guid.TryParse(node.GetAttributeValue("data-content-key", string.Empty), out Guid key) &&
                    mediaByKey.TryGetValue(key, out JsonObject? item))
                {
                    JsonObject properties = Properties(item);
                    string mediaId = String(properties, "usableBlockId");
                    if (string.IsNullOrWhiteSpace(mediaId)) mediaId = $"media-{key:N}";
                    blocks.Add(MediaBlock(mediaId, properties));
                }
                continue;
            }

            string id = node.GetAttributeValue("data-usable-block-id", string.Empty);
            if (name is "h2" or "h3" or "h4")
            {
                FlushProse();
                ordinal++;
                string heading = WebUtility.HtmlDecode(node.InnerText).Trim();
                blocks.Add(new JsonObject
                {
                    ["id"] = string.IsNullOrWhiteSpace(id) ? StableId("heading", heading, ordinal) : id,
                    ["type"] = "heading",
                    ["level"] = int.Parse(name[1..]),
                    ["text"] = heading,
                });
            }
            else if (name is "ul" or "ol")
            {
                FlushProse();
                ordinal++;
                JsonArray items = new(node.ChildNodes
                    .Where(child => child.Name.Equals("li", StringComparison.OrdinalIgnoreCase))
                    .Select(child => JsonValue.Create(WebUtility.HtmlDecode(child.InnerText).Trim()))
                    .ToArray());
                string fingerprint = string.Join('\n', items.Select(item => item?.GetValue<string>() ?? string.Empty));
                blocks.Add(new JsonObject
                {
                    ["id"] = string.IsNullOrWhiteSpace(id) ? StableId("list", fingerprint, ordinal) : id,
                    ["type"] = "list",
                    ["style"] = name == "ol" ? "ordered" : "unordered",
                    ["items"] = items,
                });
            }
            else if (name == "blockquote")
            {
                FlushProse();
                ordinal++;
                string markdown = NormalizeMarkdown(string.Concat(node.ChildNodes.Select(RenderHtmlNode)));
                blocks.Add(new JsonObject
                {
                    ["id"] = string.IsNullOrWhiteSpace(id) ? StableId("quote", markdown, ordinal) : id,
                    ["type"] = "quote",
                    ["markdown"] = markdown,
                });
            }
            else if (name == "div" && !string.IsNullOrWhiteSpace(id))
            {
                FlushProse();
                ordinal++;
                string markdown = NormalizeMarkdown(string.Concat(node.ChildNodes.Select(RenderHtmlNode)));
                blocks.Add(new JsonObject { ["id"] = id, ["type"] = "richText", ["markdown"] = markdown });
            }
            else prose.Add(node);
        }
        FlushProse();
        return new JsonObject { ["version"] = 1, ["blocks"] = blocks };
    }

    public bool MatchesCanonical(JsonObject content, string nativeValue)
    {
        JsonObject expected = ArticleBodyBlockAdapter.ResolveBody(content);
        JsonObject? actual = ToCanonical(nativeValue);
        return actual is not null && JsonNode.DeepEquals(expected, actual);
    }

    private static JsonArray MediaValues(string id, JsonObject media)
    {
        JsonArray values = [];
        void Add(string alias, JsonNode? node, string editor = "Umbraco.TextBox") => values.Add(new JsonObject
        {
            ["editorAlias"] = editor,
            ["alias"] = alias,
            ["value"] = node?.DeepClone(),
            ["culture"] = null,
            ["segment"] = null,
        });
        Add("usableBlockId", JsonValue.Create(id));
        Add("assetId", media["id"]);
        Add("mediaType", media["type"]);
        Add("mediaSource", media["src"]);
        Add("mediaAlt", media["alt"]);
        Add("mediaCaption", media["caption"], "Umbraco.TextArea");
        Add("mediaPlacement", media["placement"]);
        Add("mediaAlignment", media["alignment"]);
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

    private static JsonObject MediaBlock(string id, JsonObject values) => new()
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
            ["alignment"] = String(values, "mediaAlignment") is "wide" or "left" or "right"
                ? String(values, "mediaAlignment") : "center",
        },
    };

    private static string RenderHtmlNode(HtmlNode node)
    {
        if (node.NodeType == HtmlNodeType.Text) return WebUtility.HtmlDecode(node.InnerText);
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
            "pre" => $"```\n{WebUtility.HtmlDecode(node.InnerText).TrimEnd()}\n```\n\n",
            "a" => SafeLink(node.GetAttributeValue("href", string.Empty), children),
            "br" => "\n",
            "blockquote" => $"{string.Join('\n', children.Trim().Split('\n').Select(line => $"> {line}"))}\n\n",
            "ul" => $"{RenderList(node, false)}\n",
            "ol" => $"{RenderList(node, true)}\n",
            _ => children,
        };
    }

    private static string RenderList(HtmlNode node, bool ordered) => string.Join('\n',
        node.ChildNodes.Where(child => child.Name.Equals("li", StringComparison.OrdinalIgnoreCase))
            .Select((item, index) => $"{(ordered ? $"{index + 1}." : "-")} {string.Concat(item.ChildNodes.Select(RenderHtmlNode)).Trim()}"));

    private static string SafeLink(string href, string label) =>
        href.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
        href.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
        href.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) || href.StartsWith('/') || href.StartsWith('#')
            ? $"[{label}]({href})" : label;

    private static string NormalizeMarkdown(string value) => BlankLinesPattern().Replace(value.Trim(), "\n\n");
    private static string Text(string value) => WebUtility.HtmlEncode(value);
    private static string Attribute(string value) => WebUtility.HtmlEncode(value);
    private static int Int(JsonObject value, string key) => value[key]?.GetValue<int>() ?? 0;
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
        foreach (char character in $"{kind}\0{value}") { hash ^= character; hash *= 16777619; }
        return $"{kind}-{ordinal}-{hash:x8}";
    }

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex BlankLinesPattern();
}
