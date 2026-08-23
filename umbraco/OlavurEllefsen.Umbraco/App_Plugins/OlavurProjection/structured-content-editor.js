import { UMB_AUTH_CONTEXT } from "@umbraco-cms/backoffice/auth";
import { UmbChangeEvent } from "@umbraco-cms/backoffice/event";
import { css, html, nothing } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import {
  UMB_DOCUMENT_PUBLISHING_WORKSPACE_CONTEXT,
  UMB_DOCUMENT_WORKSPACE_CONTEXT,
} from "@umbraco-cms/backoffice/document";
import {
  describeMarkdownBlock,
  inlineHtmlToMarkdown,
  inlineMarkdownToHtml,
  joinArticleEditorBlocks,
  splitArticleEditorBlocks,
} from "./article-blocks.js";
import {
  canonicalBodyFromNativeBlockList,
  nativeBlockListFingerprint,
} from "./native-article-blocks.js";
import {
  applyNativeArticleValues,
  nativeArticleFingerprint,
} from "./native-article-document.js";
import { requestFederatedCmsSession } from "./backoffice-request.js";

const BRIDGE_MESSAGE = "olavur-usable-bridge";

const scalarFields = {
  global: [
    ["siteName", "Site name", "text"],
    ["siteDescription", "Site description", "textarea"],
    ["footer", "Footer text", "textarea"],
  ],
  home: [
    ["eyebrow", "Eyebrow", "text"],
    ["headline", "Headline", "textarea"],
    ["introduction", "Introduction", "textarea"],
    ["currentFocus.label", "Focus label", "text"],
    ["currentFocus.title", "Focus title", "text"],
    ["currentFocus.body", "Focus body", "textarea"],
    ["currentFocus.href", "Focus link", "url"],
    ["currentFocus.linkLabel", "Focus link label", "text"],
    ["selectedWorkTitle", "Selected work heading", "text"],
    ["latestWritingTitle", "Latest writing heading", "text"],
  ],
  writing: [
    ["eyebrow", "Eyebrow", "text"],
    ["headline", "Headline", "textarea"],
    ["introduction", "Introduction", "textarea"],
  ],
  about: [
    ["eyebrow", "Eyebrow", "text"],
    ["headline", "Headline", "textarea"],
    ["lead", "Lead", "textarea"],
    ["principlesTitle", "Principles heading", "text"],
    ["contactTitle", "Contact heading", "text"],
    ["contactBody", "Contact text", "textarea"],
  ],
  article: [
    ["title", "Article title", "textarea"],
    ["summary", "Summary", "textarea"],
  ],
};

const imageFields = {
  global: [
    {
      path: "author.portrait",
      label: "Portrait",
      regionId: () => "global.author.portrait",
      removable: false,
      required: true,
    },
  ],
  article: [
    {
      path: "heroImage",
      label: "Hero image",
      regionId: (payload) => `${payload.id}.article.heroImage.src`,
      removable: true,
      required: false,
      showPath: "showHeroImage",
    },
  ],
};

class OlavurInlineRichTextEditor extends UmbLitElement {
  static properties = {
    markdown: { type: String },
    readonly: { type: Boolean },
  };

  constructor() {
    super();
    this.markdown = "";
    this.readonly = false;
  }

  render() {
    return html`
      <div class="toolbar" aria-label="Text formatting">
        <button type="button" title="Bold" ?disabled=${this.readonly} @mousedown=${(event) => this.#format("bold", event)}><strong>B</strong></button>
        <button type="button" title="Italic" ?disabled=${this.readonly} @mousedown=${(event) => this.#format("italic", event)}><em>I</em></button>
        <button type="button" title="Add link" ?disabled=${this.readonly} @mousedown=${(event) => this.#format("createLink", event)}><uui-icon name="icon-link"></uui-icon></button>
        <button type="button" title="Remove formatting" ?disabled=${this.readonly} @mousedown=${(event) => this.#format("removeFormat", event)}>Clear</button>
      </div>
      <div
        class="surface"
        role="textbox"
        aria-label="Text section"
        aria-multiline="true"
        .contentEditable=${this.readonly ? "false" : "true"}
        @input=${this.#emit}
        @paste=${this.#paste}
      ></div>
    `;
  }

  updated(changed) {
    if (!changed.has("markdown")) return;
    const surface = this.renderRoot.querySelector(".surface");
    if (surface && !surface.matches(":focus")) {
      surface.innerHTML = inlineMarkdownToHtml(this.markdown);
    }
  }

  #format(command, event) {
    event.preventDefault();
    const surface = this.renderRoot.querySelector(".surface");
    if (!surface || this.readonly) return;
    surface.focus();
    if (command === "createLink") {
      const href = window.prompt("Link URL (https://… or /page)");
      if (!href) return;
      if (!/^(?:https?:\/\/|\/)/i.test(href.trim())) {
        window.alert("Use an https:// URL or a site-relative /path.");
        return;
      }
      document.execCommand(command, false, href.trim());
    } else {
      document.execCommand(command, false);
    }
    this.#emit();
  }

  #paste = (event) => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
  };

  #emit = () => {
    const surface = this.renderRoot.querySelector(".surface");
    if (!surface) return;
    this.dispatchEvent(
      new CustomEvent("markdown-input", {
        bubbles: true,
        composed: true,
        detail: { value: inlineHtmlToMarkdown(surface.innerHTML) },
      }),
    );
  };

  static styles = css`
    :host { display: block; }
    .toolbar { align-items: center; background: var(--uui-color-surface-alt); border: 1px solid var(--uui-color-border); border-bottom: 0; border-radius: 4px 4px 0 0; display: flex; gap: 2px; padding: 4px; }
    button { align-items: center; background: transparent; border: 0; border-radius: 3px; color: var(--uui-color-text); cursor: pointer; display: inline-flex; font: inherit; justify-content: center; min-height: 30px; min-width: 32px; padding: 4px 7px; }
    button:hover:not(:disabled), button:focus-visible { background: var(--uui-color-surface); color: var(--uui-color-interactive); }
    button:disabled { cursor: not-allowed; opacity: .4; }
    .surface { background: var(--uui-color-surface); border: 1px solid var(--uui-color-border); border-radius: 0 0 4px 4px; color: var(--uui-color-text); font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; min-height: 92px; padding: 10px 12px; white-space: pre-wrap; }
    .surface:focus { border-color: var(--uui-color-interactive); box-shadow: 0 0 0 1px var(--uui-color-interactive); outline: 0; }
    .surface a { color: var(--uui-color-interactive); text-decoration: underline; }
    .surface code { background: var(--uui-color-surface-alt); border-radius: 3px; font-family: ui-monospace, monospace; padding: 1px 4px; }
  `;
}

export default class OlavurStructuredContentEditor extends UmbLitElement {
  static properties = {
    value: { type: String },
    readonly: { type: Boolean },
    _working: { state: true },
    _workflow: { state: true },
    _bridgeSession: { state: true },
    _bridgeError: { state: true },
    _error: { state: true },
    _imageUpload: { state: true },
    _uploadingPath: { state: true },
    _mediaComposer: { state: true },
    _inlineUpload: { state: true },
    _insertMenu: { state: true },
    _nativeBodyState: { state: true },
  };

  #baseline;
  #baseValue = "";
  #revisionId;
  #workspaceContext;
  #publishingContext;
  #originalRequestSave;
  #originalSaveAndPublish;
  #requestSaveWrapper;
  #saveAndPublishWrapper;
  #bridgeOrigin;
  #pending = new Map();
  #initialized = false;
  #dragIndex;
  #nativeBodyBaseline;
  #nativeArticleBaseline;
  #federating = false;

