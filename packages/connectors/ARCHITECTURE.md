# @althar/connectors — Architecture

The code host and tracker connectors of [docs/architecture/06](../../docs/architecture/06-integrations-and-skills.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime, which holds connections, keeps tokens sealed by the app, records every outward action with its receipt, and listens.
- **Dependency direction:** depends on `effect` alone. It records nothing and stores no secret; persistence and secrets are the runtime's.

## What it holds

| Module | What it does |
| --- | --- |
| `model.ts` | The two models: code host and tracker, their data and their capabilities |
| `products.ts` | Every product: its name, hosted service, whether it runs self-hosted, how a person signs in, and its adapter once built |
| `github.ts` | GitHub and GitHub Enterprise Server: a code host over REST (GraphQL where REST can't), and a tracker of its issues |
| `linear.ts` | Linear, a tracker, over GraphQL |
| `trello.ts` | Trello, a tracker, over REST: a card by its short link, its list as its status |
| `http.ts` | Calls to a service's API: signed in per call, bounded in time, answers checked, failures classified, GETs cached by ETag |
| `signIn.ts` | The device flow and OAuth with PKCE, and refreshing a token |
| `links.ts` | Which host a git remote is on, and what a pasted link points at |
| `testing/` | The fake service: a code host and tracker in memory that a test acts on as other people |

## Principles

- **The models come before the adapters.** Both were laid against all six products before the first adapter. A field only one product fills is a capability, or that product's own business.
- **A service's own words reach the screen; its shapes don't.** Changes, checks, reviews, comments and issues are the model's; the adapter converts, including text to Markdown.
- **Every answer is read through a schema.** An answer that doesn't fit fails as `invalid_response`, never as a wrong value downstream.
- **Cheap "anything new?".** A GET can be cached by its ETag, so polling an unchanged pull request costs GitHub's rate limit nothing; activity reads from a cursor.
- **No secret of Althar's.** Sign-in is the device flow or PKCE, which need none; anything else is a token the person pastes (on Trello, with their own Power-Up's API key). Credentials are asked for per call, never logged, and never put in a URL.
- **Idempotent where the service isn't.** Opening a change first finds one already open from its branch; a link is attached to a Trello card once.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the contracts (`tests/contract.ts`) against the fake, and each adapter against recorded answers, gated at 90% of lines and branches. `src/testing` is test tooling and not counted.
- `bun run test:real`: the same contracts against real accounts. It never runs in CI, since it needs tokens and writes to the services.

## Gaps

- **GitLab, Jira and Bitbucket** have no adapter yet; `products.ts` lists them, and nothing offers them.
- **Trello's statuses** are read from its lists' names (Done, Doing, Backlog, Won't do and the like). A board whose lists are named otherwise reads as to do until its lists can be mapped.
- **Pagination** stops at the first hundred: of comments since a cursor, of reviews, of checks.
- **Webhooks** aren't here: listening polls until Althar has a cloud.
