# The person's setup

What of the person's own setup an agent Althar starts gets: their MCP
servers, their skills and Althar's skill catalog, and their code host
sign-in. What these may then do, and what asks, is in
[what agents may do](what-agents-may-do.md).

**Replaces:** ADR-094,
ADR-095,
and the MCP servers, skills and sign-in parts of
ADR-097.

## In every role

Every role gets the person's setup: a task's lead, the reviewer of a task's
change, a review's lead, the coordinator and a lead's helpers. The exceptions
are the permission judge, which stays tool-free, and model probes. Leads and
the coordinator share one pool of tools, MCP servers and skills.

Althar's own path is preferred, never imposed. Every brief says what Althar's
tools give that another way doesn't: a push Althar makes is recorded, held
where someone else pushed, and goes where the project sends it. A pull
request, review or issue made through Althar's tools gets a receipt and a line
in the thread. An agent that uses the person's server or `gh` instead isn't
refused for it. What it does is read against the irreversible list.

## MCP servers

Each session is given the servers found in Claude Code's, Codex's or
OpenCode's own settings that are on there and ticked for its role in Settings
› MCP servers, for every project or one, beside Althar's own server, which is
always there. Roles are a task's lead, the reviewer and the coordinator
(`ToolRole`). A session gets exactly those, whichever agent runs it: Claude
Code takes only what it is given (`strictMcpConfig`), and Codex and OpenCode
have their own switched off by name and the chosen ones passed in. The
runtime reads the person's agents only where the desktop app gives it their
home (`agentConfigs`), so a test's runtime reads none.

An outside author's repository never loads its MCP config.

**Not built yet:** a repository's own `.mcp.json` is listed nowhere and loads
nowhere yet, since whether to trust it is the agent's own call.

**Calls are read against the irreversible list** (`mcpActs.ts`,
`irreversible.ts`). Each call reaches Althar as a permission request, as a
command does. Althar reads it by the server and tool the agent's bridge
names, then by what the tool's name says, and, for a general `graphql` or
`api` tool, by its mutation or method. A merge or a release is publishing.
A post, review or message is speaking for the person. Deleting a branch, tag
or file, or pushing to the default branch, is lost history. Each of these
asks, on a card, with everything allowed too. What widens what agents may do
on the host is refused. Every other call goes ahead. Each call's row in the
thread names its server. One that acted on the outside world stands out under
the round's work, with what it did and the words it posted (cut at 600
characters).

What reading by name and arguments can't catch:

- a tool whose name and arguments don't say what it does (a shell or browser
  server, a general `execute`, a `sync` that force-pushes);
- speaking for the person on a service Althar doesn't know;
- calls the agent doesn't send through Althar (each agent's case goes in its
  registry entry's `knownGaps`);
- steering, where a page or a comment takes the agent to a call the person
  didn't mean.

What slips past goes ahead, as an unreadable command does. An MCP broker of
Althar's own, which starts and relays the person's servers, would close it.
It isn't built, because it would have to carry each server's own sign-in.

**A server that fails mid-task.** Claude Code reports a server that failed to
start or needs signing in. A call to it that then fails says so under the
call, such as "Claude Code isn't signed in to Linear, so this didn't go
through.", with Sign in.

## Keeping the agents' servers the same

One switch in Settings keeps the person's agents' servers the same across
Claude Code, Codex and OpenCode (`mcpSync.ts`). A dialog comes before it
starts. It writes through `claude mcp add-json --scope user` and
`codex mcp add`, and edits OpenCode's JSON in place with its comments kept.

- A copy of each file is kept before Althar first writes to it, with a record
  of what it added. Taking back removes only that, and only while it is still
  as Althar wrote it. A server the person changed is theirs, and stays.
- What it can't copy waits under To settle: a token written out in a file,
  Codex's `--env` values, an SSE server to Codex. A token goes across as its
  variable's name.
- It brings the agents in step as Settings reads them and as each session
  starts, rather than watching the files.
- Sign-ins open each agent's own `mcp login` in a terminal. Whether an agent
  is signed in to a server isn't read.

## Skills

