# @althar/connectors

How Althar talks to code hosts and trackers ([docs/architecture/06](../../docs/architecture/06-integrations-and-skills.md), [ADR-011](../../docs/decisions/011-own-connectors-for-hosts-and-trackers.md)): a model for each, one adapter per product (GitHub, Linear and Jira so far), the sign-in flows that need no secret, and a fake service for tests. Written with [Effect](https://effect.website).

## Use it

```ts
import { products } from '@althar/connectors'

const github = products.github.make!({
  fetch,
  apiUrl: 'https://api.github.com',
  webUrl: 'https://github.com',
  credential: Effect.succeed({ kind: 'bearer', token }),
})
const host = github.host!
const repository = yield* host.repository(['meridian', 'api'])
const change = yield* host.openChange(repository, { title, body, source: 'althar/mer-231', target: repository.defaultBranch, draft: true })
const { comments, reviews, cursor } = yield* host.activity(repository, change.number, null)
```

- **Two models, an adapter per product.** A code host opens, reads and marks changes ready, reads their checks and what is said on them, and replies. A tracker reads issues, lists the account's, comments and attaches links. Cloud and Data Center are separate products.
- **Capabilities, and the product's own words.** What only some products have (drafts, check logs, threads, links) is a capability; `words` says "pull request #12" or "merge request !12".
- **Opening a change adopts one already open from its branch,** so a retry, or a pull request opened some other way, never makes a second.
- **Text is Markdown.** Jira Cloud's descriptions and comments are the Atlassian Document Format, Data Center's are wiki markup: an issue reads as Markdown from either, and a comment is written in whichever the edition takes.
- **Every failure is a `ConnectorFailed` with a reason:** unauthorized, forbidden, not found, rate limited (with when to try again), unreachable, rejected, or an answer that couldn't be read.
- **The credential is asked for on each call,** so a refreshed token is used, and it never leaves the adapter except as the header it makes. A Jira Cloud API token with scopes works only through Atlassian's gateway, not the site's own address; the adapter goes there when the site refuses one.

## Work on it

From `packages/connectors`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The models' contracts against the fake, and each adapter against recorded answers |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:real` | The contracts against real accounts, from tokens in the environment (see `tests/real/real.test.ts`). It opens and closes a pull request and comments on an issue, so it never runs in CI |
| `bun run verify` | Check and coverage, as CI runs them |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
