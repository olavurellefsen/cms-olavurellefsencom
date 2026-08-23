import { css, html } from "@umbraco-cms/backoffice/external/lit";
import { UmbLitElement } from "@umbraco-cms/backoffice/lit-element";
import { selectedWorkCard } from "./selected-work-card.js";

export default class OlavurSelectedWorkBlock extends UmbLitElement {
  static properties = {
    content: { attribute: false },
    config: { attribute: false },
  };

  render() {
    const card = selectedWorkCard(this.content);
    const editPath = this.config?.editContentPath || "#";
    return html`
      <a
        class="card"
        href=${editPath}
        style=${`--work-accent: ${card.accentColor}`}
        aria-label=${`Edit ${card.name}`}
      >
        <span class="accent" aria-hidden="true"></span>
        <span class="identity">
          <strong>${card.name}</strong>
          <span class="role">${card.role}</span>
        </span>
        <span class="description">${card.description}</span>
        <span class="meta">
          <span class="accent-name">${card.accent}</span>
          <span class="link"><uui-icon name="icon-link"></uui-icon>${card.linkLabel}</span>
        </span>
        <uui-icon class="edit" name="icon-edit" aria-hidden="true"></uui-icon>
      </a>
    `;
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
      width: 100%;
    }

    .card {
      align-items: center;
      background: var(--uui-color-surface);
      border-radius: 6px;
      color: var(--uui-color-text);
      display: grid;
      gap: 5px 16px;
      grid-template-columns: 5px minmax(150px, 0.72fr) minmax(220px, 1.45fr) minmax(130px, 0.62fr) 22px;
      min-height: 58px;
      overflow: hidden;
      padding: 0 14px 0 0;
      text-decoration: none;
    }

    .card:hover {
      background: var(--uui-color-surface-emphasis);
    }

    .card:focus-visible {
      outline: 2px solid var(--uui-color-focus);
      outline-offset: -2px;
    }

    .accent {
      align-self: stretch;
      background: var(--work-accent);
      grid-row: 1 / span 2;
    }

    .identity {
      align-self: end;
      display: flex;
      gap: 8px;
      min-width: 0;
    }

    strong,
    .role,
    .description,
    .link {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      font-size: 14px;
    }

    .role {
      color: var(--uui-color-text-alt);
      font-size: 12px;
    }

    .description {
      align-self: end;
      color: var(--uui-color-text-alt);
      font-size: 12px;
    }

    .meta {
      align-self: end;
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      min-width: 0;
    }

    .accent-name {
      color: var(--work-accent);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .link {
      align-items: center;
      color: var(--uui-color-text-alt);
      display: flex;
      font-size: 11px;
      gap: 4px;
    }

    .link uui-icon {
      flex: 0 0 auto;
      font-size: 12px;
    }

    .edit {
      color: var(--uui-color-text-alt);
      grid-column: 5;
      grid-row: 1 / span 2;
      opacity: 0;
    }

    .card:hover .edit,
    .card:focus-visible .edit {
      opacity: 1;
    }

    .identity,
    .description,
    .meta {
      grid-row: 1;
    }

    .role,
    .accent-name,
    .link {
      align-self: start;
      grid-row: 2;
    }

    @media (max-width: 850px) {
      .card {
        gap: 3px 12px;
        grid-template-columns: 5px minmax(140px, 0.8fr) minmax(180px, 1.2fr) 22px;
      }

      .meta {
        display: none;
      }

      .edit {
        grid-column: 4;
      }
    }

    @media (max-width: 600px) {
      .card {
        grid-template-columns: 5px minmax(0, 1fr) 22px;
        padding-block: 9px;
      }

      .description {
        display: none;
      }

      .edit {
        grid-column: 3;
      }
    }
  `;
}

if (!customElements.get("olavur-selected-work-block")) {
  customElements.define("olavur-selected-work-block", OlavurSelectedWorkBlock);
}