  constructor() {
    super();
    this.value = "";
    this.readonly = false;
    this._working = undefined;
    this._workflow = "loading";
    this._bridgeSession = undefined;
    this._bridgeError = "";
    this._error = "";
    this._imageUpload = undefined;
    this._uploadingPath = undefined;
    this._mediaComposer = undefined;
    this._inlineUpload = undefined;
    this._insertMenu = undefined;
    this._nativeBodyState = "loading";
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      this.#workspaceContext = context;
      this.#installWorkspaceActions();
      if (context?.values) {
        this.observe(
          context.values,
          (values) => this.#receiveNativeValues(values),
          "olavurNativeArticleBody",
        );
      }
    });
    this.consumeContext(UMB_DOCUMENT_PUBLISHING_WORKSPACE_CONTEXT, (context) => {
      this.#publishingContext = context;
      this.#installWorkspaceActions();
    });
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.#receiveBridgeMessage);
  }

  disconnectedCallback() {
    window.removeEventListener("message", this.#receiveBridgeMessage);
    this.#revokeUploadPreview();
    this.#revokeInlinePreview();
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("The Usable bridge was closed."));
    }
    this.#pending.clear();
    this.#restoreWorkspaceActions();
    super.disconnectedCallback();
  }

  willUpdate(changed) {
    if (!changed.has("value") || this.#initialized || !this.value) return;
    const parsed = parsePayload(this.value);
    if (!parsed) {
      this._error = "This projected document does not contain valid JSON.";
      return;
    }
    this.#initialized = true;
    const workspaceValues = this.#workspaceContext?.getValues?.() || [];
    const publishedValue = workspaceValues.find(
      (entry) => entry.alias === "publishedPayloadJson",
    )?.value;
    const published = parsePayload(publishedValue);
    this.#baseValue = published ? String(publishedValue) : this.value;
    this.#baseline = clone(published || parsed);
    this._working = clone(parsed);
    this.#revisionId = String(
      workspaceValues.find((entry) => entry.alias === "usableDraftRevisionId")?.value || "",
    ) || undefined;
    const cached = readCache(cacheKey(parsed));
    if (cached?.baseValue === this.#baseValue && cached.working) {
      this._working = cached.working;
      this.#revisionId = cached.revisionId || this.#revisionId;
      this.value = JSON.stringify(this._working, null, 2);
      this.dispatchEvent(new UmbChangeEvent());
      this._workflow = this.#revisionId ? "draft" : "changed";
    } else {
      this._workflow = same(this._working, this.#baseline)
        ? "published"
        : this.#revisionId
          ? "draft"
          : "changed";
    }
    this.#receiveNativeValues(this.#workspaceContext?.getValues?.());
  }

  render() {
    if (!this._working) {
      return html`<uui-loader-bar></uui-loader-bar>${this._error
        ? html`<uui-box color="danger">${this._error}</uui-box>`
        : nothing}`;
    }

    const kind = contentKind(this._working);
    const content = canonicalContent(this._working);
    const title = documentTitle(this._working, kind);
    const fields = scalarFields[kind] || [];
    const images = imageFields[kind] || [];
    const changeCount = this.#changes().length;
    const canEdit = Boolean(this._bridgeSession?.authorized && this._bridgeSession?.capabilities?.edit);
    const canPublish = Boolean(
      this._bridgeSession?.authorized && this._bridgeSession?.capabilities?.publish,
    );
    const canUpload = Boolean(
      this._bridgeSession?.authorized && this._bridgeSession?.capabilities?.upload,
    );
    const validationErrors = this.#validationErrors();

    if (kind === "article" && this.#isNativeArticleDocument()) {
      return this.#renderNativeArticlePublishing({
        content,
        title,
        changeCount,
        canEdit,
        canPublish,
        canUpload,
        validationErrors,
      });
    }

    return html`
      <section class="editor-shell">
        <header class="hero">
          <div>
            <span class="kicker">Usable canonical · Umbraco projection</span>
            <h2>${title}</h2>
            <p>${this.#workflowCopy(changeCount)}</p>
          </div>
          <span class="status status-${this._workflow}">${workflowLabel(this._workflow)}</span>
        </header>

        <iframe
          id="usable-bridge"
          title="Usable CMS session"
          src=${bridgeUrl()}
          @load=${this.#bridgeLoaded}
        ></iframe>

        ${this._bridgeError ? html`<div class="callout error">${this._bridgeError}</div>` : nothing}
        ${this._error ? html`<div class="callout error">${this._error}</div>` : nothing}
        ${validationErrors.length
          ? html`<div class="callout warning">${validationErrors.join(" ")}</div>`
          : nothing}

        <div class="field-grid">
          ${fields.map(([path, label, editor]) =>
            this.#renderField(content, path, label, editor),
          )}
        </div>

        ${kind === "article" ? this.#renderNativeBodyWorkflow(content) : nothing}

        ${images.map((descriptor) => this.#renderImageField(content, descriptor, canUpload))}

        ${kind === "global" ? this.#renderNavigation(content) : nothing}
        ${kind === "home" ? this.#renderSelectedWork(content) : nothing}
        ${kind === "about" ? this.#renderStringList(content, "body", "Body paragraphs") : nothing}
        ${kind === "about"
          ? this.#renderStringList(content, "principles", "Principles")
          : nothing}
        ${kind === "article" ? this.#renderTopics(content) : nothing}

        <footer class="workflow-bar">
          <div class="workflow-note">
            <strong>${changeCount} ${changeCount === 1 ? "change" : "changes"}</strong>
            <span>Drafts stay private until Publish is confirmed.</span>
          </div>
          <uui-button
            look="secondary"
            label="Save Usable draft"
            ?disabled=${
              this.readonly ||
              !canEdit ||
              !changeCount ||
              validationErrors.length > 0 ||
              Boolean(this._uploadingPath) ||
              this._workflow === "saving"
            }
            @click=${this.#saveDraft}
          >Save draft</uui-button>
          <uui-button
            look="primary"
            color="positive"
            label="Publish Usable draft"
            ?disabled=${
              this.readonly ||
              !canPublish ||
              (!changeCount && !this.#revisionId) ||
              validationErrors.length > 0 ||
              Boolean(this._uploadingPath) ||
              this._workflow === "publishing"
            }
            @click=${this.#publish}
          >Publish</uui-button>
        </footer>
      </section>
    `;
  }

  #renderNativeArticlePublishing({
    content,
    title,
    changeCount,
    canEdit,
    canPublish,
    canUpload,
    validationErrors,
  }) {
    const hero = imageFields.article[0];
    return html`
      <section class="editor-shell native-article-shell">
        <header class="hero compact-hero">
          <div>
            <span class="kicker">Usable publishing</span>
            <h2>${title}</h2>
            <p>${this.#workflowCopy(changeCount)}</p>
          </div>
          <span class="status status-${this._workflow}">${workflowLabel(this._workflow)}</span>
        </header>
        <iframe
          id="usable-bridge"
          title="Usable CMS session"
          src=${bridgeUrl()}
          @load=${this.#bridgeLoaded}
        ></iframe>
        ${this._bridgeError ? html`<div class="callout error">${this._bridgeError}</div>` : nothing}
        ${this._error ? html`<div class="callout error">${this._error}</div>` : nothing}
        ${validationErrors.length
          ? html`<div class="callout warning">${validationErrors.join(" ")}</div>`
          : nothing}
        <div class="native-editor-note">
          <uui-icon name="icon-check"></uui-icon>
          <div>
            <strong>Native Umbraco editing</strong>
            <span>Title, summary, formatted body, inline images, and topics above are synchronized into this Usable draft.</span>
          </div>
        </div>
        ${this.#renderImageField(content, hero, canUpload)}
        <footer class="workflow-bar">
          <div class="workflow-note">
            <strong>${changeCount} ${changeCount === 1 ? "change" : "changes"}</strong>
            <span>Umbraco Save stores a private Usable draft. Save and publish publishes both.</span>
          </div>
          <uui-button
            look="secondary"
            label="Save private draft"
            ?disabled=${
              this.readonly ||
              !canEdit ||
              !changeCount ||
              validationErrors.length > 0 ||
              Boolean(this._uploadingPath) ||
              this._workflow === "saving"
            }
            @click=${() => this.#workspaceContext?.requestSave?.()}
          >Save draft</uui-button>
          <uui-button
            look="primary"
            color="positive"
            label="Publish article"
            ?disabled=${
              this.readonly ||
              !canPublish ||
              (!changeCount && !this.#revisionId) ||
              validationErrors.length > 0 ||
              Boolean(this._uploadingPath) ||
              this._workflow === "publishing"
            }
            @click=${this.#publish}
          >Publish</uui-button>
        </footer>
      </section>
    `;
  }

  #renderField(content, path, label, editor) {
    const value = valueAt(content, path) ?? "";
    const isLong = editor === "textarea" || editor === "markdown";
    return html`
      <label class=${isLong ? "field field-wide" : "field"}>
        <span>${label}</span>
        ${isLong
          ? html`<uui-textarea
              label=${label}
              .value=${String(value)}
              rows=${editor === "markdown" ? 18 : 4}
              ?readonly=${this.readonly}
              @input=${(event) => this.#update(path, event.target.value)}
            ></uui-textarea>`
          : html`<uui-input
              label=${label}
              type=${editor === "url" ? "url" : "text"}
              .value=${String(value)}
              ?readonly=${this.readonly}
              @input=${(event) => this.#update(path, event.target.value)}
            ></uui-input>`}
      </label>
    `;
  }

  #renderArticleBody(content, canUpload, canEdit) {
    const markdown = String(content.bodyMarkdown || "");
    const blocks = articleEditorBlocks(markdown);
    const media = articleMediaBlocks(markdown);
    return html`
      <section class="article-body-editor">
        <div class="article-body-heading">
          <div>
            <span class="kicker">Structured article</span>
            <h3>Body and inline media</h3>
            <p>Edit blocks in place, add content between them, or drag and move blocks into a new order.</p>
          </div>
          <span class="media-count">${media.length} ${media.length === 1 ? "asset" : "assets"}</span>
        </div>

        ${!canEdit
          ? html`<div class="editor-session-note">
              <uui-icon name="icon-info"></uui-icon>
              <span>You can compose locally now. Connect the Usable session above before saving a canonical draft.</span>
            </div>`
          : nothing}

        <div class="article-flow">
          ${this.#renderInsertionControl(0, "Add a block before the first section")}
          ${blocks.map((block, index) => html`
            <article
              class="content-block"
              @dragover=${this.#allowBlockDrop}
              @drop=${(event) => this.#dropArticleBlock(index, event)}
            >
              ${this.#renderBlockToolbar(block, index, blocks.length)}
              ${block.type === "media"
                ? this.#renderArticleMediaCard(block.value, index)
                : this.#renderMarkdownBlock(block.value, index)}
            </article>
            ${this.#renderInsertionControl(
              index + 1,
              index === blocks.length - 1 ? "Add a block at the end" : "Add a block here",
            )}
          `)}
          ${!blocks.length
            ? html`<div class="article-empty">Use the + above to add a heading, text section, or image.</div>`
            : nothing}
        </div>

        ${this._mediaComposer ? this.#renderMediaComposer(canUpload) : nothing}

        <details class="markdown-source">
          <summary>Advanced: edit the full Markdown source</summary>
          <p>This is a source/recovery view. Normal editing happens in the blocks above; media is shown here as readable markers.</p>
          <uui-textarea
            label="Article Markdown"
            .value=${articleMarkdownForEditor(markdown)}
            rows="18"
            ?readonly=${this.readonly}
            @input=${(event) =>
              this.#update(
                "bodyMarkdown",
                articleMarkdownFromEditor(event.target.value, media),
              )}
          ></uui-textarea>
        </details>
      </section>
    `;
  }

  #renderNativeBodyWorkflow(content) {
    const blocks = content.bodyBlocks?.blocks;
    const blockCount = Array.isArray(blocks) ? blocks.length : undefined;
    return html`
      <section class="native-body-workflow">
        <div>
          <span class="kicker">Native Umbraco Block List</span>
          <h3>Edit the native article-body field</h3>
          <p>Use <strong>Article body (native blocks)</strong> to add, edit, remove, and drag sections. This workflow panel then saves those structured blocks as a private Usable draft and publishes them explicitly.</p>
        </div>
        <span class="status ${this._nativeBodyState === "changed" ? "status-draft" : "status-published"}">
          ${this._nativeBodyState === "changed"
            ? "Block changes ready"
            : blockCount === undefined
              ? "Legacy body projected"
              : `${blockCount} blocks`}
        </span>
        ${content.bodyMarkdown
          ? html`<details class="markdown-source legacy-source">
              <summary>Legacy Markdown compatibility copy</summary>
              <p>This remains readable during migration. New edits are saved to bodyBlocks.</p>
              <pre>${content.bodyMarkdown}</pre>
            </details>`
          : nothing}
      </section>
    `;
  }

  #renderBlockToolbar(block, index, blockCount) {
    const model = markdownBlockModel(block.value);
    const label = block.type === "media" ? block.value.type : model.kind;
    return html`
      <header class="block-toolbar">
        <button
          class="drag-handle"
          type="button"
          title="Drag to reorder"
          draggable=${!this.readonly}
          ?disabled=${this.readonly}
          @dragstart=${(event) => this.#startBlockDrag(index, event)}
          @dragend=${this.#endBlockDrag}
        ><uui-icon name="icon-navigation"></uui-icon><span>Move ${label}</span></button>
        <span class="block-kind">${label}</span>
        <div class="block-actions">
          <button type="button" title="Move up" ?disabled=${this.readonly || index === 0} @click=${() => this.#moveArticleBlock(index, -1)}>↑</button>
          <button type="button" title="Move down" ?disabled=${this.readonly || index === blockCount - 1} @click=${() => this.#moveArticleBlock(index, 1)}>↓</button>
          <button class="danger" type="button" title="Remove block" ?disabled=${this.readonly} @click=${() => this.#removeArticleBlock(index)}>Remove</button>
        </div>
      </header>
    `;
  }

  #renderMarkdownBlock(value, index) {
    const model = markdownBlockModel(value);
    if (model.kind === "Heading") {
      return html`<div class="markdown-block heading-block">
        <label class="field">
          <span>Heading</span>
          <div class="heading-fields">
            <select ?disabled=${this.readonly} @change=${(event) => this.#updateHeadingBlock(index, event.target.value, model.text)}>
              ${[2, 3, 4].map((level) => html`<option value=${level} ?selected=${model.level === level}>H${level}</option>`)}
            </select>
            <uui-input
              label="Heading text"
              .value=${model.text}
              ?readonly=${this.readonly}
              @input=${(event) => this.#updateHeadingBlock(index, model.level, event.target.value)}
            ></uui-input>
          </div>
        </label>
      </div>`;
    }
    if (model.kind === "List") {
      return html`<div class="markdown-block">
        <label class="field">
          <span>List items <small>One item per line</small></span>
          <select class="list-style" ?disabled=${this.readonly} @change=${(event) => this.#updateListBlock(index, event.target.value, model.text)}>
            <option value="unordered" ?selected=${model.style === "unordered"}>Bulleted list</option>
            <option value="ordered" ?selected=${model.style === "ordered"}>Numbered list</option>
          </select>
          <uui-textarea
            label="List items"
            .value=${model.text}
            rows="${Math.max(3, model.text.split("\n").length)}"
            ?readonly=${this.readonly}
            @input=${(event) => this.#updateListBlock(index, model.style, event.target.value)}
          ></uui-textarea>
        </label>
      </div>`;
    }
    if (model.kind === "Quote") {
      return html`<div class="markdown-block">
        <label class="field">
          <span>Quote</span>
          <uui-textarea
            label="Quote"
            .value=${model.text}
            rows="4"
            ?readonly=${this.readonly}
            @input=${(event) => this.#updateQuoteBlock(index, event.target.value)}
          ></uui-textarea>
        </label>
      </div>`;
    }
    if (model.kind === "Hidden metadata") {
      return html`<details class="metadata-block">
        <summary>Hidden content metadata (preserved)</summary>
        <pre>${value}</pre>
      </details>`;
    }
    return html`
      <div class="markdown-block">
        <label class="field">
          <span>Text</span>
          <olavur-inline-rich-text
            .markdown=${value}
            .readonly=${this.readonly}
            @markdown-input=${(event) => this.#updateArticleBlock(index, event.detail.value)}
          ></olavur-inline-rich-text>
        </label>
      </div>
    `;
  }

  #renderArticleMediaCard(media, index) {
    return html`
      <div class="inline-media-card">
        <div class="inline-media-preview">
          ${media.type === "video"
            ? html`<video src=${media.src} controls preload="metadata"></video>`
            : html`<img src=${media.src} alt=${media.alt || "Inline image preview"} />`}
        </div>
        <div class="inline-media-details">
          <div class="inline-media-title">
            <div>
              <span class="kicker">${media.placement} ${media.type}</span>
              <h4>${media.caption || media.alt || "Inline media"}</h4>
            </div>
          </div>
          <label class="field">
            <span>Alternative text · required</span>
            <uui-input label="Alternative text" .value=${media.alt} ?readonly=${this.readonly} @input=${(event) => this.#updateArticleMedia(index, "alt", event.target.value)}></uui-input>
          </label>
          <label class="field">
            <span>Caption</span>
            <uui-textarea label="Caption" .value=${media.caption} rows="3" ?readonly=${this.readonly} @input=${(event) => this.#updateArticleMedia(index, "caption", event.target.value)}></uui-textarea>
          </label>
          <label class="field">
            <span>Alignment</span>
            <select ?disabled=${this.readonly} @change=${(event) => this.#updateArticleMedia(index, "alignment", event.target.value)}>
              ${["center", "wide", "left", "right"].map((alignment) => html`<option value=${alignment} ?selected=${media.alignment === alignment}>${alignment}</option>`)}
            </select>
          </label>
          <div class="inline-media-actions">
            <button type="button" ?disabled=${this.readonly} @click=${() => this.#editArticleMedia(media, index)}>Replace image or URL</button>
            <a href=${media.src} target="_blank" rel="noreferrer">Open original</a>
          </div>
        </div>
      </div>
    `;
  }

  #renderInsertionControl(index, label) {
    const expanded = this._insertMenu === index;
    return html`
      <div class=${expanded ? "insert-block expanded" : "insert-block"}>
        <span></span>
        <button
          class="insert-toggle"
          type="button"
          title=${label}
          aria-expanded=${expanded}
          ?disabled=${this.readonly}
          @click=${() => { this._insertMenu = expanded ? undefined : index; }}
        ><uui-icon name="icon-add"></uui-icon><b>${expanded ? "Close add menu" : label}</b></button>
        <span></span>
        ${expanded
          ? html`<div class="insert-menu" role="menu">
              <button type="button" @click=${() => this.#insertArticleBlock(index, "heading")}><uui-icon name="icon-font"></uui-icon><span><strong>Heading</strong><small>Start a new section</small></span></button>
              <button type="button" @click=${() => this.#insertArticleBlock(index, "text")}><uui-icon name="icon-notepad"></uui-icon><span><strong>Text</strong><small>Add a paragraph</small></span></button>
              <button type="button" @click=${() => this.#openMediaComposer(index)}><uui-icon name="icon-picture"></uui-icon><span><strong>Image</strong><small>Upload or choose a URL</small></span></button>
            </div>`
          : nothing}
      </div>
    `;
  }

  #articleMarkdown() {
    return String(canonicalContent(this._working).bodyMarkdown || "");
  }

  #setArticleBlocks(blocks) {
    this.#update("bodyMarkdown", serializeArticleEditorBlocks(blocks));
  }

  #updateArticleBlock(index, value) {
    const blocks = articleEditorBlocks(this.#articleMarkdown());
    if (!blocks[index]) return;
    blocks[index] = { type: "markdown", value: String(value) };
    this.#setArticleBlocks(blocks);
  }

  #updateHeadingBlock(index, level, text) {
    const safeLevel = Math.max(2, Math.min(4, Number(level) || 2));
    this.#updateArticleBlock(index, `${"#".repeat(safeLevel)} ${String(text).replace(/^#+\s*/, "")}`);
  }

  #updateQuoteBlock(index, value) {
    const markdown = String(value)
      .split("\n")
      .map((line) => `> ${line.replace(/^>\s?/, "")}`)
      .join("\n");
    this.#updateArticleBlock(index, markdown);
  }

  #updateListBlock(index, style, value) {
    const lines = String(value).split("\n");
    const markdown = lines
      .map((line, lineIndex) => {
        const text = line.replace(/^\s*(?:[-*+] |\d+\.\s+)/, "");
        return style === "ordered" ? `${lineIndex + 1}. ${text}` : `- ${text}`;
      })
      .join("\n");
    this.#updateArticleBlock(index, markdown);
  }

  #updateArticleMedia(index, path, value) {
    const blocks = articleEditorBlocks(this.#articleMarkdown());
    const block = blocks[index];
    if (block?.type !== "media") return;
    blocks[index] = {
      type: "media",
      value: normalizeArticleMedia({ ...block.value, [path]: value }),
    };
    this.#setArticleBlocks(blocks);
  }

  #insertArticleBlock(index, type) {
    const blocks = articleEditorBlocks(this.#articleMarkdown());
    blocks.splice(index, 0, {
      type: "markdown",
      value: type === "heading" ? "## New section" : "Start writing here.",
    });
    this._insertMenu = undefined;
    this.#setArticleBlocks(blocks);
  }

  #removeArticleBlock(index) {
    const blocks = articleEditorBlocks(this.#articleMarkdown());
    if (!blocks[index]) return;
    const [removed] = blocks.splice(index, 1);
    if (removed.type === "media" && this._mediaComposer?.originalId === removed.value.id) {
      this.#closeMediaComposer();
    }
    this._insertMenu = undefined;
    this.#setArticleBlocks(blocks);
  }

  #moveArticleBlock(index, direction) {
    const blocks = articleEditorBlocks(this.#articleMarkdown());
    const destination = index + direction;
    if (!blocks[index] || destination < 0 || destination >= blocks.length) return;
    const [block] = blocks.splice(index, 1);
    blocks.splice(destination, 0, block);
    this._insertMenu = undefined;
    this.#setArticleBlocks(blocks);
  }

  #startBlockDrag(index, event) {
    this.#dragIndex = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  #endBlockDrag = () => {
    this.#dragIndex = undefined;
  };

  #allowBlockDrop = (event) => {
    if (this.readonly) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  #dropArticleBlock(targetIndex, event) {
    event.preventDefault();
    const sourceIndex = Number.isInteger(this.#dragIndex)
      ? this.#dragIndex
      : Number(event.dataTransfer.getData("text/plain"));
    this.#dragIndex = undefined;
    if (!Number.isInteger(sourceIndex) || sourceIndex === targetIndex) return;
    const blocks = articleEditorBlocks(this.#articleMarkdown());
    const [block] = blocks.splice(sourceIndex, 1);
    if (!block) return;
    blocks.splice(targetIndex, 0, block);
    this.#setArticleBlocks(blocks);
  }

  #renderMediaComposer(canUpload) {
    const composer = this._mediaComposer;
    const preview = this._inlineUpload?.previewUrl || composer.src;
    const uploading = this._uploadingPath === "bodyMarkdown";
    return html`
      <section class="media-composer">
        <header>
          <div>
            <span class="kicker">Usable Assets</span>
            <h3>${composer.originalId ? `Edit inline ${composer.type}` : "Add inline image"}</h3>
            <p>${composer.originalId ? "Update this usage without changing the source asset." : "Upload a new asset or reference an existing Usable image."}</p>
          </div>
          <button class="icon-button" type="button" title="Close" @click=${this.#closeMediaComposer}>×</button>
        </header>
        <div class="composer-grid">
          <div class=${preview ? "composer-preview" : "composer-preview composer-preview-empty"}>
            ${preview
              ? composer.type === "video"
                ? html`<video src=${preview} controls preload="metadata"></video>`
                : html`<img src=${preview} alt=${composer.alt || "New inline image preview"} />`
              : html`<div><uui-icon name="icon-picture"></uui-icon><span>No image selected</span></div>`}
            ${uploading ? html`<div class="image-progress"><uui-loader></uui-loader> Uploading…</div>` : nothing}
          </div>
          <div class="composer-fields">
            ${composer.type === "image" ? html`<div class="image-actions">
              <label class=${canUpload && !this.readonly ? "file-action" : "file-action disabled"}>
                <input
                  type="file"
                  accept="image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp"
                  ?disabled=${this.readonly || !canUpload || uploading}
                  @change=${(event) => void this.#uploadInlineImage(event)}
                />
                <uui-icon name="icon-upload"></uui-icon>
                ${composer.src ? "Replace image" : "Upload image"}
              </label>
              ${!canUpload ? html`<small>Connect with an account that can upload assets.</small>` : nothing}
            </div>` : nothing}
            <label class="field">
              <span>Existing ${composer.type} URL</span>
              <uui-input
                label="Existing image URL"
                type="url"
                .value=${composer.src}
                ?readonly=${this.readonly}
                @input=${(event) => this.#updateMediaComposer("src", event.target.value)}
              ></uui-input>
            </label>
            <label class="field">
              <span>Alternative text · required</span>
              <uui-input
                label="Alternative text"
                .value=${composer.alt}
                ?readonly=${this.readonly}
                @input=${(event) => this.#updateMediaComposer("alt", event.target.value)}
              ></uui-input>
              <small>Describe the image in the context of this article.</small>
            </label>
            <label class="field">
              <span>Caption</span>
              <uui-textarea
                label="Caption"
                .value=${composer.caption}
                rows="3"
                ?readonly=${this.readonly}
                @input=${(event) => this.#updateMediaComposer("caption", event.target.value)}
              ></uui-textarea>
            </label>
            <label class="field">
              <span>Alignment</span>
              <select ?disabled=${this.readonly} @change=${(event) => this.#updateMediaComposer("alignment", event.target.value)}>
                ${["center", "wide", "left", "right"].map(
                  (alignment) => html`<option value=${alignment} ?selected=${composer.alignment === alignment}>${alignment}</option>`,
                )}
              </select>
            </label>
            <div class="composer-actions">
              <uui-button look="secondary" label="Cancel inline image" @click=${this.#closeMediaComposer}>Cancel</uui-button>
              <uui-button
                look="primary"
                color="positive"
                label="Apply inline image"
                ?disabled=${this.readonly || uploading || !composer.src.trim() || !composer.alt.trim()}
                @click=${this.#saveArticleMedia}
              >${composer.originalId ? "Update image" : "Insert image"}</uui-button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  #openMediaComposer(index) {
    this.#revokeInlinePreview();
    this._inlineUpload = undefined;
    this._insertMenu = undefined;
    this._mediaComposer = {
      id: `inline-${crypto.randomUUID()}`,
      type: "image",
      src: "",
      alt: "",
      caption: "",
      placement: "inline",
      alignment: "center",
      insertionIndex: index,
    };
  }

  #editArticleMedia(media, index) {
    this.#revokeInlinePreview();
    this._inlineUpload = undefined;
    this._mediaComposer = { ...clone(media), originalId: media.id, originalIndex: index };
  }

  #updateMediaComposer(path, value) {
    this._mediaComposer = { ...this._mediaComposer, [path]: value };
  }

  #closeMediaComposer = () => {
    this.#revokeInlinePreview();
    this._inlineUpload = undefined;
    this._mediaComposer = undefined;
  };

  #saveArticleMedia = () => {
    const composer = this._mediaComposer;
    if (!composer) return;
    const media = {
      id: composer.id,
      type: composer.type,
      src: composer.src.trim(),
      alt: composer.alt.trim(),
      caption: composer.caption.trim(),
      placement: composer.originalId ? composer.placement : "inline",
      alignment: composer.alignment,
    };
    if (!isSafeMediaUrl(media.src) || !media.alt) {
      this._error = "Choose a safe media URL and add alternative text before inserting.";
      return;
    }
    const blocks = articleEditorBlocks(this.#articleMarkdown());
    if (composer.originalId) {
      const index = blocks.findIndex(
        (block) => block.type === "media" && block.value.id === composer.originalId,
      );
      if (index < 0) {
        this._error = "That inline image is no longer present in the article.";
        return;
      }
      blocks[index] = { type: "media", value: media };
    } else {
      blocks.splice(composer.insertionIndex, 0, { type: "media", value: media });
    }
    this.#setArticleBlocks(blocks);
    this.#closeMediaComposer();
  };

  async #uploadInlineImage(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!/^image\/(?:avif|gif|jpeg|png|svg\+xml|webp)$/i.test(file.type)) {
      this._error = "Choose an AVIF, GIF, JPEG, PNG, SVG, or WebP image.";
      return;
    }
    this.#revokeInlinePreview();
    this._inlineUpload = { previewUrl: URL.createObjectURL(file) };
    this._uploadingPath = "bodyMarkdown";
    this._error = "";
    try {
      const result = await this.#bridgeRequest(
        "upload",
        {
          file,
          regionId: `${this._working.id}.article.bodyMarkdown`,
          title: `${documentTitle(this._working, "article")} · Inline image`,
        },
        120000,
      );
      this.#updateMediaComposer("src", result.url || result.assetPath || "");
      this.#revokeInlinePreview();
      this._inlineUpload = { preparation: result.preparation };
    } catch (error) {
      this._error = errorMessage(error);
    } finally {
      this._uploadingPath = undefined;
    }
  }

  #revokeInlinePreview() {
    if (this._inlineUpload?.previewUrl) URL.revokeObjectURL(this._inlineUpload.previewUrl);
  }

  #renderImageField(content, descriptor, canUpload) {
    const source = String(valueAt(content, `${descriptor.path}.src`) || "");
    const alt = String(valueAt(content, `${descriptor.path}.alt`) || "");
    const localPreview =
      this._imageUpload?.path === descriptor.path ? this._imageUpload.previewUrl : undefined;
    const preview = localPreview || source;
    const uploading = this._uploadingPath === descriptor.path;
    const preparation =
      this._imageUpload?.path === descriptor.path ? this._imageUpload.preparation : undefined;
    const showImage = descriptor.showPath ? Boolean(valueAt(content, descriptor.showPath)) : true;

    return html`
      <section class="image-editor">
        <div class=${preview ? "image-preview" : "image-preview image-preview-empty"}>
          ${preview
            ? html`<img src=${preview} alt=${alt || `${descriptor.label} preview`} />`
            : html`<div><uui-icon name="icon-picture"></uui-icon><span>No image selected</span></div>`}
          ${uploading ? html`<div class="image-progress"><uui-loader></uui-loader> Preparing and uploading…</div>` : nothing}
        </div>

        <div class="image-details">
          <div class="image-heading">
            <div>
              <span class="kicker">Usable Assets</span>
              <h3>${descriptor.label}</h3>
              <p>The binary stays in Usable; this document stores its canonical reference.</p>
            </div>
            ${source
              ? html`<a href=${source} target="_blank" rel="noreferrer">Open original</a>`
              : nothing}
          </div>

          <div class="image-actions">
            <label class=${canUpload && !this.readonly ? "file-action" : "file-action disabled"}>
              <input
                type="file"
                accept="image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp"
                ?disabled=${this.readonly || !canUpload || uploading}
                @change=${(event) => void this.#uploadImage(descriptor, event)}
              />
              <uui-icon name="icon-upload"></uui-icon>
              ${source ? "Replace image" : "Choose image"}
            </label>
            ${descriptor.removable && source
              ? html`<button
                  class="remove-image"
                  type="button"
                  ?disabled=${this.readonly || uploading}
                  @click=${() => this.#removeImage(descriptor)}
                >Remove</button>`
              : nothing}
            ${!canUpload
              ? html`<small>Connect with an account that can upload assets.</small>`
              : nothing}
          </div>

          ${preparation
            ? html`<div class="upload-result">
                <strong>${preparation.optimized ? "Optimized and uploaded" : "Uploaded"}</strong>
                <span>
                  ${preparation.fileName} · ${formatBytes(preparation.originalBytes)} →
                  ${formatBytes(preparation.uploadBytes)}
                  ${preparation.width && preparation.height
                    ? ` · ${preparation.width}×${preparation.height}`
                    : ""}
                </span>
              </div>`
            : nothing}

          <div class="image-fields">
            <label class="field">
              <span>Alternative text ${descriptor.required || source ? "· required" : ""}</span>
              <uui-input
                label="Alternative text"
                .value=${alt}
                ?readonly=${this.readonly}
                @input=${(event) => this.#update(`${descriptor.path}.alt`, event.target.value)}
              ></uui-input>
              <small>Describe the image for people who cannot see it.</small>
            </label>
            ${descriptor.showPath
              ? html`<label class="visibility-control">
                  <input
                    type="checkbox"
                    .checked=${showImage}
                    ?disabled=${this.readonly || !source}
                    @change=${(event) => this.#update(descriptor.showPath, event.target.checked)}
                  />
                  <span>Show this image as the article hero</span>
                </label>`
              : nothing}
          </div>

          <details class="advanced-url">
            <summary>Use an existing image URL</summary>
            <label class="field">
              <span>Canonical image URL</span>
              <uui-input
                label="Canonical image URL"
                type="url"
                .value=${source}
                ?readonly=${this.readonly}
                @input=${(event) => this.#setImageSource(descriptor, event.target.value)}
              ></uui-input>
            </label>
          </details>
        </div>
      </section>
    `;
  }

  async #uploadImage(descriptor, event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!/^image\/(?:avif|gif|jpeg|png|svg\+xml|webp)$/i.test(file.type)) {
      this._error = "Choose an AVIF, GIF, JPEG, PNG, SVG, or WebP image.";
      return;
    }

    this.#revokeUploadPreview();
    this._imageUpload = {
      path: descriptor.path,
      previewUrl: URL.createObjectURL(file),
    };
    this._uploadingPath = descriptor.path;
    this._error = "";
    try {
      const result = await this.#bridgeRequest(
        "upload",
        {
          file,
          regionId: descriptor.regionId(this._working),
          title: `${documentTitle(this._working, contentKind(this._working))} · ${descriptor.label}`,
        },
        120000,
      );
      this.#setImageSource(descriptor, result.url || result.assetPath || "");
      this.#revokeUploadPreview();
      this._imageUpload = {
        path: descriptor.path,
        preparation: result.preparation,
      };
    } catch (error) {
      this._error = errorMessage(error);
    } finally {
      this._uploadingPath = undefined;
    }
  }

  #setImageSource(descriptor, value) {
    const source = String(value || "").trim();
    if (!source && descriptor.removable) {
      this.#removeImage(descriptor);
      return;
    }
    const next = clone(this._working);
    const content = canonicalContent(next);
    setValueAt(content, `${descriptor.path}.src`, source);
    if (descriptor.showPath && source && valueAt(content, descriptor.showPath) === undefined) {
      setValueAt(content, descriptor.showPath, true);
    }
    this.#commitWorking(next);
  }

  #removeImage(descriptor) {
    if (!descriptor.removable) return;
    const next = clone(this._working);
    const content = canonicalContent(next);
    deleteValueAt(content, descriptor.path);
    if (descriptor.showPath) setValueAt(content, descriptor.showPath, false);
    this.#revokeUploadPreview();
    this._imageUpload = undefined;
    this.#commitWorking(next);
  }

  #revokeUploadPreview() {
    if (this._imageUpload?.previewUrl) URL.revokeObjectURL(this._imageUpload.previewUrl);
  }

  #renderNavigation(content) {
    const items = Array.isArray(content.navigation) ? content.navigation : [];
    return html`
      <section class="collection">
        <div class="collection-heading"><h3>Navigation</h3><span>${items.length} links</span></div>
        ${items.map(
          (item, index) => html`
            <div class="collection-row two-column">
              ${this.#compactInput(`navigation.${index}.label`, "Label", item?.label)}
              ${this.#compactInput(`navigation.${index}.href`, "Link", item?.href, "url")}
            </div>
          `,
        )}
      </section>
    `;
  }

  #renderSelectedWork(content) {
    const items = Array.isArray(content.selectedWork) ? content.selectedWork : [];
    return html`
      <section class="collection">
        <div class="collection-heading"><h3>Selected work</h3><span>${items.length} items</span></div>
        ${items.map(
          (item, index) => html`
            <article class="work-card">
              <div class="collection-row two-column">
                ${this.#compactInput(`selectedWork.${index}.name`, "Name", item?.name)}
                ${this.#compactInput(`selectedWork.${index}.role`, "Role", item?.role)}
              </div>
              <label class="field">
                <span>Description</span>
                <uui-textarea
                  label="Description"
                  .value=${String(item?.description || "")}
                  rows="3"
                  ?readonly=${this.readonly}
                  @input=${(event) =>
                    this.#update(`selectedWork.${index}.description`, event.target.value)}
                ></uui-textarea>
              </label>
              <div class="collection-row two-column">
                ${this.#compactInput(`selectedWork.${index}.href`, "Link", item?.href, "url")}
                <label class="field">
                  <span>Accent</span>
                  <select
                    ?disabled=${this.readonly}
                    @change=${(event) =>
                      this.#update(`selectedWork.${index}.accent`, event.target.value)}
                  >
                    ${["coral", "blue", "green", "yellow"].map(
                      (accent) => html`<option value=${accent} ?selected=${item?.accent === accent}>
                        ${accent}
                      </option>`,
                    )}
                  </select>
                </label>
              </div>
            </article>
          `,
        )}
      </section>
    `;
  }

  #renderStringList(content, path, label) {
    const items = Array.isArray(content[path]) ? content[path] : [];
    return html`
      <section class="collection">
        <div class="collection-heading"><h3>${label}</h3><span>${items.length} items</span></div>
        ${items.map(
          (item, index) => html`
            <label class="field list-field">
              <span>${label.replace(/s$/, "")} ${index + 1}</span>
              <uui-textarea
                label="${label} ${index + 1}"
                .value=${String(item || "")}
                rows="3"
                ?readonly=${this.readonly}
                @input=${(event) => this.#update(`${path}.${index}`, event.target.value)}
              ></uui-textarea>
            </label>
          `,
        )}
      </section>
    `;
  }

  #renderTopics(content) {
    const topics = Array.isArray(content.topics) ? content.topics : [];
    return html`
      <label class="field field-wide topics">
        <span>Topics</span>
        <uui-input
          label="Topics"
          .value=${topics.join(", ")}
          ?readonly=${this.readonly}
          @input=${(event) =>
            this.#update(
              "topics",
              event.target.value
                .split(",")
                .map((topic) => topic.trim())
                .filter(Boolean),
            )}
        ></uui-input>
        <small>Separate topics with commas.</small>
      </label>
    `;
  }

  #compactInput(path, label, value, type = "text") {
    return html`
      <label class="field">
        <span>${label}</span>
        <uui-input
          label=${label}
          type=${type}
          .value=${String(value || "")}
          ?readonly=${this.readonly}
          @input=${(event) => this.#update(path, event.target.value)}
        ></uui-input>
      </label>
    `;
  }

  #update(path, value) {
    const next = clone(this._working);
    setValueAt(canonicalContent(next), path, value);
    this.#commitWorking(next);
  }

  #commitWorking(next) {
    this._working = next;
    this.value = JSON.stringify(next, null, 2);
    this.dispatchEvent(new UmbChangeEvent());
    this._workflow = this.#changes().length ? "changed" : "published";
    this._error = "";
    writeCache(cacheKey(next), {
      baseValue: this.#baseValue,
      working: next,
      revisionId: this.#revisionId,
    });
  }

  #changes() {
    if (!this.#baseline || !this._working) return [];
    const kind = contentKind(this._working);
    const before = canonicalContent(this.#baseline);
    const after = canonicalContent(this._working);
    const paths = scalarFields[kind]?.map(([path]) => path) || [];
    const deletePaths = new Set();
    for (const descriptor of imageFields[kind] || []) {
      const beforeImage = valueAt(before, descriptor.path);
      const afterImage = valueAt(after, descriptor.path);
      if (descriptor.removable && beforeImage !== undefined && afterImage === undefined) {
        paths.push(descriptor.path);
        deletePaths.add(descriptor.path);
      } else {
        paths.push(`${descriptor.path}.src`, `${descriptor.path}.alt`);
      }
      if (descriptor.showPath) paths.push(descriptor.showPath);
    }

    if (kind === "global") {
      const count = Math.max(before.navigation?.length || 0, after.navigation?.length || 0);
      for (let index = 0; index < count; index += 1) {
        paths.push(`navigation.${index}.label`, `navigation.${index}.href`);
      }
    }
    if (kind === "home") paths.push("selectedWork");
    if (kind === "about") {
      for (const listPath of ["body", "principles"]) {
        const count = Math.max(before[listPath]?.length || 0, after[listPath]?.length || 0);
        for (let index = 0; index < count; index += 1) paths.push(`${listPath}.${index}`);
      }
    }
    if (kind === "article") {
      paths.push(after.bodyBlocks ? "bodyBlocks" : "bodyMarkdown", "topics");
    }

    return paths
      .filter((path, index) => paths.indexOf(path) === index)
      .filter((path) => !same(valueAt(before, path), valueAt(after, path)))
      .map((path) => ({
        kind: "fragment",
        path,
        beforeRef: JSON.stringify(valueAt(before, path)) ?? "null",
        afterRef: JSON.stringify(valueAt(after, path)) ?? "null",
        ...(deletePaths.has(path) ? { metadata: { operation: "delete" } } : {}),
      }));
  }

  #validationErrors() {
    if (!this._working) return [];
    const kind = contentKind(this._working);
    const content = canonicalContent(this._working);
    const errors = [];
    for (const descriptor of imageFields[kind] || []) {
      const source = String(valueAt(content, `${descriptor.path}.src`) || "").trim();
      const alt = String(valueAt(content, `${descriptor.path}.alt`) || "").trim();
      if (descriptor.required && !source) errors.push(`${descriptor.label} is required.`);
      if (!source && alt) errors.push(`Choose an image for ${descriptor.label.toLowerCase()} or clear its alternative text.`);
      if (source && !alt) errors.push(`Add alternative text for ${descriptor.label.toLowerCase()}.`);
    }
    if (kind === "article") {
      for (const media of canonicalArticleMedia(content)) {
        if (!isSafeMediaUrl(media.src)) errors.push(`Inline media ${media.id} has an invalid URL.`);
        if (media.type === "image" && !media.alt.trim()) {
          errors.push(`Add alternative text for inline image ${media.id}.`);
        }
      }
    }
    return errors;
  }

  #binding() {
    const source = this.#workspaceContext
      ?.getValues?.()
      ?.find((entry) => entry.alias === "syncSource")?.value;
    const match = /^usable:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(String(source || ""));
    if (!match) throw new Error("This projection has no canonical Usable fragment binding.");
    return { workspaceId: match[1], fragmentId: match[2] };
  }

  #isNativeArticleDocument() {
    return Boolean(
      this.#workspaceContext
        ?.getValues?.()
        ?.some((entry) => entry.alias === "articleBody"),
    );
  }

  #receiveNativeValues(values) {
    if (!Array.isArray(values)) return;
    if (values.some((entry) => entry.alias === "articleBody")) {
      this.#receiveNativeArticleValues(values);
    } else {
      this.#receiveNativeBodyValues(values);
    }
  }

  #receiveNativeArticleValues(values) {
    if (!this._working || contentKind(this._working) !== "article") return;
    const fingerprint = nativeArticleFingerprint(values);
    if (fingerprint === this.#nativeArticleBaseline) return;
    this.#nativeArticleBaseline = fingerprint;
    const next = applyNativeArticleValues(this._working, values);
    if (!same(next, this._working)) {
      this.#commitWorking(next);
      this._nativeBodyState = "changed";
    } else {
      this._nativeBodyState = "projected";
    }
  }

  #receiveNativeBodyValues(values) {
    if (!Array.isArray(values)) return;
    const nativeValue = values.find((entry) => entry.alias === "articleBodyBlocks")?.value;
    if (nativeValue === undefined || nativeValue === null || nativeValue === "") return;
    const fingerprint = nativeBlockListFingerprint(nativeValue);
    if (this.#nativeBodyBaseline === undefined) {
      this.#nativeBodyBaseline = fingerprint;
      const body = canonicalBodyFromNativeBlockList(nativeValue);
      const content = this._working ? canonicalContent(this._working) : undefined;
      const expected = content?.bodyBlocks || legacyCanonicalBody(content?.bodyMarkdown || "");
      if (body && content && !same(expected, body)) {
        const next = clone(this._working);
        canonicalContent(next).bodyBlocks = body;
        this.#commitWorking(next);
        this._nativeBodyState = "changed";
      } else {
        this._nativeBodyState = "projected";
      }
      return;
    }
    if (fingerprint === this.#nativeBodyBaseline) return;
    const body = canonicalBodyFromNativeBlockList(nativeValue);
    if (!body || !this._working || contentKind(this._working) !== "article") return;
    const current = canonicalContent(this._working).bodyBlocks;
    if (!same(current, body)) {
      const next = clone(this._working);
      canonicalContent(next).bodyBlocks = body;
      this.#commitWorking(next);
    }
    this._nativeBodyState = "changed";
  }

  #readNativeBodyFromWorkspace() {
    const values = this.#workspaceContext?.getValues?.();
    if (Array.isArray(values)) this.#receiveNativeValues(values);
  }

  #installWorkspaceActions() {
    if (this.#workspaceContext && !this.#requestSaveWrapper) {
      this.#originalRequestSave = this.#workspaceContext.requestSave.bind(this.#workspaceContext);
      this.#requestSaveWrapper = async (options) => {
        if (this.#isNativeArticleDocument()) {
          this.#readNativeBodyFromWorkspace();
          if (this.#changes().length) await this.#saveDraft();
        }
        return this.#originalRequestSave(options);
      };
      this.#workspaceContext.requestSave = this.#requestSaveWrapper;
    }
    if (this.#publishingContext && !this.#saveAndPublishWrapper) {
      this.#originalSaveAndPublish = this.#publishingContext.saveAndPublish.bind(this.#publishingContext);
      this.#saveAndPublishWrapper = async (options) => {
        if (this.#isNativeArticleDocument()) await this.#publishCanonical();
        return this.#originalSaveAndPublish(options);
      };
      this.#publishingContext.saveAndPublish = this.#saveAndPublishWrapper;
    }
  }

  #restoreWorkspaceActions() {
    if (
      this.#workspaceContext?.requestSave === this.#requestSaveWrapper &&
      this.#originalRequestSave
    ) {
      this.#workspaceContext.requestSave = this.#originalRequestSave;
    }
    if (
      this.#publishingContext?.saveAndPublish === this.#saveAndPublishWrapper &&
      this.#originalSaveAndPublish
    ) {
      this.#publishingContext.saveAndPublish = this.#originalSaveAndPublish;
    }
  }

  #saveDraft = async () => {
    this.#readNativeBodyFromWorkspace();
    const changes = this.#changes();
    if (!changes.length) return;
    const validationErrors = this.#validationErrors();
    if (validationErrors.length) {
      this._error = validationErrors.join(" ");
      this._workflow = "error";
      throw new Error(this._error);
    }
    this._workflow = "saving";
    this._error = "";
    try {
      this.#requireBridgeCapability(
        "edit",
        "Connect the Usable session before saving a private draft.",
      );
      const { workspaceId, fragmentId } = this.#binding();
      await this.#assertCanonicalBaseline({ workspaceId, fragmentId });
      const payload = {
        revisionId: this.#revisionId,
        workspaceId,
        summary: `Update ${documentTitle(this._working, contentKind(this._working))} from Umbraco`,
        changes: changes.map((change) => ({ ...change, targetId: fragmentId })),
      };
      let result;
      try {
        result = await this.#bridgeRequest("draft", payload);
      } catch (error) {
        if (!this.#revisionId || !String(error?.message || error).includes("Revision not found")) {
          throw error;
        }
        this.#revisionId = undefined;
        delete payload.revisionId;
        result = await this.#bridgeRequest("draft", payload);
      }
      this.#revisionId = result.revision.id;
      await this.#workspaceContext?.setPropertyValue?.(
        "usableDraftRevisionId",
        this.#revisionId,
      );
      this._workflow = "draft";
      writeCache(cacheKey(this._working), {
        baseValue: this.#baseValue,
        working: this._working,
        revisionId: this.#revisionId,
      });
      return result;
    } catch (error) {
      this._workflow = "error";
      this._error = errorMessage(error);
      throw error;
    }
  };

  #publishCanonical = async () => {
    this.#readNativeBodyFromWorkspace();
    this._workflow = "publishing";
    this._error = "";
    try {
      this.#requireBridgeCapability(
        "publish",
        "Connect a Usable session with publishing access before publishing.",
      );
      const validationErrors = this.#validationErrors();
      if (validationErrors.length) throw new Error(validationErrors.join(" "));
      if (this.#changes().length) {
        await this.#saveDraft();
      } else if (this.#revisionId) {
        const binding = this.#binding();
        await this.#assertCanonicalBaseline(binding);
      }
      if (this.#revisionId) {
        this._workflow = "publishing";
        await this.#bridgeRequest("publish", { revisionId: this.#revisionId });
      }

      this.value = JSON.stringify(this._working, null, 2);
      this.dispatchEvent(new UmbChangeEvent());
      await this.#workspaceContext?.setPropertyValue?.("publishedPayloadJson", this.value);
      this.#baseline = clone(this._working);
      this.#baseValue = this.value;
      this.#revisionId = undefined;
      await this.#workspaceContext?.setPropertyValue?.("usableDraftRevisionId", null);
      const nativeValue = this.#workspaceContext
        ?.getValues?.()
        ?.find((entry) => entry.alias === "articleBodyBlocks")?.value;
      if (nativeValue !== undefined) this.#nativeBodyBaseline = nativeBlockListFingerprint(nativeValue);
      this._nativeBodyState = "projected";
      removeCache(cacheKey(this._working));
      await this.updateComplete;
      this._workflow = "published";
    } catch (error) {
      this._workflow = "error";
      this._error = errorMessage(error);
      throw error;
    }
  };

  #publish = async () => {
    try {
      if (this.#publishingContext?.saveAndPublish) {
        await this.#publishingContext.saveAndPublish();
      } else {
        await this.#publishCanonical();
        await this.#originalRequestSave?.();
      }
    } catch {
      // #publishCanonical already exposes a useful message in the panel.
    }
  };

  #bridgeLoaded = () => {
    const frame = this.renderRoot.querySelector("#usable-bridge");
    this.#bridgeOrigin = new URL(frame.src).origin;
    window.setTimeout(() => {
      void this.#bootstrapBridgeSession();
    }, 250);
  };

  async #bootstrapBridgeSession() {
    if (this.#federating) return;
    this.#federating = true;
    try {
      const response = await requestFederatedCmsSession(this, UMB_AUTH_CONTEXT);
      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.sessionToken === "string") {
        await this.#bridgeRequest("adopt-session", { sessionToken: payload.sessionToken });
        this._bridgeError = "";
        return;
      }

      if (response.status >= 500) {
        this._bridgeError = payload.message || "Usable identity is temporarily unavailable.";
      }
      await this.#bridgeRequest("session", {});
      this._bridgeError = "";
    } catch (error) {
      this._bridgeError = errorMessage(error);
      await this.#bridgeRequest("session", {}).catch(() => undefined);
    } finally {
      this.#federating = false;
    }
  }

  async #assertCanonicalBaseline({ workspaceId, fragmentId }) {
    const result = await this.#bridgeRequest("content", {
      fragmentIds: [fragmentId],
      workspaceId,
    });
    const fragment = result?.fragments?.find((candidate) => candidate.id === fragmentId);
    const canonical = parseBrokerContent(fragment?.content);
    if (!canonical || !same(canonical, canonicalContent(this.#baseline))) {
      throw new Error(
        "Usable content changed after this projection was loaded. Refresh the Umbraco projection before saving or publishing.",
      );
    }
  }

  #requireBridgeCapability(capability, message) {
    if (
      !this._bridgeSession?.authorized ||
      !this._bridgeSession?.capabilities?.[capability]
    ) {
      throw new Error(message);
    }
  }

  #bridgeRequest(operation, payload, timeoutMs = 45000) {
    const frame = this.renderRoot.querySelector("#usable-bridge");
    if (!frame?.contentWindow || !this.#bridgeOrigin) {
      return Promise.reject(new Error("The Usable session bridge is not ready."));
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("The Usable CMS request timed out."));
      }, timeoutMs);
      this.#pending.set(requestId, {
        resolve: (value) => {
          window.clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });
      frame.contentWindow.postMessage(
        { type: `${BRIDGE_MESSAGE}:request`, requestId, operation, payload },
        this.#bridgeOrigin,
      );
    });
  }

  #receiveBridgeMessage = (event) => {
    const frame = this.renderRoot.querySelector("#usable-bridge");
    if (!this.#bridgeOrigin || event.origin !== this.#bridgeOrigin) return;
    if (event.source !== frame?.contentWindow) return;
    if (event.data?.type === `${BRIDGE_MESSAGE}:status`) {
      this._bridgeSession = event.data.session;
      if (event.data.session?.authorized) this._bridgeError = "";
      if (event.data.session?.signedIn === false) void this.#bootstrapBridgeSession();
      return;
    }
    if (event.data?.type !== `${BRIDGE_MESSAGE}:response`) return;
    const pending = this.#pending.get(event.data.requestId);
    if (!pending) return;
    this.#pending.delete(event.data.requestId);
    if (event.data.ok) {
      if (event.data.result?.signedIn !== undefined) {
        this._bridgeSession = event.data.result;
        if (event.data.result?.authorized) this._bridgeError = "";
      }
      pending.resolve(event.data.result);
    } else {
      pending.reject(new Error(event.data.error || "The Usable CMS request failed."));
    }
  };

  #workflowCopy(changeCount) {
    if (this._workflow === "published") return "This projection matches the published Usable fragment.";
    if (this._workflow === "draft") return "A private draft revision is saved in the Usable workspace.";
    if (this._workflow === "publishing") return "Publishing in Usable, then refreshing this projection…";
    if (this._workflow === "saving") return "Saving a private revision in the Usable workspace…";
    if (changeCount) return "Review the typed fields, save a draft, then publish explicitly.";
    return "Connect to Usable to edit canonical content.";
  }

  static styles = css`
    :host { display: block; }
    .editor-shell { border: 1px solid var(--uui-color-border); border-radius: 9px; overflow: hidden; }
    .hero { align-items: flex-start; background: linear-gradient(135deg, #f6f3ff, #f5faf7); display: flex; gap: 20px; justify-content: space-between; padding: 22px 24px; }
    .hero h2 { color: var(--uui-color-text); font-size: 22px; line-height: 1.15; margin: 5px 0 6px; }
    .hero p { color: var(--uui-color-text-alt); margin: 0; }
    .compact-hero { padding: 18px 20px; }
    .compact-hero h2 { font-size: 18px; }
    .kicker { color: #6750a4; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .status { background: #e7e7eb; border-radius: 999px; color: #4c4d58; font-size: 11px; font-weight: 800; padding: 6px 10px; text-transform: uppercase; white-space: nowrap; }
    .status-published { background: #dff4e5; color: #23673a; }
    .status-draft { background: #fff0c6; color: #715000; }
    .status-error { background: #ffe4e2; color: #9f2b24; }
    #usable-bridge { border: 0; border-bottom: 1px solid var(--uui-color-border); display: block; height: 48px; width: 100%; }
    .callout { margin: 20px 24px 0; padding: 12px 14px; border-radius: 6px; }
    .native-editor-note { align-items: center; background: #f3f8f4; border-top: 1px solid var(--uui-color-border); display: flex; gap: 12px; padding: 14px 20px; }
    .native-editor-note uui-icon { color: #24733f; font-size: 20px; }
    .native-editor-note div { display: grid; gap: 2px; }
    .native-editor-note span { color: var(--uui-color-text-alt); font-size: 12px; }
    .native-article-shell .image-editor { padding: 20px; }
    .error { background: #fff1f0; color: #9f2b24; }
    .warning { background: #fff7d6; color: #6b5000; }
    .field-grid { display: grid; gap: 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 24px; }
    .field { display: grid; gap: 7px; min-width: 0; }
    .field > span { color: var(--uui-color-text); font-size: 13px; font-weight: 700; }
    .field-wide { grid-column: 1 / -1; }
    uui-input, uui-textarea { width: 100%; }
    .article-body-editor { border-top: 1px solid var(--uui-color-border); padding: 24px; }
    .native-body-workflow { align-items: flex-start; border-top: 1px solid var(--uui-color-border); display: grid; gap: 18px; grid-template-columns: 1fr auto; padding: 22px 24px; }
    .native-body-workflow h3 { font-size: 18px; margin: 3px 0 5px; }
    .native-body-workflow p { color: var(--uui-color-text-alt); margin: 0; max-width: 760px; }
    .native-body-workflow .legacy-source { grid-column: 1 / -1; margin-top: 0; width: 100%; }
    .legacy-source pre { background: var(--uui-color-surface-alt); border-radius: 5px; max-height: 260px; overflow: auto; padding: 12px; white-space: pre-wrap; }
    .article-body-heading { align-items: flex-start; display: flex; gap: 18px; justify-content: space-between; margin-bottom: 18px; }
    .article-body-heading h3 { font-size: 19px; margin: 3px 0 4px; }
    .article-body-heading p { color: var(--uui-color-text-alt); margin: 0; }
    .editor-session-note { align-items: center; background: #eef4ff; border: 1px solid #c5d7f5; border-radius: 6px; color: #26466f; display: flex; font-size: 12px; gap: 8px; margin: -4px 0 16px; padding: 10px 12px; }
    .media-count, .alignment-badge { background: var(--uui-color-surface-alt); border-radius: 999px; color: var(--uui-color-text-alt); font-size: 11px; font-weight: 800; padding: 5px 9px; text-transform: uppercase; white-space: nowrap; }
    .article-flow { background: var(--uui-color-surface-alt); border: 1px solid var(--uui-color-border); border-radius: 8px; padding: 12px 18px; }
    .article-empty { color: var(--uui-color-text-alt); padding: 22px; text-align: center; }
    .content-block { background: var(--uui-color-surface); border: 1px solid var(--uui-color-border); border-radius: 7px; box-shadow: 0 1px 2px rgba(0, 0, 0, .035); overflow: hidden; }
    .content-block:focus-within { border-color: var(--uui-color-interactive); box-shadow: 0 0 0 1px var(--uui-color-interactive); }
    .block-toolbar { align-items: center; background: #fafafa; border-bottom: 1px solid var(--uui-color-border); display: flex; gap: 8px; min-height: 38px; padding: 4px 7px; }
    .drag-handle, .block-actions button { align-items: center; background: transparent; border: 0; border-radius: 4px; color: var(--uui-color-text-alt); cursor: pointer; display: inline-flex; font: 700 12px/1 ui-sans-serif, system-ui, sans-serif; gap: 6px; min-height: 28px; padding: 5px 7px; }
    .drag-handle:hover, .block-actions button:hover:not(:disabled) { background: var(--uui-color-surface-alt); color: var(--uui-color-interactive); }
    .drag-handle span { font-size: 0; }
    .drag-handle:focus-visible span { font-size: 11px; }
    .block-kind { color: var(--uui-color-text-alt); font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .block-actions { display: flex; gap: 2px; margin-left: auto; }
    .block-actions .danger { color: var(--uui-color-danger); }
    .block-actions button:disabled, .drag-handle:disabled { cursor: not-allowed; opacity: .35; }
    .markdown-block { padding: 16px; }
    .heading-fields { display: grid; gap: 8px; grid-template-columns: 76px 1fr; }
    .list-style { justify-self: start; min-width: 160px; }
    .metadata-block { background: #fffbeb; color: var(--uui-color-text-alt); font-size: 12px; padding: 13px 16px; }
    .metadata-block summary { cursor: pointer; font-weight: 700; }
    .metadata-block pre { overflow: auto; white-space: pre-wrap; }
    .insert-block { align-items: center; display: grid; gap: 8px; grid-template-columns: 1fr auto 1fr; min-height: 42px; position: relative; }
    .insert-block > span { border-top: 1px solid var(--uui-color-border); }
    .insert-toggle { align-items: center; background: transparent; border: 0; border-radius: 4px; color: var(--uui-color-interactive); cursor: pointer; display: inline-flex; font: inherit; gap: 5px; padding: 5px 7px; }
    .insert-toggle b { font-size: 0; }
    .insert-toggle:hover, .insert-toggle:focus-visible, .insert-block.expanded .insert-toggle { background: var(--uui-color-surface); box-shadow: 0 0 0 1px var(--uui-color-border); }
    .insert-toggle:hover b, .insert-toggle:focus-visible b, .insert-block.expanded .insert-toggle b { font-size: 11px; }
    .insert-toggle:disabled { color: var(--uui-color-text-alt); cursor: not-allowed; opacity: .55; }
    .insert-menu { background: var(--uui-color-surface); border: 1px solid var(--uui-color-border); border-radius: 7px; box-shadow: 0 8px 22px rgba(0, 0, 0, .14); display: grid; gap: 4px; grid-column: 2; min-width: 240px; padding: 6px; position: absolute; top: 38px; z-index: 3; }
    .insert-menu button { align-items: center; background: transparent; border: 0; border-radius: 5px; color: var(--uui-color-text); cursor: pointer; display: grid; gap: 9px; grid-template-columns: 24px 1fr; padding: 9px; text-align: left; }
    .insert-menu button:hover, .insert-menu button:focus-visible { background: var(--uui-color-surface-alt); }
    .insert-menu button > span { display: grid; gap: 2px; }
    .insert-menu small { font-weight: 400; }
    .inline-media-card { display: grid; gap: 16px; grid-template-columns: minmax(180px, .72fr) minmax(240px, 1.28fr); overflow: hidden; }
    .inline-media-preview { align-items: center; background: repeating-conic-gradient(#eee 0 25%, #fafafa 0 50%) 50% / 20px 20px; display: flex; justify-content: center; min-height: 180px; }
    .inline-media-preview img, .inline-media-preview video { display: block; height: 100%; max-height: 260px; object-fit: contain; width: 100%; }
    .inline-media-details { align-content: start; display: grid; gap: 12px; padding: 16px 16px 16px 0; }
    .inline-media-title { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }
    .inline-media-title h4 { font-size: 16px; margin: 3px 0 0; }
    .inline-media-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
    .inline-media-actions button, .inline-media-actions a, .icon-button { background: var(--uui-color-surface); border: 1px solid var(--uui-color-border-emphasis); border-radius: 4px; color: var(--uui-color-interactive); cursor: pointer; font: 700 12px/1 ui-sans-serif, system-ui, sans-serif; padding: 9px 11px; text-decoration: none; }
    .inline-media-actions .danger { color: var(--uui-color-danger); }
    .media-composer { background: #faf9ff; border: 1px solid #cfc7e6; border-radius: 8px; margin-top: 18px; padding: 18px; }
    .media-composer > header { align-items: flex-start; display: flex; gap: 18px; justify-content: space-between; }
    .media-composer h3 { font-size: 18px; margin: 3px 0 4px; }
    .media-composer header p { color: var(--uui-color-text-alt); margin: 0; }
    .icon-button { font-size: 20px; line-height: 1; padding: 6px 9px; }
    .composer-grid { display: grid; gap: 18px; grid-template-columns: minmax(220px, .8fr) minmax(320px, 1.2fr); margin-top: 16px; }
    .composer-preview { align-items: center; aspect-ratio: 4 / 3; background: repeating-conic-gradient(#eee 0 25%, #fafafa 0 50%) 50% / 20px 20px; border: 1px solid var(--uui-color-border); border-radius: 7px; display: flex; justify-content: center; overflow: hidden; position: relative; }
    .composer-preview img, .composer-preview video { display: block; height: 100%; object-fit: contain; width: 100%; }
    .composer-preview-empty > div { align-items: center; color: var(--uui-color-text-alt); display: grid; gap: 8px; justify-items: center; }
    .composer-fields { display: grid; gap: 13px; }
    .composer-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .markdown-source { border-top: 1px solid var(--uui-color-border); margin-top: 20px; padding-top: 16px; }
    .markdown-source summary { color: var(--uui-color-text); cursor: pointer; font-size: 13px; font-weight: 800; }
    .markdown-source > p { color: var(--uui-color-text-alt); font-size: 12px; margin: 7px 0 10px; }
    .image-editor { border-top: 1px solid var(--uui-color-border); display: grid; gap: 22px; grid-template-columns: minmax(240px, .8fr) minmax(320px, 1.2fr); padding: 24px; }
    .image-preview { align-items: center; aspect-ratio: 4 / 3; background: repeating-conic-gradient(#eee 0 25%, #fafafa 0 50%) 50% / 20px 20px; border: 1px solid var(--uui-color-border); border-radius: 8px; display: flex; justify-content: center; overflow: hidden; position: relative; }
    .image-preview img { display: block; height: 100%; object-fit: contain; width: 100%; }
    .image-preview-empty > div { align-items: center; color: var(--uui-color-text-alt); display: grid; gap: 8px; justify-items: center; }
    .image-preview-empty uui-icon { font-size: 30px; }
    .image-progress { align-items: center; backdrop-filter: blur(3px); background: rgba(255, 255, 255, .88); display: flex; font-size: 13px; font-weight: 700; gap: 9px; inset: 0; justify-content: center; position: absolute; }
    .image-details { align-content: start; display: grid; gap: 16px; }
    .image-heading { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; }
    .image-heading h3 { font-size: 19px; margin: 3px 0 4px; }
    .image-heading p { color: var(--uui-color-text-alt); margin: 0; }
    .image-heading a { color: var(--uui-color-interactive); font-size: 12px; white-space: nowrap; }
    .image-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; }
    .file-action, .remove-image { align-items: center; border: 1px solid var(--uui-color-border-emphasis); border-radius: 4px; cursor: pointer; display: inline-flex; font: 700 13px/1 ui-sans-serif, system-ui, sans-serif; gap: 7px; min-height: 36px; padding: 0 12px; }
    .file-action { background: var(--uui-color-interactive); border-color: var(--uui-color-interactive); color: var(--uui-color-selected-contrast); }
    .file-action input { height: 1px; opacity: 0; overflow: hidden; position: absolute; width: 1px; }
    .file-action.disabled { cursor: not-allowed; opacity: .45; }
    .remove-image { background: var(--uui-color-surface); color: var(--uui-color-danger); }
    .remove-image:disabled { cursor: not-allowed; opacity: .45; }
    .upload-result { background: #e8f6ec; border-radius: 6px; color: #246c3a; display: grid; gap: 2px; padding: 10px 12px; }
    .upload-result span { font-size: 12px; }
    .image-fields { display: grid; gap: 14px; }
    .visibility-control { align-items: center; display: flex; font-size: 13px; font-weight: 700; gap: 9px; }
    .visibility-control input { height: 17px; width: 17px; }
    .advanced-url { border-top: 1px solid var(--uui-color-border); padding-top: 12px; }
    .advanced-url summary { color: var(--uui-color-text-alt); cursor: pointer; font-size: 12px; font-weight: 700; margin-bottom: 12px; }
    .collection { border-top: 1px solid var(--uui-color-border); padding: 22px 24px 24px; }
    .collection-heading { align-items: baseline; display: flex; justify-content: space-between; margin-bottom: 16px; }
    .collection-heading h3 { font-size: 16px; margin: 0; }
    .collection-heading span, small { color: var(--uui-color-text-alt); font-size: 12px; }
    .collection-row { display: grid; gap: 16px; margin-bottom: 14px; }
    .two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .work-card { background: var(--uui-color-surface-alt); border-radius: 7px; margin-top: 12px; padding: 18px; }
    .work-card .field { margin-bottom: 14px; }
    .list-field + .list-field { margin-top: 14px; }
    select { background: var(--uui-color-surface); border: 1px solid var(--uui-color-border); border-radius: 3px; color: var(--uui-color-text); font: inherit; min-height: 40px; padding: 0 10px; text-transform: capitalize; }
    .topics { border-top: 1px solid var(--uui-color-border); padding: 22px 24px; }
    .workflow-bar { align-items: center; background: var(--uui-color-surface-alt); border-top: 1px solid var(--uui-color-border); display: flex; gap: 10px; padding: 16px 24px; position: sticky; bottom: 0; }
    .workflow-note { display: grid; margin-right: auto; }
    .workflow-note span { color: var(--uui-color-text-alt); font-size: 12px; }
    @media (max-width: 700px) { .field-grid, .two-column, .image-editor, .inline-media-card, .composer-grid { grid-template-columns: 1fr; } .inline-media-details { padding: 0 16px 16px; } .field-wide { grid-column: auto; } .workflow-bar { align-items: stretch; flex-direction: column; } .workflow-note { margin: 0 0 6px; } }
  `;
}

if (!customElements.get("olavur-inline-rich-text")) {
  customElements.define("olavur-inline-rich-text", OlavurInlineRichTextEditor);
}
if (!customElements.get("olavur-structured-content-editor")) {
  customElements.define("olavur-structured-content-editor", OlavurStructuredContentEditor);
}

const mediaDirectivePattern = /<!--\s*usable-media:([^\s]+)\s*-->/g;

function articleMediaDirective(media) {
  return `<!-- usable-media:${encodeURIComponent(JSON.stringify(normalizeArticleMedia(media)))} -->`;
}

function parseArticleMarkdown(markdown) {
  const segments = [];
  let cursor = 0;
  for (const match of markdown.matchAll(mediaDirectivePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "markdown", value: markdown.slice(cursor, index) });
    const media = decodeArticleMedia(match[1]);
    if (media) segments.push({ type: "media", value: media });
    else segments.push({ type: "markdown", value: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < markdown.length) segments.push({ type: "markdown", value: markdown.slice(cursor) });
  return segments;
}

function articleMediaBlocks(markdown) {
  return parseArticleMarkdown(markdown)
    .filter((segment) => segment.type === "media")
    .map((segment) => segment.value);
}

function canonicalArticleMedia(content) {
  if (Array.isArray(content.bodyBlocks?.blocks)) {
    return content.bodyBlocks.blocks
      .filter((block) => block?.type === "media" && block.media)
      .map((block) => block.media);
  }
  return articleMediaBlocks(String(content.bodyMarkdown || ""));
}

function legacyCanonicalBody(markdown) {
  let ordinal = 0;
  const blocks = [];
  let body = [];
  const flushBody = () => {
    if (!body.length) return;
    ordinal += 1;
    const value = body.join("\n\n");
    blocks.push({
      id: stableCanonicalBlockId("text", value, ordinal),
      type: "richText",
      markdown: value,
    });
    body = [];
  };
  for (const block of articleEditorBlocks(String(markdown || ""))) {
    if (block.type === "media") {
      flushBody();
      blocks.push({ id: block.value.id, type: "media", media: block.value });
      continue;
    }
    const value = String(block.value).trim();
    const model = markdownBlockModel(value);
    if (model.kind === "Heading") {
      flushBody();
      ordinal += 1;
      blocks.push({
        id: stableCanonicalBlockId("heading", value, ordinal),
        type: "heading",
        level: model.level,
        text: model.text,
      });
    } else {
      body.push(value);
    }
  }
  flushBody();
  return {
    version: 1,
    blocks,
  };
}

function stableCanonicalBlockId(kind, value, ordinal) {
  let hash = 2166136261;
  for (const character of `${kind}\u0000${value}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `block-${(hash >>> 0).toString(36)}-${ordinal}`;
}

function articleMarkdownForEditor(markdown) {
  let index = 0;
  return markdown.replace(mediaDirectivePattern, (directive, encoded) => {
    const media = decodeArticleMedia(encoded);
    if (!media) return directive;
    index += 1;
    const label = (media.caption || media.alt || "Untitled media").replace(/[{}\n]+/g, " ").trim();
    return `{{media:${index} · ${media.type === "image" ? "Image" : "Video"} · ${label}}}`;
  });
}

function articleMarkdownFromEditor(markdown, mediaBlocks) {
  return markdown.replace(/\{\{media:(\d+)(?:\s*·[^}]*)?}}/g, (marker, rawIndex) => {
    const media = mediaBlocks[Number(rawIndex) - 1];
    return media ? articleMediaDirective(media) : marker;
  });
}

function insertArticleMedia(markdown, media, index = markdown.length) {
  const insertionPoint = Math.max(0, Math.min(index, markdown.length));
  const before = markdown.slice(0, insertionPoint).trimEnd();
  const after = markdown.slice(insertionPoint).trimStart();
  return [before, articleMediaDirective(media), after].filter(Boolean).join("\n\n");
}

function replaceArticleMedia(markdown, media) {
  return markdown.replace(mediaDirectivePattern, (directive, encoded) => {
    const current = decodeArticleMedia(encoded);
    return current?.id === media.id ? articleMediaDirective(media) : directive;
  });
}

function removeArticleMedia(markdown, mediaId) {
  return markdown
    .replace(mediaDirectivePattern, (directive, encoded) => {
      const current = decodeArticleMedia(encoded);
      return current?.id === mediaId ? "" : directive;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeArticleMedia(encoded) {
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    if (!parsed || typeof parsed !== "object") return undefined;
    if (typeof parsed.id !== "string" || !/^[a-zA-Z0-9_-]{3,100}$/.test(parsed.id)) return undefined;
    if (parsed.type !== "image" && parsed.type !== "video") return undefined;
    if (typeof parsed.src !== "string" || !isSafeMediaUrl(parsed.src)) return undefined;
    return normalizeArticleMedia({
      id: parsed.id,
      type: parsed.type,
      src: parsed.src,
      alt: typeof parsed.alt === "string" ? parsed.alt : "",
      caption: typeof parsed.caption === "string" ? parsed.caption : "",
      placement: parsed.placement === "hero" ? "hero" : "inline",
      alignment: ["wide", "left", "right"].includes(parsed.alignment) ? parsed.alignment : "center",
    });
  } catch {
    return undefined;
  }
}

function normalizeArticleMedia(media) {
  return {
    id: media.id,
    type: media.type,
    src: media.src.trim(),
    alt: media.alt.trim(),
    caption: media.caption.trim(),
    placement: media.placement,
    alignment: media.alignment,
  };
}

function isSafeMediaUrl(value) {
  const trimmed = String(value || "").trim();
  return trimmed.startsWith("/") || /^https?:\/\//i.test(trimmed);
}

function articleEditorBlocks(markdown) {
  return splitArticleEditorBlocks(markdown, (value) => {
    const parsed = parseArticleMarkdown(value);
    return parsed.length === 1 && parsed[0]?.type === "media" ? parsed[0].value : undefined;
  });
}

function serializeArticleEditorBlocks(blocks) {
  return joinArticleEditorBlocks(blocks, articleMediaDirective);
}

function markdownBlockModel(markdown) {
  return describeMarkdownBlock(markdown);
}

function bridgeUrl() {
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://localhost:3000/cms/umbraco-bridge";
  }
  return "https://www.olavurellefsen.com/cms/umbraco-bridge";
}

function parsePayload(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseBrokerContent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  let candidate = value.trim();
  if (candidate.startsWith("---")) {
    const closing = candidate.indexOf("\n---", 3);
    if (closing >= 0) candidate = candidate.slice(closing + 4).trim();
  }
  if (candidate.startsWith("```")) {
    const firstNewline = candidate.indexOf("\n");
    const closing = candidate.lastIndexOf("```");
    if (firstNewline >= 0 && closing > firstNewline) {
      candidate = candidate.slice(firstNewline + 1, closing).trim();
    }
  }
  return parsePayload(candidate);
}

function canonicalContent(payload) {
  return payload?.content && typeof payload.content === "object" ? payload.content : payload;
}

function contentKind(payload) {
  if (payload?.id === "global" || !payload?.content) return "global";
  const content = canonicalContent(payload);
  if (["home", "writing", "about"].includes(payload.id)) return payload.id;
  return content?.type === "article" ? "article" : payload.id;
}

function documentTitle(payload, kind) {
  const content = canonicalContent(payload);
  if (kind === "global") return "Global site settings";
  return content?.title || payload?.title || payload?.id || "Projected content";
}

function valueAt(target, path) {
  return path.split(".").reduce((value, part) => value?.[part], target);
}

function setValueAt(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const nextIsIndex = /^\d+$/.test(parts[index + 1]);
    cursor[part] ??= nextIsIndex ? [] : {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function deleteValueAt(target, path) {
  const parts = path.split(".");
  const key = parts.pop();
  const parent = parts.reduce((value, part) => value?.[part], target);
  if (parent && key) delete parent[key];
}

function clone(value) {
  return structuredClone(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cacheKey(payload) {
  return `olavur-usable-draft:${payload?.id || "global"}`;
}

function readCache(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null");
  } catch {
    return undefined;
  }
}

function writeCache(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function removeCache(key) {
  window.localStorage.removeItem(key);
}

function workflowLabel(value) {
  return {
    loading: "Loading",
    published: "Published",
    changed: "Local changes",
    saving: "Saving draft",
    draft: "Draft saved",
    publishing: "Publishing",
    error: "Needs attention",
  }[value] || value;
}

function errorMessage(value) {
  return value instanceof Error ? value.message : String(value || "The CMS operation failed.");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}
