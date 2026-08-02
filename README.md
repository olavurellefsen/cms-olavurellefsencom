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

## Verification

```sh
npm run verify
```

## Deployment

```sh
flyctl deploy
```

The production candidate is served from `https://olavurellefsen-com.fly.dev`. The legacy Netlify site remains the recovery path until domain and CMS production smoke checks pass.
