# The person's setup

What of the person's own setup an agent Althar starts gets: their MCP
servers, their skills, and their code host sign-in. Althar ships no skills
of its own. What these may then do, and what asks, is in
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

**A repository's own `.mcp.json`** is listed as tiles in Settings, under the
project it is in. Its servers run commands the person hasn't chosen, so each
is off until they turn it on, for the roles they choose, and it is given only
to sessions of that project; a server of the person's own with the same name
wins. An outside author's review never gets one (`serversFor`'s
`ownRepository`).

**Each server's tile** shows what waits on the person first: why its last
start failed, then that it runs two ways or isn't signed in. Opened, it shows
who gets it (Leads, Reviewers, the coordinator), the projects whose marks are
pressed out, and each agent's own file with the server's lines as that agent
keeps them (values of env and headers that aren't references are masked).
The person adds a server to the agents they choose, or to all three while sync
is on, writing into each one's own file as theirs, and removes it from every
file that has it. A project pressed out, or a role left off, holds a server
back in a session (`rolesOf`, `serversFor`).

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
- Sign-ins open each agent's own `mcp login` in a terminal.
- **How each server stands is read** from each agent's own command, not from
  its credentials: `claude mcp list`, `codex mcp list --json` and
  `opencode mcp list` (`mcpHealth.ts`), as Settings opens and at most every five
  minutes, and kept in Althar's own folder. Claude Code and OpenCode say
  connected, needs sign-in or failed (with their words for why); Codex's list
  doesn't start a server, so it says only whether one needs a sign-in. Anything
  a command says that isn't recognised is unknown, never guessed. What a
  session reports of a server's status is kept too.
- **A server's tool count** is Althar's own check (`mcpProbe.ts`): it starts
  the server, or calls its address, asks for its tools and stops it, as the
  person opens the server. A server that needs a sign-in, doesn't start or
  can't be asked says so in place of a count.

## Skills

**One store, outside every repository** (`@althar/skills`, in the profile's
`skills/`). A skill's files are kept by content hash and never change.
`installs.json` says which versions are installed, where each came from
(GitHub at a commit, or local) and which is active.

**The same skills for every agent.** For each session, Althar lays out
read-only copies of the active set and hands them over the way the agent's
registry entry says: Claude Code as a session plugin, Codex as an added
skills folder, OpenCode in `skills.paths`. The copies go when the session
ends. The account's home, the person's own folders and the repository are
never written. The set is fixed for the session and recorded with it, and a
change reaches each lead the next time it starts. A skill that needs
subagents is left out for an agent that can't be counted on to have them.

**Althar ships no skills of its own.** An earlier version carried a curated
catalog of 32 skills copied from agent-skills and superpowers and installed
them, off, as `althar-default`. The person decided against it on 8 Nov 2026: a
default set is Althar choosing how every lead works, and the person's agents
already load the skills they chose. The catalog, its packaging and its
install are gone. What the person has is in their agents' own skill folders
and plugins, the repository's `.claude/skills`, and what they add from
GitHub. On the first start after the update the runtime takes the installs
the older Althar made out of the store, with the stored versions nothing else
points at, and leaves what was added from GitHub
(`removeBundledSkills`).

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
waits under To settle.

**Skills by role and project.** Settings › Skills lists every skill the
person has as one list (`agentTools.ts`): those in the agents' own folders,
those of Claude Code's plugins that are on, those in Althar's store, and each
project's repositories' own `.claude/skills`. One in the store and in an
agent's folder under one name is one, the store's. Each loads in every role
and every project until the person turns it off for a role, or presses a
project out. A store skill is on while any role gets it: turning its last
role off turns it off in the store. A session holds back each one its role or
project doesn't get (`heldSkillsFor`). A store skill is left out of the run's
copies and its brief. One the agent loads itself is held back in the agent,
the way each documents (`provider-adapters/src/heldSkills.ts`, read against
Claude Code 2.1.318, codex-acp 2.5.0 with Codex 0.165.0, and OpenCode 2.2.6):

- Claude Code: a `Skill(<name>)` deny rule, a plugin's skill as
  `<plugin>:<skill>`, and `skillOverrides` off, which takes its own folders'
  skills off the list the model reads.
- Codex: `skills.config` entries `{ name, enabled = false }`.
- OpenCode: `permission.skill` `{ "<id>": "deny" }`.

What isn't verified yet:

- A plugin's skill held back in Claude Code is refused when loaded, but may
  still be named in its list.
- OpenCode 2.x's list may still name a denied skill. Only its `policies`
  take one off the list, and Althar doesn't set them, since 1.x may refuse
  a setting it doesn't know.
- No logged-in session has run any of the three end to end.
- Codex doesn't read a repository's `.claude/skills`, so it has nothing to
  hold back there.

**Skill text is not a boundary.** A person's own skill may tell an agent to
push or merge. The irreversible list and git's guard are what hold.

**Not built yet:**

- The skills the person turns on already load in every ordinary role, the
  coordinator included; an outside author's review loads no skill plugin that
  runs code.
- `allowed-tools` frontmatter is refused at install (`skills/src/validate.ts`).
  It should be accepted, since nothing it would allow asks now.
- Too many skills on is more than Codex may list in its fallback budget, and
  nothing checks or reports that.
- Codex's own plugins' skills aren't listed, nor a Claude Code plugin's
  skills kept anywhere but its `skills/` folder.

## Skill and OpenSpec files in a change

Skill and OpenSpec files an agent writes (`.claude/skills/`,
`.agents/skills/`, `.opencode/skills/`, `openspec/`) are ordinary files of the
change. They go up with the rest of its diff, which its review reads.

No consent of their own is asked to push them. The project's old Repository
files switches (`writeSkills`, `writeOpenSpec`, `pushProtected`) are still in
its settings but hold nothing back (`repositoryGuard.ts`).

## The person's own sign-in

Agents use the person's own `gh`, `glab` and git sign-in where it is set
up: their `gh` and `glab` config and tokens, git's credential helpers and
their SSH agent are left in the agent's environment (`Config.ts`,
`process.ts`). Inside Claude Code's sandbox `~/.config/gh` and `~/.npmrc`
stay secret places, so there only a token in the environment carries the
`gh` sign-in. An outside author's review runs signed out. Why: Claude Code, Orca and T3 Code all manage pull requests with the
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

