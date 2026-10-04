# ADR-013: Project rules: a mode, always ask, never, and command rules

- **Status:** Accepted
- **Date:** 2026-10-04
- **Owner:** Repository maintainers
- **Context:** Every permission request reaches Charrette
  ([ADR-007](007-permission-requests-reach-charrette.md)), which answers it
  from its own rules. In the MVP those were fixed in code: everything
  allowed, except a list of risky kinds that always asked. A project needs
  to set this for itself. As of October 2026 the agent tools have converged
  on the same shape:
  - **A ladder of modes.**
    - Claude Code: Manual, accept edits, plan, auto with a classifier,
      bypass.
    - Codex: Read only, Auto, Full access, with an automatic reviewer as an
      option.
    - VS Code: Manual, Assisted with a model as judge, Allow all.
    - Goose: Manual, Smart, Autonomous, Chat only.
    - Cursor: an allowlist in the sandbox, auto-review, run everything.
  - **Rule lists that allow, ask or refuse, with refusal winning.**
    - Claude Code: deny, then ask, then allow.
    - Codex's rules: forbidden over prompt over allow, by command prefix.
    - Gemini CLI's policy engine: allow, ask the user, or deny, by priority.
    - Others: OpenCode's patterns per tool, Roo's allowed and denied
      commands, Amp's allow, ask, reject or delegate, and VS Code's terminal
      auto-approve, where a "no" wins.
  - **Commands matched by how they start**, a prefix with wildcards, and
    each command of a shell line on its own. Claude Code and VS Code do
    this. Tools that matched the whole line naively have been bypassed (Roo
    through a pipe, Cursor through shell builtins).
  - **Scopes:** the user's, the project's (in the repository), local, and an
    organisation's, managed.
- **Decision:**
  - **What a project's rules hold** (`Policies.ts`, read by `rules.ts`):
    - **A mode**, for what no rule keeps:
      - `rules` (the default): allowed;
      - `ask`: it waits for the person, except reads;
      - `allow`: everything is allowed, short of what is never allowed.
    - **The kinds that always ask the person:**
      - pushing to the default branch;
      - force pushes;
      - pushing every branch, tags, or a pattern of branches;
      - deleting branches that aren't the task's;
      - deploying and publishing;
      - writing outside the task's worktree.
    - **The kinds that are never allowed.**
    - **Commands the person names** by how they start (`npm publish`,
      `terraform *`), to ask about or refuse.
    - **How a task ends** when its plan doesn't say.
  - **Precedence.** A request can be several kinds at once: `git push
    --force origin main` is a force push and a push to the default branch.
    Every kind counts.
    1. What no project can change: reading credentials, and changing the
       code host
       ([ADR-011](011-own-connectors-for-hosts-and-trackers.md)).
    2. What is never allowed, any kind of it or a command.
    3. Allowing everything. While Never lists anything, a request the rules
       can't read (`eval`, `$(…)`) is refused, saying how to spell it out:
       there is no one to ask.
    4. What asks: a kind on the always-ask list, a request the rules can't
       tell, or a command the project asks about.
    5. Asking about everything beyond the task's own files: reads and
       changes inside the worktree are let through, as every agent's
       sandbox would.
    6. Otherwise, allowed.
  - **How command rules match:**
    - Each command of a line is read as the shell would run it, with
      environment assignments and wrappers such as `sudo` and `timeout`
      taken off.
    - It is also read as what a package runner (`npx`, `pnpm exec`, `bunx`)
      or an interpreter (`bash script.sh`) runs for it.
    - The program is matched by its name, wherever it lives. `*` matches
      anything, and a lone `*` also matches nothing (`psql *` matches
      `psql`).
    - A line whose commands only show when it runs (`eval`, `$(…)`) meets a
      rule whose program it names as a word of its own.
  - **Deploying is read where a command says it:** in a tool's subcommand
    (`fly deploy`, `terraform apply`), a script named for it
    (`./deploy.sh`), or a runner's target (`make deploy`, `npm run
    deploy`). It is never read from arguments or quoted text, so `grep
    deploy` and `git commit -m "Fix the deploy script"` aren't deploys.
  - **A task's ending is worked out once, when its plan is made:** the
    plan's own, else the project's, else a draft where the host is
    connected. A project that wants a pull request but whose repository
    names no host Charrette knows ends on its branch.
  - **They hold for what reaches Charrette:** what an agent asks to do beyond
    its sandbox, which is the network or outside the task. The screen says
    so.
  - **Each change is a revision, recorded as the person's.** The rules as
    they are decide the next request; a run cites the revision it started
    under.
  - **The screen offers only what Charrette does.**
    - "The lead decides", the modes with a model as judge in other tools,
      comes when the lead answers requests.
    - The review findings row and asking about a usage limit come later.
- **Alternatives considered:**
  - **Each agent's own rule files** (`.claude/settings.json`, Codex's rules,
    `opencode.json`). Each agent's differ in shape and reach. Charrette's
    reading of a request is the one that holds across agents.
  - **An allowlist** (Cursor's). Charrette is permissive by default, and the
    person keeps the exceptions; an allowlist inverts that. One could serve
    the `ask` mode later.
  - **A model as judge now.** It comes as the lead deciding, which has its
    own step.
  - **Regular expressions** (VS Code). They are harder to read and to get
    right. A prefix with `*` is what most tools offer.
- **Trade-off:**
  - **Rules don't see what an agent does inside its sandbox.** Codex's
    `workspace-write` and Claude Code's sandboxed commands run without
    asking, so a rule for a command that stays in the worktree never fires.
    Giving each agent the project's command rules in its own form would
    close that gap: Claude Code's ask rules, OpenCode's bash patterns, and
    Codex's rules.
  - **The rules live in Charrette's store, not the repository**, so a team
    can't share them yet.
- **Revisit when:**
  - The lead answers requests.
  - Charrette has a cloud, for shared or managed rules.
  - An agent's sandbox stops asking about what the rules need to see.
