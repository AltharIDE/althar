# ADR-059: A tracker's workspaces are connected side by side, and a project may be bound to one

- **Status:** Accepted
- **Date:** 2026-10-24
- **Owner:** Repository maintainers
- **Context:** A person is often in several of Linear's workspaces, one for
  each company or client they work with, and keeps a project in Althar
  for each. A Linear token, an OAuth sign-in's or a personal API key,
  reaches one workspace, the one it was made in. Althar let them connect
  only one: Connections → Trackers showed "Signed in as … · Disconnect"
  and nothing more, where GitHub and GitLab offer "Add a server". The store
  already allowed more than one connection of a product: `connections` is
  unique on the device, product, address and account (migration 0006).
  But a second Linear sign-in renewed the first wherever the account id
  matched, and nothing told two workspaces apart. Linear's address is
  `https://linear.app` for every workspace. And once two trackers are
  connected, where a project's issues go was only learned, from the issues
  its tasks came from and the drafts it filed (`IssueDrafts.usual`), while
  `find_issues` and the person's issue list read every tracker in every
  project.
- **Decision:**
  - **A connection keeps the workspace its sign-in reaches**, for a
    product whose sign-in reaches one (`ProductInfo.workspaces`, Linear's
    alone today). It keeps the workspace's URL key, which its links carry
    (`linear.app/<key>/issue/FNT-12`, Linear's `Organization.urlKey`), and
    its name, read with the viewer when it is connected or checked
    (`viewer { … } organization { name urlKey }`). The same account in
    the same workspace is renewed; another workspace is a connection beside
    it, never overwriting the first. The store holds this, unique on
    device, product, address, account and workspace key (migration 0041).
    A connection made before Althar kept workspaces learns its own the
    first time the runtime starts after this migration, or when it is
    signed in again or checked. Until it has, it is the one that a
    sign-in of that account renews.
  - **Connections offer "Add a workspace"** for such a product once one is
    connected, through the same walk as the first. Linear's sign-in asks
    with `prompt=consent`, which, as Linear's OAuth documentation says,
    shows its consent screen every time, so the person can switch
    workspace there. A personal API key is made in the workspace it
    reaches. Each connection says its workspace ("Signed in as
    mate.kokai99 · FNT") and is disconnected on its own.
  - **A link to an issue goes to the connection in the workspace it
    names**; then to one that doesn't know its workspace yet; then to any
    of that product. A link names its workspace explicitly, so it reads
    from whatever project it is pasted in.
  - **A project may be bound to one tracker connection, and to a container
    there** (a Linear team), by the person in its settings (Code and
    issues → Trackers, "Issues go to"). Kept on the project
    (`projects.tracker_connection_id`, `tracker_container_id` and
    `_name`, migration 0041), it follows the connection: one disconnected
    leaves the project bound to nothing until the same workspace (or, for
    a product without workspaces, the same account) is connected again,
    and then to that one.
    - Bound, its drafts go to that tracker and team unless the agent
      names another.
    - The coordinator's `find_issues` and the person's issue list read
      that tracker alone, beside the project's own repository's issues.
    - A bare key (`ENG-1`) is looked for on that tracker first, then on
      the others, so a key that only another workspace has still reads.
    - Unbound, everything goes on as before: drafts go where its issues
      already are, and issues are listed and keys found across every
      tracker.
  - **Several of a product are told apart by their workspace** wherever an
    agent or the person picks one: Linear (FNT), Linear (althar); then by
    site, then by site and account, as before.
- **Alternatives considered:**
  - **A workspace as a server of its own** (`webUrl =
    https://linear.app/<key>`): it fits "Add a server" with no new column,
    but every Linear address in Althar, its API's among them, is the one
    host, and links, hosted-ness and the sign-in would all have to strip
    the path back off.
  - **Keep it on the account id alone:** a Linear user is a different id
    in each workspace, so two never collided in practice. But nothing would
    say which workspace each is, to show it, to route a link by it, or to
    tell a renewal from a new one.
  - **Read the binding from the issues a project has, as now:** it can't
    be set before the first issue, and a project whose first issue came
    from the wrong workspace keeps going there.
  - **Bind a project to several trackers:** more than anyone asked for;
    unbound is already "all of them".
- **Trade-off:** a bound project hides the other workspaces' issues from
  its issue list and `find_issues`, which is what the person asked for,
  but someone who expected to see everything there has to unbind it. A
  connection made before this change shows no workspace until it has
  learned it.
- **For Jira and Trello:** a Jira Cloud site is already an address of its
  own (`webUrl`), so several sites side by side need nothing more; a
  Trello sign-in reaches every workspace the person is in, so a project
  binds to its board's list as a container. A product whose sign-in
  reaches one workspace sets `workspaces` and fills in
  `Account.workspace`, and the rest follows.
- **Revisit when:** a tracker's sign-in can reach several workspaces at
  once and Althar needs to pick among them within one connection, or a
  project needs more than one tracker of its own.
