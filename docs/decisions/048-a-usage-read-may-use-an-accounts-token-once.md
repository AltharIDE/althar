# ADR-048: A usage read: an account's access token, read in memory for one call to its provider's usage URL

- **Status:** Accepted (the person approved it on 15 October 2026)
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** Plan usage is required for every agent and every subscription
  account ([the plan](../plans/plan-usage.md)). Where ACP, an adapter's
  extension and the agent's own control channel give no windows, the only
  source left is the provider's own usage endpoint, and it needs the
  account's access token. Architecture 03 rule 3 says Althar never reads an
  agent's credential cache, and ADR-012 keeps what an agent holds in its home
  out of Althar's reach. OpenCode has no channel at all for the plans it
  signs into, so without an exception its accounts have no usage. Claude's
  accounts have a channel (Agent SDK), and Anthropic's terms bar the endpoint
  for them.
- **Decision:** rule 3 has one exception, the **usage read**, and nothing
  else changes.
  - **What it may do.** Read the access token of one account from where its
    agent keeps it, into memory; make one `GET` to that provider's usage URL
    with it; parse the answer into windows (`AccountUsage`); drop the token.
    Nothing but the windows leaves the reader.
  - **What it may never do.** Write, refresh, rotate, copy, cache, persist,
    log, put in an error, event or ledger fact, show, or send the token
    anywhere but the one URL. Never call any other URL, method or host, never
    follow a redirect to another host, never run for a provider whose pair is
    not on the allowlist, never read a file that isn't that agent's
    credential for that account, never read any other field of it, and never
    change anything in the agent's home (not even a timestamp).
  - **A per-(agent, provider) allowlist.** The registry declares, for each
    pair, the one host, path and method, `https` only, and where the token is
    read from. A pair with no entry has no endpoint source. The first entries
    are Codex and OpenCode's ChatGPT sign-in (`chatgpt.com`,
    `/backend-api/wham/usage`), each enabled only after a spike confirms the
    answer and a read of the provider's current terms. OpenCode's Go, Zen,
    Copilot and Gemini pairs wait for their own spikes.
  - **Claude stays out.** No Anthropic host is on the allowlist. Anthropic's
    terms say OAuth is "intended exclusively" for Claude Code and its native
    apps and forbid intermediating Claude.ai credentials. It comes in only
    with Anthropic's written clearance and an amendment to this ADR. Claude's
    usage comes from `_meta` and the Agent SDK ([plan](../plans/plan-usage.md#the-claude-risk)).
  - **Last resort, not first.** The endpoint is the fourth source, after ACP,
    an adapter extension and the agent's own channel. Codex's app-server
    answers first; its endpoint is only for when that fails.
  - **Rate:** at most one call per account every 60 seconds, answers kept
    in memory only as windows (never the token), shared by every session and
    the usage tab, with back-off on a 429.
  - **On a device Althar can't read.** Where the agent's home is out on the
    device (a Flatpak's host: ADR-027), the read and the call run there,
    through the same `onDevice` route as the agent's other commands, in a
    small helper that prints only the windows. The token then never enters
    Althar's process. The same limits apply.
  - **Failures are shown, not hidden:**
    - **Token expired or refused (401, 403):** the account's source shows a
      fault, "sign in again", with the agent's own login flow
      (`signIn.login`) as its action. Althar does not refresh the token and
      does not assume a status command does. A running agent that refreshes
      its own is picked up on the next read.
    - **A store the keychain can no longer open, or no token there:** the same
      fault ([ADR-028](028-linux-windows-packages-and-the-keyring.md)).
    - **A 429:** back off; the last windows stay, marked with their age.
    - **Network down or a timeout:** the same, never a zero.
    - **An answer that isn't the documented shape:** "usage source changed",
      a fault. Never "no limits".
  - **The caller names a source; it cannot supply one.** The reader takes a
    source id and the account's (agent, provider), and finds the source in the
    registry for that pair's plan. The allowlist and the credential store are
    fixed in the production reader (`usageReader`); nothing a caller passes
    can widen either. A source for one agent version (OpenCode 1.x) is read
    only for a version known to match, never when it is unknown.
  - **The token is taken out of its file without reading the rest.** The
    store scans the file a chunk at a time, passes over every value that is
    not on the path (a refresh token, another provider's entry), stops at the
    one string and builds only that. A file that is a symlink, or resolves
    outside the account's home, is refused.
  - **One read at a time per account.** Callers asking together share one
    call, and the minute is taken before anything is awaited.
  - **The reader is one module.** Only it may import the code that opens an
    agent's credential store. A test fails if another file does.
  - **How a contract test enforces it** (`usageSources`, run by every
    registry and CI, against a fake home, token and server):
    - every subscription (agent, provider) pair declares a source, and every
      endpoint source's URL is `https`, a `GET`, on an allowlisted host and
      path, and none is an Anthropic host;
    - a fake token in a fake home produces exactly one request, to that host
      and path, carrying the token, and the home's files are byte-identical
      afterwards;
    - the token appears nowhere in what the reader returns, logs, events,
      errors or a captured log;
    - a redirect to another host is not followed;
    - an expired token yields the "sign in again" fault and no refresh call;
    - a malformed answer yields the "source changed" fault;
    - the import boundary above.
  - **OpenCode's plan or key** is told from `opencode auth list`'s output
    only (ADR-012's sign-in check), never from its credential files. On
    OpenCode 2.x that output no longer says (see below), so the credential is
    a fault until the registry reads `auth list --standalone --format json`.
- **OpenCode 2.x** (research of 15 October 2026, `docs/plans/opencode-2.md`
  on `althar/research-opencode-2-in-althar-acp-and-defaults`, run against
  2.0.29 in a throwaway home):
  - `opencode auth list` no longer prints "N credentials", so Althar's sign-in
    read sees "can't tell" for every 2.x account. Its `--format json` lists
    each sign-in's `connections` (`type`, `method`, `label`), which could tell
    a plan from a key; that is an unbuilt change to the registry.
  - Without `--standalone`, `auth list` goes through a background service
    shared by the whole user and answers with the data of whichever home
    started it: the wrong account. A per-account check needs `--standalone`.
  - 2.x moves credentials from `auth.json` into `opencode.db`. A usage read
    that opens a database is not the read this ADR allows. So **no OpenCode
    endpoint source runs on 2.x** until OpenCode documents a way to read a
    credential (or its usage) for one account, and this ADR is amended. On
    1.x it reads the one provider entry of the home's `auth.json`.
  - The research also recommends Althar start no OpenCode 2.x session until
    its rejected-command and MCP switch-off behaviour are settled. Until
    that, an OpenCode 2.x account has no usage source and is a fault, not a
    quiet "no data".
- **Linux and the Flatpak** (checked against ADR-027, ADR-028 and the
  finding on PR #185 that GitHub and Linear connections in the Flatpak lose
  their sealed sign-in at every start). That is Althar's own connections
  store, sealed with the app's key; the usage read does not use it, and
  stores nothing, so nothing can be lost there. It does depend on two other
  things: the agent's own store being readable where the reader runs (so
  the on-device helper above, since the host's home isn't the sandbox's), and
  an agent's keychain opening ("sign in again", ADR-028). The tab shows both
  as faults, not as missing data. Not tried in a real Flatpak.
- **Alternatives considered:**
  - **No exception: errors only for what has no channel.** Refused by the
    person: usage is required for every subscription.
  - **Ask each agent to read its own usage.** The best answer, and what the
    upstream requests are for (ACP quota RFD #2316, codex-acp #524, OpenCode
    #49693); this ADR is for the gap until they land, and each agent leaves
    the endpoint step when its adapter reports.
  - **Use the Claude endpoint anyway.** Against Anthropic's terms; its 429s
    make it unreliable too.
  - **Let Althar refresh a token it found expired.** Writing to the agent's
    credential store races with the agent and is the larger risk.
  - **Read the whole credential file for the reader's convenience.** Wider
    than the one field it needs.
- **Trade-off:** Althar's own rule gets a hole, narrow and tested, in the
  place where the product's largest security promise sits. The endpoints are
  undocumented and can change without notice, so a source can break for a
  week; it then shows as a fault. Claude accounts with no session may stay
  uncovered until Anthropic allows a read.
- **Revisit when:** ACP's quota feature is accepted and the adapters report
  it (the endpoint step goes); Anthropic clears or forbids the Claude
  endpoint; OpenCode documents a way to read an account's usage or its
  credential; or the contract test finds a way the token leaves the reader.
