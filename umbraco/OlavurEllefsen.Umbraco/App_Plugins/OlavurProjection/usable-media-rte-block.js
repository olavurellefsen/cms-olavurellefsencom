import { css, html } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";

export default class OlavurUsableMediaRteBlock extends UmbLitElement {
  static properties = {
    content: { attribute: false },
    readonly: { type: Boolean },
  };

  render() {
    const content = normalizeContent(this.content);
    const src = String(content.mediaSource || "");
    const alt = String(content.mediaAlt || "");
    const caption = String(content.mediaCaption || "");
    const type = content.mediaType === "video" ? "video" : "image";
    return html`
      <figure>
        <div class="preview">
          ${src
            ? type === "video"
              ? html`<video src=${src} muted preload="metadata"></video>`
              : html`<img src=${src} alt=${alt || "Usable image preview"} />`
            : html`<uui-icon name="icon-picture"></uui-icon>`}
        </div>
        <figcaption>
          <span class="kicker">Usable Assets · ${content.mediaAlignment || "center"}</span>
          <strong>${caption || alt || "Inline image"}</strong>
          ${alt ? html`<span>${alt}</span>` : html`<span class="missing">Alternative text required</span>`}
        </figcaption>
      </figure>
    `;
  }

  static styles = css`
    :host { display: block; width: min(100%, 760px); }
    figure { align-items: stretch; background: var(--uui-color-surface); border: 1px solid var(--uui-color-border); border-radius: 7px; display: grid; grid-template-columns: 132px minmax(180px, 1fr); margin: 8px 0; overflow: hidden; }
    .preview { align-items: center; background: repeating-conic-gradient(#eee 0 25%, #fafafa 0 50%) 50% / 18px 18px; display: flex; justify-content: center; min-height: 94px; }
    img, video { display: block; height: 100%; max-height: 132px; object-fit: cover; width: 100%; }
    .preview uui-icon { color: var(--uui-color-text-alt); font-size: 28px; }
    figcaption { align-content: center; display: grid; gap: 4px; min-width: 0; padding: 13px 15px; }
    .kicker { color: #6750a4; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    strong { color: var(--uui-color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    figcaption > span:last-child { color: var(--uui-color-text-alt); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .missing { color: var(--uui-color-danger) !important; }
  `;
}

function normalizeContent(content) {
  if (Array.isArray(content)) return Object.fromEntries(content.map((entry) => [entry.alias, entry.value]));
  return content && typeof content === "object" ? content : {};
}

if (!customElements.get("olavur-usable-media-rte-block")) {
  customElements.define("olavur-usable-media-rte-block", OlavurUsableMediaRteBlock);
}
