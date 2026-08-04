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
```

## Deployment

```sh
flyctl deploy
```

Production is served from `https://www.olavurellefsen.com` on Fly.io. The apex permanently redirects to `www`; `https://olavurellefsen-com.fly.dev` remains the stable Fly hostname.