- A project switch to turn the person's sign-in off for agents. The
  inherited sign-in is the default, with no switch.
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
- 8 Nov 2026: the limits sweep (#696) built: agents carry the person's own code-host sign-in, picked skills load in every ordinary role, and skill and OpenSpec files push like any other.
- 8 Nov 2026: Settings rebuilt as direction A: tiles for MCP servers and skills (a repository's own too), adding and removing a server, how each server stands read from the agents' own commands, and a tool count from Althar's own check.
- 8 Nov 2026: Althar ships no skills of its own. The curated catalog, its packaging and its install are removed, and the first start after the update takes the older installs out of the store.
- 8 Nov 2026: skills have role and project holdings. Every skill the person has is one list, and a session holds back, in its agent, each one its role or project doesn't get.
- 8 Nov 2026: where the build of direction A went another way than the prototype's README. Dictation, which had a section of its own for a day, is part of This Mac, and its old address opens there. The servers in a repository's own `.mcp.json` start off in every role and go only to that project's own sessions, never to the review of an outside author's pull request, whose repository never loads its MCP config. How a server stands is read from each agent's own list command and kept, with what a Claude Code session says of one as it starts, rather than asked of every server one by one; a tool count is read only where Althar's own check can start the server and sign in, and is left out where it can't. A skill's one on-off switch is gone: each role's switch takes its place, and the person's skills are held back per agent only where that agent has a way to hold one back. A project's Finished sentence stays one sentence in its Tasks, not a row of its own.
