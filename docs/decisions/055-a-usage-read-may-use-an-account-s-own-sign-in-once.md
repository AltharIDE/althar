# ADR-055: A usage read may use an account's own sign-in, once, for one call to its provider's usage URL

- **Status:** Accepted (the person decided it on 21 October 2026)
- **Date:** 2026-10-21
- **Owner:** Repository maintainers
- **Context:** Althar shows how much of each subscription's windows is left
  and steers new work away from an account nearly out
  ([plan](../plans/plan-usage.md)). ACP doesn't carry plan windows yet, and
  few agents give them another way: Claude Code says a window only while a
  session runs (`_meta["_claude/rateLimit"]`), Codex answers through its
  app-server, and the rest say nothing. Their providers' own usage URLs do
  answer, with the account's sign-in, as Orca and CodexBar read them.
  Architecture 03 rule 3 says Althar never reads an agent's credential
  cache, so reading one needs an exception. A first draft of it (ADR-050 in
  #218, kept in its commit `59955fe`) kept every Anthropic host out, citing
  Anthropic's terms, and was taken out of #218 because nothing could run
  it. The person has since decided Althar may read Anthropic's usage
  endpoint with Claude Code's own sign-in, the way Orca does, and asked for
  every agent whose usage can be read to be read.
- **Decision:** rule 3 has one exception, the **usage read**, and nothing
  else changes.
  - **What it may do.** Read the access token of one account from where its
    agent keeps it, into memory; make one `GET` to that provider's usage URL
    with it; parse the answer into windows; drop the token. Nothing but the
    windows, or a fault in fixed words, leaves the reader.
  - **What it may never do.** Write, refresh, rotate, copy, cache, persist,
    log, put in an error, event or ledger fact, show, or send the token
    anywhere but the one URL. Never follow a redirect, never call another
    URL, method or host, never read a file outside the account's home or one
    that links out of it, never read any other field of it but the account
    id a provider asks for beside the token, and never change anything in
    the agent's home or keychain.
  - **An allowlist, in the registry.** Each (agent, provider) pair declares
    its sources (`usageSources.ts`); an endpoint source names its one
    `https` URL, its method, where its token is, and where it was seen
    working. The allowlist holds each host, path and query, frozen with the
    registry, and a source off it is refused:
    - Claude Code: `api.anthropic.com/api/oauth/usage`, with Claude Code's
      sign-in: on a Mac its keychain item for the account's folder (the
      plain item for its usual folder; for a folder named by
      `CLAUDE_CONFIG_DIR`, the item named for it, never the usual one), else
      `.credentials.json` in it. Anthropic's ban is lifted.
    - Codex: `chatgpt.com/backend-api/wham/usage`, with `auth.json` in its
      home, only where its app-server can't answer.
    - Kimi Code: `api.kimi.com/coding/v1/usages`, with
      `credentials/kimi-code.json` in its home.
    - Grok Build: `cli-chat-proxy.grok.com/v1/billing?format=credits`, with
      xAI's entry in `auth.json` in its home.
  - **The agent's own sources first.** ACP, an extension the adapter ships
    (Claude's live `_meta`) and the agent's own channel (Codex's app-server)
    come before the endpoint, and Claude Code's endpoint isn't asked while a
    session has said its windows in the last five minutes.
  - **Rate.** At most one call per account a minute, five for Anthropic's,
    whose endpoint limits how often it is asked; a 429 waits as long as its
    `Retry-After` says (at most a day), or longer each time where it doesn't;
    callers asking together share one call; the last windows show meanwhile,
    with their age.
  - **Failures are shown, not hidden.** A refused sign-in (401, 403) is
    "sign-in expired": the agent renews it the next time it runs on the
    account, and Althar never does. No sign-in where the agent keeps it is
    "no plan here" for Kimi Code (a key), and a fault to look at for the
    others. Another shape is "the usage source changed"; no answer is
    "can't reach it". Never zeros, never "no limits".
  - **One module opens a credential store** (`credentialStore.ts`), imported
    only by the reader (`usageRead.ts`) and not exported from the package. It
    scans the file, or the keychain item's text, a chunk at a time and builds
    only the string on its path. A test fails if another file imports it, or
    if it can write.
  - **The caller names a source; it cannot supply one.** The reader takes a
    source id and the account's agent and provider, and finds the source in
    the registry for that pair's plan.
  - **Tests and the end-to-end app read no real sign-in**: their runtimes
    answer every usage read with "none".
  - **A contract test** (`usageSources.test.ts`) holds it: every agent's plan
    declares a source or why it has none; every endpoint is `https`, a `GET`
    and on the allowlist; against a fake home, token, keychain and server,
    one request goes to the one URL with the token, the home is
    byte-identical afterwards, the token is in nothing the reader returns or
    logs, a redirect is not followed, a 401 is "expired" with no renewal, a
    429 waits, and another shape is "source changed".
- **Agents not read**, each said calmly in the registry and the window: Copilot
  (its sign-in is in a keychain item another app reading would ask about,
  and its SDK's `account.getQuota` wasn't confirmed here), Junie (its credits
  only in its own `/stats`), Mistral Vibe (its usage only in Mistral's
  console, behind a browser session), Qwen Code (its quota said only when it
  runs out), Antigravity (Althar runs its ACP server, not the `agy` CLI whose
  `/usage` Orca reads), and OpenCode's plan sign-ins (kept in its own
  database). Their limits are still recognised when they hit
  (`failures.ts`).
- **Alternatives considered:**
  - **No exception: errors only.** Althar would learn of a limit only once a
    step failed on it, and couldn't steer work before.
  - **Keep Anthropic out.** Claude Code's idle accounts would show nothing
    until their next turn; the person decided otherwise.
  - **Let Althar renew a token it found expired.** Writing to the agent's
    credential store races with the agent (Kimi Code's renewal signs its own
    CLI out) and is the larger risk.
  - **Read the whole credential file.** Wider than the one string it needs.
- **Trade-off:** Althar's own rule gets a hole, narrow and tested, where the
  product's largest security promise sits. The endpoints are undocumented
  and can change or start refusing without notice; a source that breaks shows
  as a fault, and errors still say when a limit is reached.
- **Revisit when:** ACP's quota feature lands and adapters report it (the
  endpoint step goes, agent by agent); a provider documents a usage read or
  forbids this one; or the contract test finds a way the token leaves the
  reader.
