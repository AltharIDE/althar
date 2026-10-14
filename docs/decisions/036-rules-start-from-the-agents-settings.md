# ADR-036: A project's rules can start from its agents' own settings

- **Status:** Accepted
- **Date:** 2026-10-13
- **Owner:** Repository maintainers
- **Context:** Teams spend months tuning their agents' permission files:
  Claude Code's `permissions` in `.claude/settings.json`, Codex's rules,
  OpenCode's `permission` in `opencode.json`. When they adopt Althar, its
  rules take over. Every Claude Code session gets ask rules that beat allow
  rules from any settings file
  ([03](../architecture/03-agent-runtime-and-auth.md)), and
  [ADR-013](013-project-rules.md) rejected the agents' own files as the
  source of the rules, because their shapes and reach differ. That is right
  for enforcement: one reading of a request that holds across agents. For
  adoption it meant starting from nothing and teaching Althar again what the
  team had already written down (DEV-41).
- **Decision:**
  - **The agents' files are the first draft of the project's rules, never
    their source.** Althar reads them and offers what they say as a
    proposal. The person takes all of it, some or none, and nothing is kept
    until they do. What they take is a copy: Althar never writes the agents'
    files, and never reads them again on its own. ADR-013's precedence is
    unchanged, and what no project can change still wins.
  - **What is read** (`agentRules.ts`), from each of the project's
    repositories on this device, then the person's home folder:
    - Claude Code: `permissions.deny`, `ask` and `allow` in
      `.claude/settings.json`, `.claude/settings.local.json` and
      `~/.claude/settings.json`.
    - Codex: each `prefix_rule` in `.codex/rules/*.rules` and
      `~/.codex/rules/*.rules`. They are Starlark, read as far as rules go
      (strings, lists, keyword arguments and comments), never run.
    - OpenCode: `permission` in `opencode.json` (or `.jsonc`) and
      `~/.config/opencode/opencode.json`, comments and trailing commas
      allowed, as OpenCode reads them.
    - A repository's file is named by its path in the repository, after the
      repository's name where the project has several; the person's by its
      path under `~`. A file that is there but can't be read as its agent
      reads it is named as unreadable, with nothing taken from it.
  - **How a rule is said in the project's words:**
    - A refusal (`deny`, `forbidden`) becomes a never; an ask (`ask`,
      `prompt`) an always ask; an allow an allow rule
      ([ADR-018](018-allow-always-keeps-a-rule.md)).
    - A command without a wildcard is the whole line, an exact rule. A
      wildcard only at the end is how the command starts: `Bash(npm
      test:*)`, `Bash(npm test *)` and OpenCode's `"npm test *"` are `npm
      test`, which matches `npm test` alone too, as theirs does. Codex's
      patterns are how a command starts, word by word; alternatives in a
      place make a rule each.
    - A wildcard before the end is kept for a never or an ask, where
      Althar's reading, by how a command starts, catches a little more. For
      an allow it would let more through, so it is skipped. A wildcard first,
      or OpenCode's `?`, can't be said at all.
  - **What can't be one of the project's rules is listed as skipped, with
    why:** rules on paths (`Read(…)`, `Edit(…)`, OpenCode's `read`, `edit`,
    `external_directory`), on the web (`WebFetch(domain:…)`, `webfetch`),
    on MCP tools, on the agents' other tools; a rule for every command
    (`Bash`, `"bash": "ask"`, `"*"`), which the project's mode says
    instead; one for a single OpenCode agent; one what no project can
    change says already (reading credentials, or `gh` changing the code
    host); one the project has already, or has above it.
  - **For the same words, what comes first is offered,** as each agent
    weighs its own (deny, then ask, then allow): an allow under a never or
    an ask from another file, or in the project, is skipped as under it. A
    never or an ask over an allow the project has takes its place. A rule
    is offered once, from the first file that has it.
  - **An imported rule keeps its source,** the agent and its file, in the
    rules (`from` on a command rule). The rules screen says it under the
    rule's sentence. Only the runtime writes it: a rule the rules screen
    sends keeps the source of the rule it was, while it stays the same
    words and decision, and a new one has none.
  - **It is offered once, as a project is made,** and from the rules screen
    whenever the person asks ("Import from your agents"). The offer stands
    until the person answers it, taking some or none
    (`projects.offers_agent_rules`). Projects made before this aren't
    offered it. Taking is one revision of the rules, recorded as the
    person's, and a fact on the project
    (`project.agent_rules_taken`) with what was taken.
  - **The choice names what was read.** Each rule has an id from its file,
    its words and what it becomes. Taking re-reads the files and takes only
    rules still offered; one that isn't (a file changed since it was read)
    takes nothing (`AgentRulesChanged`), and the proposal is read again.
- **Alternatives considered:**
  - **Keeping the agents' files in sync with the project's rules,** both
    ways. It would make each agent's file a second source of the rules,
    which ADR-013 rejected, and Althar would write into the repository. Not
    now.
  - **Taking them without asking.** The person keeps what is refused and
    what waits for them; a file Althar finds shouldn't change that unseen.
  - **Reading every agent setting** (Claude Code's `defaultMode`, Codex's
    `approval_policy`). They are modes, which the project's own mode
    already says, and they differ by agent.
  - **Translating path and network rules into kinds.** The project's rules
    have no paths or domains yet; a rule half translated would read as
    holding when it doesn't.
- **Trade-off:** a copy goes stale: the agents' files and the project's
  rules drift apart once either changes, and Althar doesn't say so. The
  proposal can be opened again to bring in what is new. Rules on paths, the
  web and MCP tools stay the agents' own, enforced, if at all, by the agent.
- **Revisit when:** the project's rules hold paths or the network; the
  rules live in the repository, where a team shares them; or teams ask for
  the agents' files to follow the project's rules.
