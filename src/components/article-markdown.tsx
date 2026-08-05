import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type ArticleMediaBlock,
  articleMediaDirective,
  firstArticleHeroMedia,
  parseArticleMarkdown,
} from "@/lib/content/article-media";

export function ArticleMarkdown({ markdown }: { markdown: string }) {
  const keyCounts = new Map<string, number>();
  return parseArticleMarkdown(markdown).map((segment) => {
    if (segment.type === "media") {
      return segment.value.placement === "inline" ? (
        <ArticleMedia key={segment.value.id} media={segment.value} />
      ) : null;
    }
    if (!segment.value.trim()) return null;
    const keyBase = textKey(segment.value);
    const occurrence = (keyCounts.get(keyBase) || 0) + 1;
    keyCounts.set(keyBase, occurrence);
    return (
      <ReactMarkdown key={`${keyBase}-${occurrence}`} remarkPlugins={[remarkGfm]}>
        {segment.value}
      </ReactMarkdown>
    );
  });
}

export function ArticleDirectiveHero({ markdown }: { markdown: string }) {
  const hero = firstArticleHeroMedia(markdown);
  return hero ? <ArticleMedia media={hero} hero /> : null;
}

export function ArticleMedia({
  media,
  hero = false,
}: {
  media: ArticleMediaBlock;
  hero?: boolean;
}) {
  return (
    <figure
      className={`article-media article-media--${media.alignment}${hero ? " article-media--hero" : ""}`}
      data-article-media-id={media.id}
      data-article-media-directive={articleMediaDirective(media)}
    >
      {media.type === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: CMS videos may be silent/ambient; a VTT transcript field is not part of this media block yet.
        <video
          src={media.src}
          aria-label={media.alt || media.caption || "Article video"}
          controls
          playsInline
          preload="metadata"
        />
      ) : (
        <Image
          src={media.src}
          alt={media.alt}
          width={1600}
          height={900}
          sizes={hero || media.alignment === "wide" ? "100vw" : "(max-width: 800px) 100vw, 760px"}
          priority={hero}
          unoptimized
        />
      )}
      {media.caption ? <figcaption>{media.caption}</figcaption> : null}
    </figure>
  );
}

function textKey(value: string) {
  let hash = 5381;
  for (const character of value) hash = (hash * 33) ^ character.charCodeAt(0);
  return `markdown-${hash >>> 0}`;
}
