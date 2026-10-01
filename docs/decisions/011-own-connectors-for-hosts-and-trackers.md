# ADR-011: Charrette's own connectors for code hosts and trackers

- **Status:** Accepted
- **Date:** 2026-10-01
- **Owner:** Repository maintainers
- **Context:** A task ends in a pull request, listens to it, and often starts
  from an issue. Teams keep their code on GitHub, GitLab or Bitbucket, hosted
  or on their own servers, and their work in Linear, Jira, Trello, or the
  code host's own issues. Charrette shows these (an issue unfurled where it
  was pasted, a PR's checks on the accept card), acts on them (opens the PR,
  replies on it) and listens to them (comments arriving in the task's
  thread). Each service has its own API, sign-in and words.
- **Decision:**
  - Charrette talks to code hosts and trackers through connectors of its own,
    on each service's API ([06](../architecture/06-integrations-and-skills.md)).
    There are two models, a code host and a tracker, each with an adapter
    per product. Cloud and Data Center are separate products, and so are
    GitHub's and GitLab's issues as trackers. Each adapter declares what it
    can do, and the screens show only that, in the service's own words.
    Each kind has a fake for tests and a contract suite run against real
    accounts on demand, like the agents.
  - MCP stays what agents use for extra tools. It is not how Charrette
    itself reads or changes a host or a tracker.
  - Signing in:
    - Charrette uses the service's own browser sign-in wherever it gives a
      desktop app a token without a secret: GitHub through Charrette's
      GitHub App by device flow, GitLab by device flow, Linear by OAuth with
      PKCE, and Trello through its authorize page.
    - Everywhere else, the person pastes a token: Jira and Bitbucket, and
      every self-hosted instance whose admin hasn't registered Charrette.
    - Tokens are sealed by the app (Electron's `safeStorage`, whose key the
      system keychain keeps for the signed app alone), never in the store,
      the record or a log, and never where another process can open them
      without the person noticing.
    - OAuth that needs the app's secret (Atlassian's) waits for Charrette's
      cloud.
  - Agents reach the hosts only through Charrette:
    - Pushing a task's branch, opening its pull request and marking it ready
      are Charrette's, done as steps of the plan.
    - Agents read pull requests and issues, and reply on a pull request,
      through Charrette's tools, which only reach the task's own repository.
    - Agents run without the person's ways into a host: `gh` and `glab`
      signed out, git's credential helpers reset, no SSH agent. The
      environment is the boundary.
    - The rules refuse `gh` and `glab` commands that change a host, with a
      reason that names Charrette's tool, and any command that reads
      credentials.
    - What the lead hears from a pull request is what the person and the
      repository's own people say, and failed checks. Anyone else, as on a
      public repository, stays in the thread for the person to pass on.
    - A pull request opened some other way, on the task's branch, is
      adopted, not duplicated.
  - While the app is open, Charrette listens by polling, and only to what
    something listens to: a task's pull requests until it settles. Webhooks
    come with the cloud.
- **Alternatives considered:**
  - Each service's MCP server as the product's layer: tool names and output
    shapes differ by service and version, there is no way to listen, and no
    receipt for a write, and the agent acts with the person's whole token.
  - Borrowing `gh`: no setup for GitHub, but nothing for the other services.
  - A unified API (Merge, Nango and the like): breadth quickly, but the
    services flattened to the features they share, and a third party holds
    the tokens.
  - A Charrette token service now, for Atlassian's OAuth: one-click
    sign-in, but an always-on service in the path before there is a cloud.
- **Trade-off:** many adapters to keep up with, and some sign-ins are a
  pasted token, renewed yearly. Polling means a comment shows up within a
  minute rather than at once, and nothing is heard while the app is closed.
- **Revisit when:** Charrette has a cloud (webhooks, the GitHub App's events,
  Atlassian OAuth, a Forge app, Linear's agent sessions); a service offers
  OAuth without a secret.
