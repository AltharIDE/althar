# ADR-104: Secrets

> A proposal, not built. Once decided it becomes an area document of its
> own, `docs/decisions/secrets.md`, and the decisions it changes link to it
> ([What this changes](#what-this-changes)).

- **Status:** Proposed
- **Date:** 2026-11-09
- **Owner:** Runtime and desktop maintainers
- **Context:**
  - **What's built.** Code host and tracker tokens are sealed in `Secrets`
    (`packages/runtime/src/Secrets.ts`), through Electron's `safeStorage`,
    and never in plain text
    ([ADR-028](../packaging.md#off-a-mac-windows-and-the-keyring)). Agents'
    environment is an allowlist, so the person's API keys in it don't reach
    agents.
  - **What isn't.** There is nowhere for a project's own secrets, such as
    `DATABASE_URL` or `STRIPE_SECRET_KEY`, or for the person's API keys and
    MCP servers' tokens. The result:
    - **`.env` is the de facto store.** Setup copies a project's `.env` into
      every task folder
      ([ADR-080](../workspaces-and-runs.md#setting-up-a-tasks-folder)), and
      agents read it freely.
    - **MCP tokens leak.** An MCP config's `${VAR}` is filled from Althar's
      whole environment. Adding a server in Settings writes its token in
      plain text into each agent's config.
    - **Records keep values.** Logs and transcripts are kept without
      masking.
  - **What others do.** Read on 9 November 2026 (sources under
    [Research](#research)). There are three layers:
    1. **Seal values at rest** in the operating system's password store (VS
       Code, Zed, JetBrains).
    2. **Hand each process only the secrets it needs.** Codespaces and
       Copilot's cloud agent scope secrets to repositories. OpenHands and
       Devin export a secret only to the command that names it.
    3. **Keep the value from the agent altogether.** The agent's sandbox gets
       a stand-in, and a proxy swaps in the real value on the way to an
       allowed host (Claude Code's `sandbox.credentials` mask, VS Code's
       credential-masking proxy). This is the strongest of the three.
  - **What T3 Code adds.**
    - **Password-manager pointers.** It holds `op://vault/item/field` and
      reads it through 1Password's `op` when needed, with one unlock.
    - **A request card.** An agent asks for a missing secret on a private
      card, never in chat.
    - **A weakness.** It keeps typed-in values as plain files, protected only
      by their permissions.
  - **Filters and masking are not walls.** Filters at the tool level, such
    as `.cursorignore` or `Read(.env)`, don't stop `cat .env`. Masking output
    is best-effort.
  - **The brief.** Lean towards ease of use, with sensible security. A
    project's home and its workers can each be on this computer, on the
    person's own host, or in Althar's cloud
    ([ADR-103](103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md)).

## Decision

In short:

- **One store.** Every secret is kept in one store, sealed wherever the
  project's home is, and never in the database.
- **A reach for each secret.** Each secret says who it reaches: the agents'
  commands, only what Althar itself runs, or only Althar.
- **Sensible defaults.** A project's secrets reach agents, except ones that
  look live, which are suggested for Althar's runs only. The person's own
  keys stay with Althar.
- **No more copies of `.env`.** Althar reads a project's `.env` where it is,
  instead of copying it into task folders.
- **Masking.** Althar masks every value it knows in what it records and
  shows.
- **A card for asking.** An agent asks for a missing secret on a card.
- **The same in every place.** It works on this computer, on the person's own
  host and in the cloud. Only the seal differs.
- **Later:** stand-ins that let agents use a secret without seeing it, and
  password-manager pointers.

### What a secret is

A secret has:

- **A name**, as the environment sees it: `STRIPE_SECRET_KEY`.
- **A source** for its value:
  - Althar's store;
  - a `.env` file Althar reads from;
  - later, a password manager's pointer.
- **A reach**, as [below](#its-reach).
- **An owner**, one of two:
  - **The project.** Its tasks use it, such as the app's own keys.
  - **The person.** Their API keys for agents and their MCP servers' tokens.
    These follow the person and are never shared.
- **The hosts it is sent to**, such as `api.stripe.com`. This is optional,
  and is for the stand-ins to come.

The database keeps everything except the value: the name, owner, source,
reach, hosts, and when it last changed. It never keeps anything a value can
be recovered from.

### Its reach

| Reach | Who gets the value | Default for |
|---|---|---|
| **Agents can use it** | Everything a task runs: the lead's own commands, and Run, setup and checks | A project's secrets |
| **Only Althar's runs** | What Althar starts: Run, setup, the checks it runs, and its tools that run for a lead ([ADR-057](../what-agents-may-do.md#althars-tools-outside-the-sandbox)). Not the agents' own shells | A project's secrets that look live: a known live prefix such as `sk_live_`, or `PROD`, `PRODUCTION` or `LIVE` in the name. Suggested; the person can change it |
| **Only Althar** | Althar, for its own calls, or the one program the key is for, through that program's own way of taking a key | The person's API keys for agents, MCP servers' tokens, and code host and tracker connections |

What each reach means:

- **Agents can use it.** An agent's command can print the value, and a
  printed value reaches its model's provider. That is the price of agents
  running the project's tests themselves. The screen says so in one line,
  and stand-ins remove the price for secrets sent only to known hosts.
- **Only Althar's runs.** This reach holds against the agent. Althar sees its
  own tools' output first, and masks every value before the lead reads it.
- **Only Althar.**
  - **Agents' API keys are never in a shell.** Each agent gets its key the
    way it takes its own sign-in, in that account's home
    ([ADR-012](../agents.md#accounts)), which agents may not read. Where an
    agent takes a key only from its environment, Althar turns on the agent's
    own scrubbing of its shells: `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` for
    Claude Code, `shell_environment_policy` exclusions for Codex.
  - **MCP tokens come from the person's secrets.** A server's `${VAR}` is
    filled from them, never from Althar's environment. Adding a server keeps
    its token as a secret, and writes a reference into each agent's config
    where that config takes one.
  - **No other process gets these values.** Probes, syncing and Althar's own
    git are included.

### Where values come from

- **Althar's store.** Values typed in, imported, or saved from a card go
  here.
- **A `.env` file Althar reads from.**
  - **Naming the file.** The project names its `.env` files once, and Althar
    offers to on first sight of one.
  - **When it is read.** Althar reads the file where it is, each time a
    process starts, so editing it in the person's editor keeps working.
  - **No copies.** It is no longer copied into a task's folder. Its values go
    into each process's environment instead. Most tools that load `.env`,
    such as dotenv, Next.js and Vite, keep a variable that is already set.
  - **When a tool needs the file itself**, the project can have it written
    into the task folder. Compose's `env_file` is one such tool.
  - **Agents can't read it.** A file Althar reads from or writes is among
    the reads agents are refused
    ([`SECRET_PLACES`](../what-agents-may-do.md#what-asks)).
  - **Only on its own computer.** A home or worker elsewhere can't read the
    file. The task says so, and offers **Keep these in Althar**, which copies
    the values into the store.
- **A password manager's pointer** (later).
  - **1Password first,** through `op`. Its value is read when a process needs
    it, and cached until the person refreshes, so it takes one unlock, not
    one per task.
  - **Homes nobody sits at** use a service account.
  - **A pointer that can't be read fails.** It never falls back to another
    account.

### How a value reaches a process

- **Only what the reach allows.** A process's environment gets only the
  secrets its reach allows, added to the allowlist it already has.
- **Per attempt, to workers.** A worker gets only what that task's processes
  need. It is sent from the home for that attempt, over the authenticated
  channel, and held in memory, never on the worker's disk. It goes when the
  attempt, and the processes it started, end. A worker never sees the rest of
  the store.
- **A running agent keeps the environment it started with.** A secret saved
  while a lead works reaches Althar's tools at once, and the lead's own shell
  from its next session.

### Keeping values out of records

- **What is masked:** every value Althar knows, in everything it keeps or
  shows. That covers thread items, tool output, permission inputs, artifacts,
  `main.log`, `runtime.log`, `agents.log`, problem and crash reports, and the
  window.
- **What counts as the value:** the value as written, and its base64 and
  URL-encoded forms, for values of 8 characters or more. A value split
  between two chunks of a stream is still caught.
- **Masking runs before anything is written,** beside the patterns
  `apps/desktop/src/logs/mask.ts` already masks.
- **What it can't protect:** an agent's own shell shows its output to its
  model before Althar sees it. Masking protects Althar's records and the
  screen. It protects the model only where output passes through Althar
  first, as with Althar's own tools. That is why "Only Althar's runs" exists,
  and why stand-ins come next.

### An agent asks for a secret

- **The tool.** Leads and the coordinator get `request_secret`. It takes a
  name, why the secret is needed, the page where the person gets one, and a
  suggested reach.
- **The card.** It opens a card in the thread and in Needs you, as a question
  to the person ([ADR-021](../tasks.md#questions-to-the-person)). The person
  can type the value, pick a secret they have, give a pointer, or decline.
- **The value never passes through the conversation.** It goes from the
  window straight to the home. The thread records only "saved as
  `STRIPE_SECRET_KEY`" or "declined".
- **It is saved as a project secret,** so it is asked for once, not in every
  task.
- **A decline is final for the conversation.** The agent is told not to ask
  again in chat, to say what is blocked, and to go on without it.

### In every place

| Place | How the home seals | Where a worker holds secrets | Stand-ins' proxy |
|---|---|---|---|
| This computer | The operating system's password store, through `safeStorage`; never plain text (ADR-028) | In memory, for the attempt | On this computer |
| The person's own host | Encrypted files, with a master key from the service manager kept apart from them ([ADR-103](103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md#sign-ins-secrets-mcp-servers-and-skills)) | In memory, for the attempt, under the worker's own user | On the worker |
| Althar's cloud | A key for each project, wrapped by a key service and never kept beside what it seals; every unwrap is logged | In memory, for the attempt | On the worker |

- **One seam.** `Secrets` stays the seam, with one implementation for each
  seal. Nothing above it knows where it runs.
- **The person's keys stay on their device** until they let a home elsewhere
  have one, with one switch for each home. A subscription's sign-in never
  goes remote (ADR-103); an API key may.

### Later: stand-ins, swapped on the way out

- **How it works.** For a secret with hosts, an agent's commands get a
  stand-in such as `althar-secret-7f3a…`. A proxy on the worker swaps in the
  real value only in requests to those hosts. The agent can't print or send
  what it never had.
- **The proxy.**
  - It terminates TLS with a certificate authority made for that worker.
  - Each task's sandbox trusts that authority through `NODE_EXTRA_CA_CERTS`,
    `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE`.
  - It opens only traffic to hosts that carry a secret, and passes the rest
    through untouched.
  - It is the same component in every place.
- **Claude Code first.** Claude Code's own `sandbox.credentials` mask can
  stand in for Althar's proxy on Claude leads. Althar sets it from the
  person's settings, never from the repository's.
- **When it becomes the default.** Once stand-ins work for an agent, "Agents
  can use it" becomes "Agents use it without seeing it" for every secret with
  hosts. New secrets with hosts start that way.
- **What stays as it is.** A value that isn't sent over HTTPS, such as a
  database URL, keeps its reach.

### The screen

- **Project settings → Secrets.**
  - It lists each secret's name, source, reach, and when it last changed.
  - Values show as `••••` in mono, with a button to reveal one.
  - It holds the `.env` files Althar reads from, and **Import a .env**.
- **Settings → Your keys.** Agents' API keys and MCP servers' tokens.
- **Each reach has one sentence beneath it**, saying what it means.
- **What blocks a task shows on the task**
  ([DESIGN.md](../../../DESIGN.md)):
  - a secret it needs that is missing;
  - a pointer that can't be read;
  - a `.env` a home elsewhere can't reach.

### What this changes

- **[ADR-080](../workspaces-and-runs.md#setting-up-a-tasks-folder).** Secret
  files are no longer copied into a task's folder. They are written there
  only where the project says a tool needs the file.
- **[ADR-097](../what-agents-may-do.md#what-asks).** A `.env` Althar reads
  from, or one it writes into a task's folder, joins `SECRET_PLACES`. Other
  `.env` files are read as today.
- **[ADR-028](../packaging.md#off-a-mac-windows-and-the-keyring).** Its seal,
  and its refusal of plain text, cover all secrets, not only connections.
- **[Architecture 03, API keys and OAuth](../../architecture/03-agent-runtime-and-auth.md#api-keys-and-oauth).**
  It is built for every agent, not only OpenCode.

## Not decided here

These came up in the research and are worth their own decisions:

- **A push guard.** Git's guard could hold a push whose commits add a
  secret's value.
- **A check before sending.** The composer could offer to keep a pasted key
  as a secret.
- **Spawns that get the whole environment.** Some spawns still get Althar's
  whole environment, and setup runs in the person's interactive login shell.
  Narrowing them is general environment work.
- **Secrets on shared projects.** It covers roles and the record of changes,
  for when projects have members.

## Build, in phases

Each phase ships for every agent that can have it, and names the ones that
can't ([ADR-082](../foundations.md#a-feature-ships-for-every-service-that-can-have-it)).

1. **The store and its reaches**, on the desktop seal:
   - project and personal secrets, and the two screens;
   - `.env` files read where they are;
   - agents' API keys and MCP tokens as the person's secrets;
   - masking;
   - `request_secret` and its card.
2. **Stand-ins and pointers:**
   - the proxy on each worker, with Claude Code's mask first;
   - "Agents use it without seeing it";
   - 1Password pointers, with service accounts.
3. **Homes and workers elsewhere,** with ADR-103:
   - the seal on the person's own host;
   - Althar's cloud key service;
   - delivery to workers for each attempt;
   - the person's switch for each home.

## Alternatives considered

- **Leave `.env` as the store.** There is nothing to build, but agents read
  it, every task folder holds a copy, and it can't follow a project to a host
  or the cloud.
- **Stand-ins only, from the start.** This is the strongest option, but it
  can't carry a value that isn't sent over HTTPS. It also needs the proxy,
  and every tool trusting its certificate, before anything works. Agents
  would lose the project's tests in the meantime.
- **Only a password manager, as T3 Code does.** It suits people who have one
  and does nothing for those who don't. Typed-in values still need a store.
- **Plain files protected by permissions, as T3 Code keeps typed-in
  values.** A copied disk or backup holds them readable, and Althar's seal is
  already built.
- **One-use references for an agent's request, as T3 Code does.** They are
  safer against reuse, but the person would be asked again in every task for
  a key the project always needs.
- **Environments** (development, staging, production), each with its own
  values. They are more to set up and to read. "Only Althar's runs" covers
  the case that matters, a live key kept from agents.

## Risks and open questions

- **"Agents can use it" can reach a model's provider.** It is made smaller by
  suggesting live keys for Althar's runs only, by masking, and later by
  stand-ins. Should a new project ask once instead of defaulting?
- **Masking is best-effort.** A value an agent changes before printing it,
  for example cut in half or hashed, gets through.
- **An agent without a sandbox of Althar's** can still read a `.env` in the
  person's own checkout when a task works Local. Codex reads anywhere, and
  OpenCode has no sandbox.
- **TLS termination breaks some tools.** A tool that pins certificates, or
  ignores the variables that name a certificate authority, fails against a
  host with a secret. The task names that host, and the secret falls back to
  its earlier reach.
- **Althar's cloud holds the key service.** Whoever controls it could unwrap
  a project's key. Bringing the person's own key is a later option.

## Revisit when

- Stand-ins work for every agent Althar runs.
- Projects have members.
- Providers offer short-lived, scoped keys that Althar could mint for each
  task.
- People keep several values for one name.

## Research

Read on 9 November 2026, from source code and official docs where the
network allowed.

- **VS Code:** `SecretStorage`
  ([mainThreadSecretState.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadSecretState.ts),
  [secrets.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/secrets/common/secrets.ts)),
  and the agent sandbox's credential-masking proxy
  ([agent-sandboxing.md](https://github.com/microsoft/vscode-docs/blob/main/docs/agents/run/agent-sandboxing.md)).
- **Electron:** `safeStorage`
  ([safe-storage.md](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)).
  Its synchronous API goes in Electron 46.
- **Zed:** keys in the keychain
  ([use-api-access.md](https://github.com/zed-industries/zed/blob/main/docs/src/ai/use-api-access.md)).
  External agents keep their own sign-in
  ([external-agents.md](https://github.com/zed-industries/zed/blob/main/docs/src/ai/external-agents.md)).
- **ACP:** it dropped `env_var` sign-in in July 2026
  ([auth-methods RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/auth-methods.mdx)).
- **Claude Code:**
  [authentication](https://code.claude.com/docs/en/authentication.md),
  `sandbox.credentials` and its mask
  ([sandboxing](https://code.claude.com/docs/en/sandboxing.md)), and
  `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`
  ([environment variables](https://code.claude.com/docs/en/env-vars.md)).
- **Codex:** `shell_environment_policy`
  ([shell_environment.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/shell_environment.rs)).
  Its default exclusions are off by default.
- **OpenHands:** `SecretRegistry`, which exports a secret only to the command
  that names it and masks its output
  ([secret_registry.py](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/secret_registry.py)).
- **T3 Code**, at commit `206a8e69`:
  - `packages/secret-provider-core` and `packages/secret-provider-onepassword`;
  - `apps/server/src/secrets/SecretRequests.ts`;
  - [secrets.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/secrets.md).
- **From search summaries only:** Codespaces, Copilot's cloud agent, Devin,
  Gitpod, Che, JetBrains, Cursor, Warp and 1Password's `op run`.
