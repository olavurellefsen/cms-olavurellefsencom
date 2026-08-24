# Umbraco sidecar

This is an optional Umbraco 18/.NET 10 editing and rendering projection for the content owned by Usable. Usable workspace fragments are the only source of truth. Umbraco's local documents are rebuildable editor/cache state and do not become a second content authority.

## First run

```sh
export OlavurSync__ApiKey="$(openssl rand -hex 32)"
export USABLE_CMS_SERVER_TOKEN=... # server-only canonical read credential
export UsableProjection__AdapterCredential=ucmsa1... # server-only cutover read credential
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

The Selected Work pilot defaults fail-closed to the explicit `legacy-shadow` projection phase. A projection refresh selects `managed-v2` only when the authenticated Usable adapter runtime returns the durable `stable`/`canonical-workflow` phase for `home.selectedWork` and the current schema-plan fingerprint; missing, stale, malformed, or unavailable state remains on the shadow. Cutover reads require the separate server-only `UsableProjection:AdapterCredential` (`UsableProjection__AdapterCredential` in the environment), and accept only the adapter credential form `ucmsa1.*`. The public `UsableIdentity:SiteCredential` (`ucms1.*`) remains the browser broker bootstrap credential and is never sent to the cutover endpoint. The checked-in adapter credential is deliberately empty, so the runtime remains fail-closed until deployment provisions it. The selected phase is stored in hidden server-managed document metadata and cannot be changed by an editor. Every authoritative native Home save rechecks that exact authenticated phase, so a stable-to-compatibility rollback (or an unverifiable runtime) blocks the stale writer immediately instead of waiting for the next projection import. The shadow stores each canonical `$id` in a hidden Block List property and validates it against the persisted native projection key, so add/edit/reorder/remove operations cannot lose or swap identities; missing or ambiguous metadata fails closed. The native Block List and manifest both enforce 0–24 Selected Work items. Neither content shape nor local phase configuration selects the writer. Wrapped manifest-v2 article topics are exposed to this consumer as the unchanged scalar `string[]` view while their canonical IDs survive native edits.

This bespoke compatibility consumer never attests zero-orphan state and never submits cutover evidence. Rebuild verification for `home.selectedWork` must be performed by the reusable managed Umbraco adapter after it reads back the native Block List and proves exact layout/content/expose UUID equality with no missing, duplicate, or orphan identities; that adapter submits the evidence bound to the canonical revision and schema/migration fingerprints. This consumer only reads the resulting durable phase and cannot promote itself to stable authority. Until that managed-adapter evidence path is deployed and the private adapter credential is provisioned, it remains on `legacy-shadow`.

Editing uses the same Usable draft/publish boundary as the bespoke CMS:

1. the native property editor loads the Usable broker through an exact-origin bridge on `http://localhost:3000`;
2. **Save draft** creates or updates a private revision in the Usable workspace using the signed-in human editor's permissions and CSRF-protected broker session;
3. **Publish** publishes that Usable revision explicitly;
4. the editor then requests an Umbraco save, whose server handler reads the canonical fragment and accepts the local projection only when it matches the published Usable content;
5. stale, local-only, or merely drafted values are rejected. The server token cannot publish and no longer performs direct fragment PATCH requests.

The bridge accepts messages only from the exact local backoffice origins `http://127.0.0.1:5099` and `http://localhost:5099`. If either port or hostname changes, configure and register the exact deliberate development origins; do not use a wildcard.

In production, the bridge derives its one allowed parent from the server-only
`UMBRACO_BACKOFFICE_ORIGIN` value on the public app. The checked-in Fly configuration uses
the canonical `https://www.olavurellefsen.com` origin. The bridge route deliberately omits
`X-Frame-Options` and instead emits a `Content-Security-Policy: frame-ancestors` directive for
that exact origin. Ordinary site and CMS routes remain `SAMEORIGIN`.

The public Next.js runtime is also the canonical backoffice gateway. It routes only
`/umbraco`, `/signin-usable`, `/api/olavur-sync`, and this package's exact App_Plugins path. On
Fly, `UMBRACO_GATEWAY_APP` returns a cross-app `fly-replay`, so Fly Proxy hands the original
request directly to Umbraco and preserves upgrade handling. Local development can instead use
`UMBRACO_GATEWAY_ORIGIN` as an external rewrite. The browser therefore stays on
`https://www.olavurellefsen.com/umbraco`; the stateful ASP.NET process and its volume remain
separately deployable. Fly replay requests are limited to 1 MB; Usable Assets uploads bypass
this gateway. Keep the exact canonical OIDC callback registered alongside the Fly callback
until the gateway has passed production acceptance.

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
