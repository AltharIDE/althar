# @althar/connectors — Architecture

The code host and tracker connectors of [docs/architecture/06](../../docs/architecture/06-integrations-and-skills.md). The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the runtime, which holds connections, keeps tokens sealed by the app, records every outward action with its receipt, and listens.
- **Dependency direction:** depends on `effect` alone. It records nothing and stores no secret; persistence and secrets are the runtime's.

## What it holds

| Module | What it does |
| --- | --- |
| `model.ts` | The two models: code host and tracker, their data and their capabilities |
| `products.ts` | Every product: its name, hosted service, whether it runs self-hosted, how a person signs in, where its tokens are made, its adapter and its check |
| `access.ts` | What a connection can do, as its service says: the check's lines, each ok, no or unknown, with why and where it is put right |
| `probe.ts` | How a check asks: reads with the connection's credential, bounded in time, an answer kept whatever its status, never failing |
| `servers.ts` | Which product answers at a company's own address, asked without signing in |
| `github.ts` | GitHub and GitHub Enterprise Server: a code host over REST (GraphQL where REST can't), and a tracker of its issues. Each adapter's file holds its product's check too |
| `gitlab.ts` | GitLab, on gitlab.com or a company's own server: a code host of merge requests over REST, and a tracker of its issues |
| `bitbucketCloud.ts` | Bitbucket Cloud: a code host of pull requests over REST, with Pipelines' step logs |
| `bitbucketDataCenter.ts` | Bitbucket Data Center, on a company's own server: a code host of pull requests over REST |
| `linear.ts` | Linear, a tracker, over GraphQL |
| `jira.ts` | Jira Cloud and Jira Data Center, a tracker each, over REST: version 3 on Cloud, version 2 on Data Center |
| `jiraText.ts` | Jira's text to Markdown and back: Cloud's Atlassian Document Format, Data Center's wiki markup |
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
- **A check only reads.** What a connection can do is asked with GETs and GraphQL queries, and a refusal is itself an answer. What only a write would show is said to be unknown, never guessed.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the contracts (`tests/contract.ts`) against the fake, and each adapter against recorded answers, gated at 90% of lines and branches. `src/testing` is test tooling and not counted.
- `bun run test:real`: the same contracts against real accounts. It never runs in CI, since it needs tokens and writes to the services.

## Gaps

- **GitLab's checks** are its own pipelines' jobs, and a child or downstream pipeline as one check: a status an outside CI posts to a commit isn't read.
- **GitLab's issues** are open or closed: the statuses of its paid tiers aren't read.
- **Moving an issue to In Progress** (`start`) is Linear's, Jira's and Trello's. Linear takes the team's `started` state with the lowest position; Jira takes the first transition available now into the In Progress category, and one whose screen requires a field is refused by Jira, and fails; Trello puts the card at the top of its board's first open list named Doing or In progress (one for review, testing or what is blocked reads as started too, but isn't where work starts), and fails on a board with none. GitHub's and GitLab's issues are open or closed, so their `start` leaves the issue as it is (`capabilities.starts` is false). An issue already started, done or cancelled is never moved, and nothing is asked of the service for it. Linear's sign-in already asks for `write`, a Jira token carries the person's own permissions (the check reads `TRANSITION_ISSUES`), and a Trello token made for Althar writes (the check reads its `write`), so no connection needs signing in again.
- **Trello's statuses** are read from its lists' names (Done, Doing, Backlog, Won't do and the like). A board whose lists are named otherwise reads as to do until its lists can be mapped.
- **Jira's text** converts what issues and Althar's comments hold. Anything rarer (an attachment, a colour, a smart link's card) keeps its text, or its name, and no more. Quotes, lists and emphasis nested more than sixteen deep are read as text, so that converting takes time in proportion to the text, however odd it is.
- **Bitbucket Cloud merges what the branch holds:** its API takes no head to merge at, so the adapter checks the head the person saw just before, and a push in the moment between would be merged. Data Center's pull request version closes that gap.
- **Bitbucket Cloud's write access** is membership of the repository's workspace: Bitbucket tells only an admin who can write to a repository. A token without `read:workspace` can't read membership either: everyone then counts as an outsider, and the log says so once.
- **Bitbucket Data Center's checks** are build statuses, from the list Data Center deprecated in 7.14 and still serves, as nothing else lists a commit's. Code Insights reports aren't read, and a build's log is its build server's.
- **Bitbucket Data Center before 8.18** has no drafts: a draft opens ready.
- **Listening to Bitbucket Cloud** asks several things a turn, each by ETag; whether an unchanged answer counts against its hourly limit isn't documented.
- **A Bitbucket Cloud API token is made with scopes** (`read:user`, `read:workspace`, `read:repository`, `write:repository`, `read:pullrequest`, `write:pullrequest` and `read:pipeline`, all `:bitbucket`); the Connections panel links to where it is made but doesn't list them.
- **Where issues can be filed** is read page by page, up to ten pages: GitHub's and GitLab's repositories, Jira Cloud's projects and Linear's teams (Data Center's projects and Trello's boards come whole). An issue the tracker took is never reported as not filed: where reading it back fails (Jira, Trello), `create` returns what it knows.
- **Pagination** stops at the first hundred on GitHub: of comments since a cursor, of reviews, of checks. Bitbucket reads ten pages of comments, activity and a diff's stat, and Cloud the first hundred statuses.
- **Reviewing a change Althar didn't open** is GitHub's alone (`capabilities.reviews`): its pull request is read with whether GitHub names its author one of the repository's people (owner, member, collaborator) and the fork it comes from, and a review is posted with its verdict, summary and comments on lines of the change's new side, of the commit its reviewer read. GitLab and Bitbucket refuse both as `rejected`, without asking the service.
- **Pictures in a conversation** (`capabilities.pictures`, ADR-076) are GitHub's and GitLab's. GitHub takes them through the uploads endpoint its own CLI attaches with (`uploads.<host>/user-attachments/assets`), not one its REST documentation lists, and only on github.com and ghe.com tenants: Enterprise Server takes none. An upload can't be taken back. Bitbucket Cloud and Data Center have no API for one, so a comment there can't show a picture Althar uploads; editing a comment (`editComment`) comes with pictures, and is GitHub's and GitLab's too.
- **Webhooks** aren't here: listening polls until Althar has a cloud.
- **A fine-grained GitHub token's writes** can't be read: pushing, opening pull requests and commenting read as unknown, and only a refused read of the same permission says no. GitHub gives such tokens no check runs: the adapter reads a commit's statuses alone, and the check links to a classic token's page. A classic token needs `repo`: `public_repo` isn't taken for it, and `workflow`, which a push changing a workflow needs, isn't checked.
- **Bitbucket Cloud says a token's scopes only as it refuses one.** Where nothing Althar needs was refused, the check reads them from a refusal of a workspace's webhooks; a token given every scope, or a workspace that refuses for another reason, leaves them unsaid, and opening pull requests unknown.
- **Bitbucket Data Center's HTTP access tokens** don't say their own permission: only an account that can't write to a repository, and so no token of it, is certain. Pushing and merging otherwise read as unknown.
- **A Linear API key's permissions** aren't said: commenting and moving issues read as unknown, except with Althar's own sign-in, which asks to read and write.
- **Filing an issue isn't checked before it is asked for.** A Jira account's Create Issues permission, a fine-grained GitHub token's Issues permission, and the GitHub App's Issues: Read and write (set on the app, not here) are found out when an issue is filed, and a refusal reaches the card in the service's words. Labels a tracker has no name for are left off, except where the host makes them itself (GitHub, GitLab).
- **Trello's tokens** are read together by their name, Althar: where several differ in what they may write, which is this one isn't said, and writing reads as unknown.
- **Jira's permissions** are the account's in any project, not in the one Althar works in.
