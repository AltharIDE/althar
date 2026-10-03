# ADR-012: Several accounts per agent, each in its own home

- **Status:** Accepted
- **Date:** 2026-10-03
- **Owner:** Repository maintainers
- **Context:** Many developers have more than one sign-in for the same agent:
  a work and a personal Claude plan, a ChatGPT plan per client, three
  OpenCode logins. A whole family of tools has grown up to switch between
  them (Codex, OpenCode and Claude Code account switchers). Charrette
  assumed one sign-in per agent per Mac: it took whatever the agent's usual
  folder held, and a usage limit put the whole agent out. Each agent's CLI
  keeps its sign-in in a folder it can be pointed at: Claude Code in
  `CLAUDE_CONFIG_DIR` (on macOS, a Keychain item named after the folder's
  path), Codex in `CODEX_HOME`, OpenCode under `$XDG_DATA_HOME/opencode`.
  Charrette never reads, copies or moves an agent's credentials
  ([03](../architecture/03-agent-runtime-and-auth.md), Vendor CLI and
  subscription login policy), and runs many sessions of one agent at once.
- **Decision:**
  - An **account** is one sign-in of an agent, in its own folder, its
    **home**. The agent's usual folder is its first account, so a person
    with one sign-in sees no change. Charrette starts each session with its
    account's home in the agent's environment, and records which account
    each session ran on.
  - **Adding an account** makes a home and opens the agent's own sign-in in
    it, in a terminal, for the person. Charrette never sees the credential.
    A home Charrette made holds that account's sign-in and the agent's own
    history. The person's usual settings, instructions and skills are linked
    into it, so every account works the same way. A home stays where it was
    made: Claude Code ties its Keychain item to the folder's path.
  - **A home another tool made is adopted as it is.** Switchers that give
    each account a folder of its own are found where they keep them, and
    any other folder can be added by hand. Charrette lists their names and
    never opens what is inside.
  - **Switchers that swap one live sign-in** (copying a saved login over
    the agent's usual one) are left to the person. Whatever they made active
    is the agent's first account. Charrette doesn't drive them. A swap
    changes the account under every session already running, and a login
    kept in two places breaks when one copy refreshes. The sign-in check
    notices a swap, and it is recorded. To run several of those accounts at
    once, the person adds each to Charrette, signing in once in its own
    home.
  - **Switchers that rotate inside the agent or in front of it** (an
    OpenCode plugin, a local gateway) work unchanged. Charrette sees one
    account, whose usage limit means the whole pool is out.
  - **A pool, which a project can narrow.** Every account the person adds
    can run work. A project's rules may limit each agent to some of its
    accounts (a client's repository to the client's plan). Like any rule
    change, this makes a new revision, which a run cites.
  - **Picking an account:**
    - A conversation stays on the account it runs on.
    - A new session takes the first account, in the person's order, that is
      allowed for the project, signed in, and not out of usage.
  - **Usage limits are per account.** Under the project's "move on" rule,
    work goes first to the same agent's next allowed account. It runs the
    same model, in a new session from a brief, as at any switch
    ([ADR-005](005-charrette-briefs-every-agent.md)). Only then does it go
    to the next agent.
  - **Paid by:**
    - Another agent takes work over unasked only on an account a plan pays
      for, as before.
    - The agent's own accounts take it over whatever pays for them, since the
      person added each one. Some agents can't tell a plan from a key at all:
      OpenCode always says a key.
  - The thread names the account on both sides of the move.
- **Alternatives considered:**
  - **Swapping the agent's usual sign-in, as most switchers do.**
    - It needs no homes, but it is one account per Mac at a time.
    - It races the sessions already running.
    - It means Charrette copying credentials, which it never does.
  - **One account per project only.** It is simple and fits work and
    personal, but a usage limit can't move work to the person's other plan.
  - **A pool with no project rule.** Simplest, but a client's code could run
    on another client's plan.
  - **A local gateway that picks the account per request.** It relays the
    person's tokens, and it works for only one agent's API at a time.
- **Trade-off:**
  - Each home Charrette makes is a sign-in for the person to make once.
  - An agent's own history is split across homes. Charrette's thread is the
    record that carries over, so a move between accounts starts a new
    session from a brief rather than loading the old one.
  - `XDG_DATA_HOME` reaches every program an OpenCode session runs, not
    only OpenCode.
  - Providers' terms differ on several personal plans. Each account is the
    person's own, and adding one and allowing it for a project is their
    choice to use it.
- **Revisit when:**
  - An agent gains first-class profiles (Codex's `--auth-profile`
    proposal).
  - A provider's terms change about several accounts or third-party apps.
  - An agent's ACP adapter can load a session started under another
    account.
