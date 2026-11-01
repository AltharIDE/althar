# Social preview audit — 2026-11-01

Fetched production with curl, following redirects, using its default request
and each of `Twitterbot`, `facebookexternalhit`, `LinkedInBot`, `Slackbot`,
`Discordbot`. All six requests per route gave the following results:

| Route | Status | Absolute og:image |
| --- | --- | --- |
| / | 200 | https://althar.ai/og/home.jpg |
| /shifts | 200 | https://althar.ai/og/shifts.jpg |
| /changelog | 200 | https://althar.ai/og/changelog.jpg |
| /thesis | 200 | https://althar.ai/og/thesis.jpg |
| /wallpaper | 200 | https://althar.ai/og/wallpaper.png |
| /docs | 200 | https://althar.ai/og/home.jpg |
| /enterprise | 200 | https://althar.ai/og/home.jpg |
| /missing-page | 404 | https://althar.ai/og/home.jpg |

Each response has og:type, og:site_name, og:title, og:description, og:image,
og:image:width=1200, og:image:height=630, og:url and
twitter:card=summary_large_image. Explicit twitter:title, twitter:description
and twitter:image were absent. The branch supplies those without relying
on a platform's OG fallback.

All six user agents received 200 for each image, with identical bytes.
Sharp decoded every downloaded image as 1200×630. All are below 5 MB:

| Image | Content-Type | Bytes |
| --- | --- | --- |
| home.jpg | image/jpeg | 168850 |
| shifts.jpg | image/jpeg | 164311 |
| changelog.jpg | image/jpeg | 161977 |
| thesis.jpg | image/jpeg | 164803 |
| wallpaper.png | image/png | 420563 |

robots.txt returned `User-agent: *` and `Allow: /` for all six agents;
there is no block on /og/. The configured Worker handles /seal/* first;
other requests use static assets. The live 404 has metadata too.

## Cause and remaining checks

The missing preview could not be reproduced at the HTTP layer. Production
already serves prerendered tags, so the broken local deploy command is a
confirmed regression risk, not a confirmed explanation of the reported
preview. Cached platform metadata or network-specific crawler blocking
remain possible; spoofing a user agent does not prove access from the
platform's actual crawler IPs or that a platform renders a card.

The deploy command previously ran only `vp build`, omitting SSR and
prerendering. It now runs `bun run build`, including a test of all generated
HTML. Dashboard commands are not visible in this repository: verify the
Workers Builds settings documented in ../README.md and redeploy if needed.

After deployment, test a fresh share in X's composer. A fresh URL such as
https://althar.ai/?card=20261101 can help distinguish a cached URL from a
new fetch; it is not a guaranteed cache purge. If the signed-in X card
validator is available, request a re-fetch there. Confirm the actual card
in X; do not assume existing posts will update.

Preview deployment crawler verification awaits the PR's Cloudflare bot URL.
