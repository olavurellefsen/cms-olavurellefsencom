# olavurellefsen.com

Ólavur Ellefsen's personal founder publishing site. Next.js renders the public site; Usable CMS owns editable content, drafts, publishing and version history.

## Local development

```sh
npm install
npm run dev
```

Without CMS environment variables, the site serves validated fallback content from `content/site.json`.

## Usable CMS

1. Start device login with `POST https://cms.usable.dev/api/auth/device/start`.
2. Sign in as `olavur@ellefsen.fo`.
3. Export the returned setup token as `USABLE_CMS_SETUP_TOKEN`.
4. Run `npm run cms:register`.

The setup script updates public ids in `cms/site-binding.json` and writes private local values to `.env.local`. The server token must also be configured as the Fly secret `USABLE_CMS_SERVER_TOKEN`.

Re-run registration after adding a checked-in page or changing `cms/manifest.json`. Registration is idempotent: it creates any missing page fragment (including the collaboration field note), synchronizes full fragment UUIDs into the CMS manifest, and refreshes `cms/site-binding.json`.

After registration or an Umbraco article-editor contract change, run
`npm run cms:sync-regions` with the same setup token and the server-side read token. It discovers
runtime-created page fragments, repairs the complete hosted manifest page directory, rebinds all
declarations to the canonical Usable fragments, and adds the structured `bodyBlocks`, whole-image
delete, and hero-visibility paths needed by the native Umbraco editor.

Run `npm run cms:audit-topology` with the server-side read token to verify the live storage
shape. The report distinguishes logical pages from duplicate physical fragments and flags any
global or page fragment that incorrectly contains a nested whole-site `pages` array.

### Runtime pages and chat

Signed-in editors can use **Pages → New founder note** to create a real `/writing/<slug>` page from the `founder-note` template. Every created page is its own `CMS Page` fragment. **Hide page** archives the page in the CMS manifest without deleting its fragment. Public page discovery is refreshed every 60 seconds, so published runtime pages automatically appear on Writing, RSS, and the sitemap.

The editor includes embedded Usable chat. It receives the active page fragment, published baseline, working draft, changed paths, and manifest, allowing the broker to safely create, read, update, publish, and hide declared CMS content. The browser only receives the public `ucms_` integration key; `USABLE_CMS_SERVER_TOKEN` remains server-only.

## Web analytics

Public pages load the cookie-free Usable Web Analytics tracker for
`www.olavurellefsen.com`. The exact hostname match keeps local development and the Fly
candidate hostname out of production analytics.

## Verification

```sh
npm run verify
npm run umbraco:build
npm run umbraco:test
```

## Optional Umbraco CMS

The repository includes a separate Umbraco backoffice backed by a rebuildable projection of
the canonical Usable workspace fragments. Its native Block List and Tiptap field editors save private
draft revisions and publishes them through the user-authenticated Usable broker. Umbraco saves
only a verified copy of already-published canonical content; Usable remains the only source of
truth and the default renderer.
See
[`umbraco/README.md`](umbraco/README.md) for local setup, source switching, and safe sync
commands.

## Deployment

```sh
flyctl deploy
```

Production is served from `https://www.olavurellefsen.com` on Fly.io. The apex permanently redirects to `www`; `https://olavurellefsen-com.fly.dev` remains the stable Fly hostname.

The Umbraco projection is a separate Fly application so the public renderer stays available and
canonical Usable reads are never coupled to the backoffice lifecycle. Deploy it from the repository
root with:

```sh
flyctl deploy umbraco --config umbraco/fly.toml
```

`olavurellefsen-umbraco` uses one persistent `umbraco_data` volume for its rebuildable SQLite
projection, backoffice users, and data-protection keys. Its server-only secrets are
`OlavurSync__ApiKey`, `UsableProjection__ServerToken`,
`Umbraco__CMS__Unattended__UnattendedUserName`,
`Umbraco__CMS__Unattended__UnattendedUserEmail`,
`Umbraco__CMS__Unattended__UnattendedUserPassword`, and
`Umbraco__CMS__Imaging__HMACSecretKey`. The public app remains `CMS_CONTENT_SOURCE=usable` and
exposes the Umbraco editor through `/cms?editor=umbraco`.
