# ADR-050: An ACP agent joins where Althar can hold it to asking, and the rest wait with their reasons

- **Status:** Accepted
- **Date:** 2026-10-19
- **Owner:** Repository maintainers
- **Context:** People pay for more coding agents than the three Althar ran
  (Claude Code, Codex, OpenCode), and most of them now speak ACP: the ACP
  registry listed 43 in October 2026. Eleven are the most used, or run on a
  plan people already have: GitHub Copilot CLI, Cursor, Google Antigravity,
  Kimi, Grok Build, Junie, Factory Droid, Mistral Vibe, Devin, Auggie and
  Qwen Code. ADR-002 says another agent is a registry entry and the contract
  suite, and ADR-007 that every session starts where the agent asks. Each of
  the eleven was read from the agent itself on 18 and 19 October 2026: its
  ACP replies, started with a home of its own and no sign-in, and where it
  takes one, against a stand-in model on the computer, so its sessions,
  options and permission requests were seen; and its own code and help.
  They differ most in what keeps them asking: a mode, a session's `_meta`,
  an option that approves everything while on, a command the person can
  type that turns asking off, settings a repository can write, a sign-in
  every folder shares.
- **Decision:**
  - **An agent joins where Althar can hold it to asking:**
    1. a mode Althar sets and checks, or `_meta` seen to hold it, where it asks
       before it runs a command (edits inside the workspace may go unasked,
       as Codex's do in its sandbox);
    2. a role that only reads is held too: by a mode that keeps Althar's tools
       and takes the agent's edits away, or by edits that ask, so Althar's
       rules refuse them;
    3. what it was read from is the version the registry lists, with
       permission options whose kinds are known;
    4. its vendor's terms let a third-party app use its sign-in, or its vendor
       publishes it for any ACP client to run; where those two disagree, the
       person is told before they sign in.
  - **Six join:** GitHub Copilot, Junie, Grok Build, Kimi Code (Kimi CLI
    1.x's successor), Mistral Vibe and Qwen Code, each the person's own install
    (Copilot's Althar can download, as its license lets anyone install it).
    What each does differently is in its entry's `knownGaps`.
  - **Google Antigravity joins as Orca (stablyai/orca) runs it,** read from
    Orca's code and its recording of a real 1.3.0 session, not yet started
    here:
    - Google's own ACP server, `agy_acp_server.par`, which the `agy` CLI
      doesn't have. Google publishes it in the ACP registry for other
      editors, with no license to pass it on and no checksums, so Althar
      downloads it from Google only when the person asks: version 1.3.0,
      the archive and both programs in it (the server and the harness it
      finds beside itself) pinned by the sha256 Orca measured, kept together.
      There is no Windows build.
    - Every role runs in `default`, and its mode is held there
      (`options.held`), as its `auto_edit` and `yolo` approve without asking;
      it has no read-only mode, so a reader's writes meet Althar's rules.
    - The model asks the person as a permission request on an `interaction_`
      tool call, one `allow_once` option for each answer: the rules would
      allow the first answer, so it goes to the person as a question, and is
      cancelled where no one can answer.
    - It signs in only over ACP's `authenticate`, with a Google account,
      inside Althar: its own browser is turned off (`BROWSER=true`) and
      Althar opens the page it prints. Its sign-in is the home's own file
      (`AGY_ACP_FORCE_FILE_STORAGE`) rather than the keychain item every
      server on the computer shares, so each account is its own.
    - Google's Antigravity terms call reaching it with its Google sign-in
      from third-party software a breach that can suspend the account, while
      Google lists this server for other editors. Whether an ACP client like
      Althar counts is not settled, so the sign-in says so before the person
      picks it.
  - **What holds them is data in each entry,** read where every agent's is:
    - `modes` may be null, for an agent with no mode (Grok) that asks by its
      `sessionMeta`; started so, it is refused if it offers modes after all.
    - `options.held` keeps an option at a value for the session's life (Copilot's
      `allow_all`, Junie's `brave_mode`): set as it starts, set back when the
      agent moves it. Where it can't be set back, the turn fails and the
      session takes no more prompts. A role that only reads holds its mode option the same way,
      every agent's, so a reader that leaves its mode is put back.
    - `commands: 'althar'` says the person's messages that start with `/` to
      the agent as words, where one of its commands turns its asking off
      (Copilot's `/yolo`, Grok's `/always-approve`); Althar's own `/compact`
      goes bare.
    - `home.accounts: 'one'` keeps an agent whose sign-in every folder shares
      (Mistral Vibe's keychain item), or might, to its usual account.
    - `signIn.status` may be missing: Althar can't tell until a session starts.
    - `cli.node` runs an npm-installed Node script with its folder first on its
      PATH, where its Node is.
    - `permissions.questions` names the tool calls on which a permission request
      is the model asking the person (Antigravity's `interaction_`).
    - `launch.privateTemp` gives each process a temporary folder of its own,
      removed once it has stopped (Antigravity unpacks about 1 GB there as it
      starts).
    - `cli.download` may be one version from its maker's address, the archive
      and each file in it pinned by sha256, all of it kept.
    - `signIn.inApp` may be ACP's own `authenticate`, and `signIn.login` empty
      where the agent has no command to sign in with in a terminal.
  - **Four wait, each for a reason that can change:**
    - **Cursor:** its facts are from a build two months older than the
      registry's, re-published by a third party, as its own downloads were
      out of reach; its plan and ask modes are its servers' and may not keep
      Althar's tools. A signed-in probe of the current build decides it.
    - **Devin:** no mode asks before an edit (`normal` doesn't stick), and its
      permission options include ones that switch the session to bypass, of
      kinds not seen.
    - **Factory Droid:** its `Script` tool never asks in an ACP session.
    - **Auggie:** nothing asks unless each tool is named at launch, and its
      license forbids building it into other software without permission.
  - **Kimi CLI 1.x** is archived; Kimi Code is its successor.
  - `scripts/probe.ts` probes the six, and Cursor, Devin and Droid, so a
    person signed in can read them.
- **Alternatives considered:**
  - **Antigravity held back until its terms are settled,** as this record
    first decided: Orca runs it, Google lists it for ACP clients, and the
    person can weigh the risk, told it before they sign in.
  - **All eleven, each gap in its `knownGaps`:** an agent that edits or runs
    unasked where Althar thinks it asks, or reads where it can write, breaks
    ADR-007 for every task it leads, and the person would not know.
  - **Only those that pass with no new mechanism:** Copilot, Junie and Grok
    each need one (a held option, a held option, a session with no mode), and
    every one of the six one of the others; each is a few lines in the
    adapter, tested against the fake agent.
  - **Writing each agent's settings to make it ask:** Grok's account config
    can hold ask rules that beat the allow rules it reads from the person's
    Claude Code settings; but the usual account's config is the person's,
    and ADR-007 rules out writing it.
- **Trade-off:** none of the six has run against its vendor's models yet,
  signed in (`bun run test:agents`): mode ids, option ids and permission
  options were seen, but turns on a real account weren't. A repository's own
  settings can approve for Copilot (hooks), Qwen Code (allow rules) and Grok
  (once trusted), so none leads a review of a pull request. Four have no
  status command, so whether they are signed in shows only as a session
  starts. Copilot, Junie and Mistral Vibe have one account each until their
  sign-ins are seen apart, or Althar signs a home out before removing it.
  Antigravity's approvals' option ids aren't known, so each is read by its
  kind; its usual folder's `config/` loads the person's hooks and MCP servers;
  it stays at the version pinned until someone measures the next; and Google
  may hold a sign-in from Althar against the account.
- **Revisit when:** an agent's signed-in contract run differs from its entry;
  Cursor's current build is probed signed in; Google says whether its
  Antigravity terms cover an ACP client, or publishes a newer server or its
  checksums;
  Devin gains a mode that asks before edits; Droid's `Script` tool asks;
  Augment permits integration; Copilot's or Mistral Vibe's sign-in is seen per
  folder; Althar's downloads unpack a folder or a zstd file (Mistral Vibe,
  Qwen Code, Kimi Code).
