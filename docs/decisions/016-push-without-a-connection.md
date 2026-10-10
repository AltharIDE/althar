# ADR-016: Pushing is git; a connection is what comes after

- **Status:** Accepted
- **Date:** 2026-10-09
- **Owner:** Repository maintainers
- **Context:** A task without a pull request ended on its branch. The
  person could merge it into the default branch on this Mac and push that,
  but pushing the task's branch itself needed the code host connected
  ([06](../architecture/06-integrations-and-skills.md)). That put a host Althar has no
  connector for, a team's own server or a new host, out of reach. It also
  made a connection read as permission to push, when what a connection
  really adds is the loop after the push: the pull request opened for you,
  its checks and reviews brought back to the lead, the merge when you accept.
  Separately, Codex and OpenCode were found to load every MCP server the
  person set up for them, beside the one Althar gives a session. Probing
  both agents confirmed it: a session started the person's servers too. A
  server that acts on GitHub with the person's token would then have been
  the agent's way around ADR-011.
- **Decision:**
  - **A task's branch can always be pushed with the person's own git:** to
    the remote that repository's work goes to (the one its default branch
    follows, else `origin`, else its only remote), under the branch's own
    name. It uses their keychain or SSH agent as a terminal would, never
    forces, and fails rather than waits for a password. It pushes up to the
    commit they saw in each repository, as merging here does. Nothing is
    opened on the host, and the task stays as it was.
  - **The task says where its branch stands on the remote:** not there yet,
    behind by some commits, or there. Once it is there, the task links to the
    host's page for a new pull request from it, where that page can be
    told: GitHub, GitLab and Bitbucket by their hosts, and a GitLab, Gitea or
    Forgejo of a team's own by its name.
  - **The offer to connect comes after a push, not before.** Nothing is said
    up front. Once a branch is pushed to a host Althar knows but isn't
    connected to, the task says what connecting would add, in those terms,
    and opens Connections beside it. The project's menu always has Connect.
  - **Connected, Althar's own steps push with the connection's token and
    open the pull request,** as before (06); the person's own git is for
    what isn't connected.
  - **Agents still reach hosts only through Althar (ADR-011).** The MCP
    servers the person set up for Codex or OpenCode are switched off by name
    as each starts: Codex's through `CODEX_CONFIG`, OpenCode's through the
    config it takes from its environment. Their names come from each file
    the agent reads: its global and home config, and the project's, from
    the repository's root down to the session's folder. The files are only
    read. Claude Code already loads only the servers it is given.
- **Alternatives considered:**
  - **Keep pushing behind a connection.** It is simpler, and every push
    would be recorded with a connection's receipt. But it leaves any host
    without a connector unusable, and it ties the reason to connect to
    something git does on its own.
  - **Let leads push and open pull requests with their own tools** (`gh`, an
    MCP server), as an opt-in per project. Althar would no longer know what
    went out or why, and a long unattended run would carry the person's
    credentials. It stays closed.
  - **Treat the person's GitHub MCP server as a connection.** It would mean
    reading another tool's secrets. No.
- **Trade-off:**
  - **Two ways to push.** The person's git when not connected, the
    connection's token when connected. Which one ran shows in the thread's
    notice, not in a receipt.
  - **The person's MCP servers are found by name, from files Althar reads.**
    A server added another way, or one whose name has a dot in it (Codex),
    isn't caught.
  - **The page for a new pull request is a guess from the remote's address**
    for hosts of a team's own; one that can't be told gets no link.
- **Revisit when:**
  - Codex or OpenCode let a client start a session with only the MCP
    servers it gives: use that instead of switching servers off by name.
  - A host Althar has no connector for becomes common: a connector for it,
    or a way to open its pull requests without one.
