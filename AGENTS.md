# Repository Instructions

## Usable CMS

- CMS owner identity: `olavur@ellefsen.fo`.
- Hosted editor and broker: `https://cms.usable.dev`.
- Setup mode: `wysiwyg-login-gated-multi-page`.
- Refresh the setup catalog before CMS changes, and at least daily while actively developing: `GET https://cms.usable.dev/api/setup/skills`.
- Selected setup skills:
  - `https://cms.usable.dev/api/setup/skills/usable-cms-public-renderer`
  - `https://cms.usable.dev/api/setup/skills/usable-cms-wysiwyg-broker-editor`
  - `https://cms.usable.dev/api/setup/skills/usable-cms-page-templates`
- Re-register idempotently with `npm run cms:register` after completing the device login and setting `USABLE_CMS_SETUP_TOKEN`.
- After registration, run `npm run cms:sync-regions` with `USABLE_CMS_SETUP_TOKEN` and the server-side `USABLE_CMS_SERVER_TOKEN`; this performs complete manifest-only repair and includes runtime-created pages.
- Public CMS binding ids live in `cms/site-binding.json`. The editable contract lives in `cms/manifest.json`.
- One global config fragment and one fragment per page/article are mandatory. Do not collapse content into one site JSON fragment.
- Public reads use `USABLE_CMS_SERVER_TOKEN` on the server only, with a 60-second revalidation window and checked-in fallback content.
- `/cms?page=<page-id>` opens the in-context editor on the selected public page. CMS/editor paths are no-store and noindex.
- Never place `USABLE_CMS_SERVER_TOKEN` in browser code, `cms/site-binding.json`, Git, logs, or broker requests.
- Exact allowed origins only: canonical production origins, the stable Fly hostname, and deliberate localhost development. Never wildcard preview origins.
- Page creation uses the `founder-note` template and requires read-write server token access. New page creation must create one CMS Page fragment and sync its full fragment UUID into the manifest.

## Validation

Run `npm run verify` before pushing. Verify fallback rendering with `CMS_CONTENT_SOURCE=fallback npm run build`. Smoke `/`, `/writing`, a published article, `/about`, `/health`, `/robots.txt`, `/sitemap.xml`, `/feed.xml`, `/api/cms/manifest`, and `/cms?page=home`.

## Delivery

- Use Conventional Commit subjects for every commit and PR title.
- Fly app: `olavurellefsen-com`, region `ams`.
- Canonical hostname: `www.olavurellefsen.com`; apex permanently redirects to `www`.
- Canonical Route 53 DNS points to Fly. The legacy Netlify deployment is not a required recovery target.
- Temporary downtime is acceptable to the site owner; CMS rollback, image recovery, and runtime page creation are post-launch improvements rather than availability blockers.
