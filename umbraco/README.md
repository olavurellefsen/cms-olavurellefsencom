# Umbraco sidecar

This is an optional Umbraco 18/.NET 10 editing and rendering projection for the content owned by Usable. Usable workspace fragments are the only source of truth. Umbraco's local documents are rebuildable editor/cache state and do not become a second content authority.

## First run

```sh
export OlavurSync__ApiKey="$(openssl rand -hex 32)"
export USABLE_CMS_SERVER_TOKEN=... # server-only canonical read credential
npm run umbraco:dev
```

Open the printed local URL, complete Umbraco's installation wizard, and sign in to `/umbraco`.
Development uses SQLite under the ignored `umbraco/Data` directory. Production uses one Fly
machine and a persistent volume because this database contains backoffice identity/configuration
and a rebuildable projection; Usable workspace fragments remain the durable content authority.
Fly volume snapshots provide infrastructure recovery, while `npm run cms:sync -- --from usable
--to umbraco --force` rebuilds the complete content projection.

The first authenticated projection refresh creates an **Olavur synchronized document** type and one Umbraco document for the global settings plus one per page/article. Each document carries its canonical Usable fragment UUID, stable ID/path metadata, and the complete validated JSON payload. Articles expose **Article body (native blocks)** as an Umbraco Block List with heading, Tiptap rich-text, list, quote, and Usable-image element types. The separate **Olavur structured content** panel owns the Usable draft/publish workflow while the lossless neutral envelope remains underneath.

The portable article contract is `bodyBlocks: { version: 1, blocks: [...] }`. Raw Umbraco Block List JSON is projection state only and is translated at the boundary. Existing `bodyMarkdown` content is projected into section-sized native blocks and remains a read-compatible migration fallback; the first canonical Umbraco edit adds `bodyBlocks` to that article's existing page fragment.

Editing uses the same Usable draft/publish boundary as the bespoke CMS:

1. the native property editor loads the Usable broker through an exact-origin bridge on `http://localhost:3000`;
2. **Save draft** creates or updates a private revision in the Usable workspace using the signed-in human editor's permissions and CSRF-protected broker session;
3. **Publish** publishes that Usable revision explicitly;
4. the editor then requests an Umbraco save, whose server handler reads the canonical fragment and accepts the local projection only when it matches the published Usable content;
5. stale, local-only, or merely drafted values are rejected. The server token cannot publish and no longer performs direct fragment PATCH requests.

The bridge accepts messages only from the exact local backoffice origins `http://127.0.0.1:5099` and `http://localhost:5099`. If either port or hostname changes, configure and register the exact deliberate development origins; do not use a wildcard.

In production, the bridge derives its one allowed parent from the server-only
`UMBRACO_BACKOFFICE_ORIGIN` value on the public app. The checked-in Fly configuration uses
`https://olavurellefsen-umbraco.fly.dev`.

New pages must be created through the Usable CMS page/template flow so the fragment and manifest binding are created atomically. Refresh the projection afterward. Umbraco cannot create an unbound page.

## Synchronization

Configure the same API key for the CLI:

```sh
export UMBRACO_ORIGIN=http://localhost:5000
export UMBRACO_SYNC_API_KEY="$OlavurSync__ApiKey"
export USABLE_CMS_SERVER_TOKEN=... # server-only canonical read credential

npm run cms:sync -- --from usable --to umbraco --dry-run
npm run cms:sync -- --from usable --to umbraco
npm run cms:audit-topology
```

This command is a one-way projection refresh, not peer synchronization. It discovers all active Usable page fragments, includes their full UUIDs in the projection metadata, updates the rebuildable Umbraco documents, and verifies the readback hash. Reverse `umbraco -> usable` bulk synchronization is intentionally rejected.

`.cms-sync-state.json` contains only hashes and timestamps. `--force` rebuilds even an already matching projection, which also reapplies the current Umbraco schema/data-type migration; it never changes the authority direction.

## Rendering from Umbraco

The public app still reads Usable directly by default. To inspect the rebuildable Umbraco rendering projection, set server-side values:

```sh
CMS_CONTENT_SOURCE=umbraco
UMBRACO_ORIGIN=http://localhost:5000
UMBRACO_SYNC_API_KEY=...
```

If Umbraco is unavailable or returns an invalid contract, the renderer uses the checked-in fallback. The key never enters browser code. Ordinary reads use the same 60-second revalidation policy as Usable. This mode demonstrates the projection; it does not make Umbraco canonical.

The authenticated endpoints are:

- `GET /api/olavur-sync/export`
- `GET /api/olavur-sync/status`
- `POST /api/olavur-sync/import`

All require `X-Olavur-Sync-Key`. Keep the sidecar private or additionally protect it at the network layer.
