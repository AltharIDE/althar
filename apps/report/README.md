# @althar/report

The report service: a Cloudflare Worker that turns a problem report sent from the app into an issue in Linear. The app posts the person's words, the facts it gathered (versions, the screen, the agents, the last errors) and, if the person kept them, a screenshot and the logs. The Worker checks all of it, uploads the files to Linear, and files an issue in the Development team's Triage with the label "From the app".

It has one route, `POST /reports`. The request, the answers and what the Worker promises about them are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Work on it

From `apps/report`:

| Command | What it does |
| --- | --- |
| `bun run dev` | The Worker at `http://127.0.0.1:8787`, with `wrangler dev` (local mode) |
| `bun run fake-linear` | A fake Linear at `http://127.0.0.1:8788`, which prints every request it gets |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against a fake Linear and fake rate limits |
| `bun run test:coverage` | The tests, with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |

## Configuration

| Name | Kind | What it is |
| --- | --- | --- |
| `LINEAR_API_KEY` | Secret | A Linear personal API key. Set with `wrangler secret put LINEAR_API_KEY`; locally, in `.dev.vars` |
| `LINEAR_TEAM_ID` | Variable | The team issues go to: Development (key DEV), `114c997c-12a5-4ab3-89bc-8d29dfd2ddeb` |
| `LINEAR_LABEL` | Variable | The label every report gets: `From the app`. Made in the team on the first report if neither the team nor the workspace has it |
| `LINEAR_API_URL` | Variable, optional | Linear's GraphQL address; `https://api.linear.app/graphql` unless set. Set it only to point at the fake Linear |
| `REPORTS_PER_INSTALL` | Rate limit | 3 reports a minute per install id |
| `REPORTS_PER_IP` | Rate limit | 10 reports a minute per address (`CF-Connecting-IP`) |

The variables and the rate limits are in `wrangler.jsonc`. A rate limit's `namespace_id` is any number unique within the Cloudflare account; change them if another Worker there uses 4101 or 4102.

## Run it locally

Nothing goes to Linear: the Worker talks to the fake.

```bash
cp .dev.vars.example .dev.vars   # git ignores .dev.vars
bun run fake-linear              # in one terminal
bun run dev                      # in another
```

Then post a report, with `report.json` holding the report as [ARCHITECTURE.md](ARCHITECTURE.md) describes it:

```bash
curl -X POST http://127.0.0.1:8787/reports \
  -F 'report=<report.json' \
  -F 'screenshot=@screenshot.png;type=image/png' \
  -F 'logs=@logs.txt;type=text/plain'
```

The answer is `201 {"ok":true}`, and the fake Linear prints the calls: the team and label lookups, the label it made, each upload, and the issue with its description in full. `wrangler dev` enforces both rate limits locally, so a fourth report from one install within a minute gets 429.

## Deploying

Before the first deploy:

1. **A Linear API key.** In Linear, Settings → Account → Security & access → Personal API keys, make a key that can create issues and labels and upload files in the Development team. Issues are created as the key's owner, so a member kept for this is better than a person. If the key can't create labels, make the "From the app" label in the team by hand.
2. **The secret.** Logged in with `bunx wrangler login`, from `apps/report`: `bunx wrangler secret put LINEAR_API_KEY`, and paste the key. It never goes in a file.
3. **Triage.** Turn on Triage for the Development team (its settings in Linear, under Triage). Without it, reports land in the team's default state.

Then `bun run deploy` (`wrangler deploy`) publishes the Worker and makes its rate limits.

Give the app the Worker's address, such as `https://althar-report.<account>.workers.dev`, as `ALTHAR_REPORT_URL` when it is built; it posts to `/reports` there. Watch the first real report arrive in Triage: the Worker's calls are checked against a fake, not yet against Linear itself.