**One store, outside every repository** (`@althar/skills`, in the profile's
`skills/`). A skill's files are kept by content hash and never change.
`installs.json` says which versions are installed, where each came from
(Althar's catalog, GitHub at a commit, or local) and which is active.

**The same skills for every agent.** For each session, Althar lays out
read-only copies of the active set and hands them over the way the agent's
registry entry says: Claude Code as a session plugin, Codex as an added
skills folder, OpenCode in `skills.paths`. The copies go when the session
ends. The account's home, the person's own folders and the repository are
never written. The set is fixed for the session and recorded with it, and a
change reaches each lead the next time it starts. A skill that needs
subagents is left out for an agent that can't be counted on to have them.

**A curated catalog, vendored and pinned** (`packages/skills/catalog/`). It
holds 32 skills copied from
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) and
[obra/superpowers](https://github.com/obra/superpowers) at pinned commits,
each with its source, licence and the patch Althar applied. Where two skills
do the same job, the better one is kept (`catalog/CURATION.md`). The patches
take out push and pull request steps (Althar pushes), hand merging and
worktree cleanup to Althar, keep planning files out of commits, and make the
text agent-neutral. `scripts/vendor.ts` rebuilds the catalog, and stops where
upstream changed under a patch. A catalog update needs an app release.

**Installs from GitHub are reviewed.** A ref is resolved once to a commit, and
only the skill's own folder is fetched, each file checked against the
commit's tree. The review card shows the source, commit, licence, findings
(scripts, links, frontmatter that grants something), the files and the diff;
only approving it installs. A skill's `hooks` frontmatter is refused, since it
runs code as the skill loads. Updates are checked when the person asks, and
the replaced version is kept to roll back to. Althar runs nothing a skill
carries.

**The person's own skills.** A second switch (`skillSync.ts`) links each skill
into Claude Code's and Codex's folders (OpenCode reads both). It never moves
or copies one, and takes out only its own links. One name with two versions
waits under To settle. The skills table has no role columns: a skill loads
from each agent's own folders, and Althar can't hold one back by role.

**Skill text is not a boundary.** A person's own skill may tell an agent to
push or merge. The irreversible list and git's guard are what hold.

**Not built yet:**

- Each catalog skill is off until the person turns it on, and skills go only
  to a task's lead (`skills/src/local.ts`, `Sessions.ts`). They should be on
  by default, for every role.
- `allowed-tools` frontmatter is refused at install (`skills/src/validate.ts`).
  It should be accepted, since nothing it would allow asks now.
- All catalog skills on is more than Codex may list in its fallback budget,
  and nothing checks or reports that. There is no per-project selection.

## Skill and OpenSpec files in a change

Skill and OpenSpec files an agent writes (`.claude/skills/`,
`.agents/skills/`, `.opencode/skills/`, `openspec/`) are ordinary files of the
change. They go up with the rest of its diff, which its review reads.

**Not built yet:** the project's Repository files switches (`writeSkills`,
`writeOpenSpec`, `pushProtected`, all off) still hold a push that carries such
files the task brought in (`repositoryGuard.ts`). The switches and the hold go.

## The person's own sign-in

Agents may use the person's own `gh`, `glab` and git sign-in where it is set
up: their `gh` and `glab` config, git's credential helpers and their SSH
agent. Why: Claude Code, Orca and T3 Code all manage pull requests with the
person's own sign-in, and Althar shouldn't be the one place that can't.
Althar's sealed connection secrets and provider API keys never reach agents.

Where an agent pushes itself, Althar's push stays preferred, and the recorded
one. A lead's commits push as its turn ends, and `push_to_pull_request` and
`fetch_from_remote` stay its tools ([code hosts](code-hosts.md)). An agent's
own push loses the following:

- **The receipt:** what reached the host, when and as whom.
- **The hold:** where someone else pushed, Althar holds its own push and shows
  the person what would go; an agent's plain push is refused by the host
  instead, and only git's guard stops it forcing.
- **Where it goes:** a fork's branch upstream, an attached pull request's own
  branch name.
- **Whose name:** it goes up as the person's own account, which may not be
  Althar's connection.

In the Flatpak the person's sign-in is on the device, not in the sandbox
([packaging](packaging.md)). Agents that run on the device get it as their
environment crosses.

**Not built yet:**

- Agents still run signed out of the code host: their `gh` and `glab` config,
  credential helpers and SSH agent are taken out of their environment
  (`withoutSignIns`, `Config.ts`).
- The project switch "Agents use my code host sign-in" isn't built.
- Althar doesn't yet notice an agent's own push. The plan is to read the
  task's branch on the remote after each turn. A head that is a commit of the
  worktree would then be taken as the task's own push, with a line in the
  thread. A pull request opened with `gh` on the task's branch is adopted.
- Passing the SSH agent's socket and the `gh` and `glab` config folders to
  agents in the Flatpak's sandbox.

## Claude Code's own memory

**Not built yet:** Claude Code's auto-memory is still turned off for every
session (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `registry.ts`), since it writes
into the person's own `~/.claude` where their own sessions would read it.
ADR-097 turned it on, as running Claude Code themselves would. Whether it
goes on is open.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
