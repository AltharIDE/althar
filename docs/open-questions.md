# Open questions

Things we have not decided yet. They came up while designing the shell and the
chat primitives. Tick one off when it is settled, and say where it was decided
(an ADR, an architecture doc, a prototype). Newest at the top of each section.

Leanings are only where we are now. None of them are decisions.

"The kit" is `@charrette/ui` (`packages/ui`). "The prototype" is the shell
prototype in the `charrette-designs` repository (`prototypes/shell`).

## Several accounts, 3 October

Decided in [ADR-012](decisions/012-several-accounts-per-agent.md).

- [ ] **Providers' terms on moving between one person's plans.** Several
  accounts that are each the person's own (work and personal, a client's
  plan) are ordinary. Moving work to another personal plan because one ran
  out is the part terms may object to. Re-check Anthropic's and OpenAI's
  terms before launch.
  - Leaning: it stays the person's choice, made by adding the account and
    allowing it for the project, and it is worded as "your accounts", not as
    a way round limits.
  - If a provider objects, the move between that agent's accounts gets a
    switch that is off by default.
- [ ] **What a home Charrette makes shares with the person's usual folder.**
  Linked: Claude Code's settings, `CLAUDE.md`, agents, commands and plugins,
  and Codex's `config.toml`, `AGENTS.md` and skills. OpenCode's config stays
  under the person's `XDG_CONFIG_HOME` anyway.
  - Leaning: link settings and instructions, never anything that holds a
    token. MCP servers' OAuth stores stay per home, so each account signs in
    to them itself.
- [ ] **Loading a session across accounts.** A move to another account of
  the same agent starts a new session from a brief. With a shared history,
  the new account might load the old session instead. But provider-held
  state, such as encrypted reasoning and signed thinking, is tied to the
  account.
  - Leaning: a brief for now. Try loading where an agent allows it, behind
    the contract suite.
- [ ] **OpenCode without `XDG_DATA_HOME`.** That variable reaches every
  program the session runs. Is there an OpenCode-only way, such as
  `OPENCODE_DB` and an auth path?
  - Leaning: `XDG_DATA_HOME` for now. The session's environment is
    Charrette's anyway.
- [ ] **Models per account.** Plans offer different models, Plus against Pro
  for example.
  - Leaning: models stay per agent until an account says otherwise. The
    picker says when a model isn't on the account that would run it.
- [ ] **Pinning a conversation to an account.**
  - Leaning: later. For now the project's rules and the person's order
    decide.
- [ ] **Which switchers first.**
  - Leaning: those that give each account a home, which are adopted as they
    are: `codex-profiles`, `~/.claude-*` folders and JoRo-Code's
    codex-account-switcher. The swapping and rotating kinds need nothing
    from Charrette.

## Code hosts and trackers, 1 October

- [ ] **Who moves an issue's status.** When a task starts, opens its pull
  request, or the pull request merges, the issue it came from could move
  (started, in review, done). Charrette could move it; the tracker's own Git
  integration may already move it, by the key in the branch (Linear does,
  Jira's apps link it); or the person does. Two of them moving the same field
  fight. A product question to try out before deciding. For now Charrette
  puts the key in the branch and the pull request's title and moves no
  status.
- [ ] **What reaches the lead from a pull request.** Settled on 1 October,
  after review: failed checks, and what the person and the repository's own
  people (those who can write to it) say. Anyone else, as on a public
  repository, stays in the thread, marked, for the person to pass on; bots'
  comments and Charrette's own replies (known by their receipts) don't
  reach it. Still open: whether the lead should start for them when none is
  running, how often a lead may be woken before it needs the person, and the
  write-access check on GitLab, Bitbucket and Jira, whose comments don't
  carry it as GitHub's do.
  *Prototype:* task 431, "Listening".
- [x] **How agents reach the hosts.** Settled on 1 October 2026: only through
  Charrette. Charrette pushes and opens pull requests as steps of the plan;
  agents read and reply through Charrette's tools; the rules refuse `gh` and
  `glab` commands that change a host, and agents run without the person's
  sign-ins for them. After review, the environment is the boundary: git's
  credential helpers reset, no SSH agent, Charrette's tokens sealed by the
  app, and the rules refuse reading credentials.
  [ADR-011](decisions/011-own-connectors-for-hosts-and-trackers.md).
- [ ] **A lead that needs the person's git sign-in.** A project with private
  dependencies (a git URL in its lockfile, a private registry reached over
  SSH) can't install them while agents run without the person's credential
  helper and SSH agent. Leaning: a project setting that passes them to the
  lead, never to readers, off unless turned on, and said where the plan is.
  Until then such a project's setup command runs outside the agent.
- [ ] **A sandbox for agents' shells.** The environment keeps the person's
  ambient sign-ins from agents, and the rules refuse the keychain and git's
  helpers, but a shell can still read what the person keeps in plain files
  under their home folder (`~/.git-credentials`, an unencrypted SSH key, a
  cloud CLI's config). Only running agents in a sandbox closes that:
  macOS's sandbox profiles, a container, or a separate user. Also: agents'
  own API keys (03, "API keys and OAuth") should be sealed the way code hosts' tokens
  are, not kept where `security` reads them.

## The coordinator loop, 30 September

- [x] **How read-only the coordinator and reviewers are.** Settled on 30
  September 2026 in the review of #15: every reader reads a throwaway copy,
  its agent's sandbox is read-only where that still lets it call Charrette's
  tools, and the reader rules, an allowlist of commands and flags, are the
  backstop. Plan modes stay out while they refuse MCP tools.
  [ADR-004](decisions/004-coordinator-is-an-agent-session.md),
  [architecture 04](architecture/04-coordinator.md).
- [x] **What an agent's closing words are for, once a step reports.**
  Settled on 30 September 2026 in the review of #15: they fold with the work
  that led to the step's result.
- [x] **A ready task's header.** Settled on 30 September 2026 in the review of
  #15: the header reads the run, as the card does, and says Ready.

## The desktop app, 29 September

- [ ] **Running the bundled adapters once the app is signed.** They run on
  Electron's own binary as Node (`ELECTRON_RUN_AS_NODE`), so the RunAsNode
  fuse has to stay on, and then anything can run Charrette's signed binary as
  Node with the app's entitlements. Leaning: ship a separate Node for the
  adapters and turn the fuse off. Decide before the first signed build.

- [ ] **Task numbers.** The kit's header and crumb show a task's number
  (#418); tasks have slugs, not numbers, so the app shows the title alone.
  Leaning: a number per project, given by the store when the task is made.
- [ ] **What an answered call leaves in the thread.** Today it disappears once
  the thread is read again. Leaning: it folds to the line the kit draws
  ("Allowed once"), kept as a thread item, so the thread says who allowed what.
- [ ] **The packaged app's `PATH`.** Started from the Finder, the app gets a
  short `PATH`, so agents installed on the user's own (OpenCode, the `claude`
  command Claude's status check runs) aren't found. Read the login shell's
  `PATH` once at start, as other Electron apps do, or ask for each agent's
  location? Leaning: the login shell's.

## The harness, 28 September

- [x] **How Charrette reaches agents.** Settled: ACP for every agent, with
  Claude Code, Codex and OpenCode interchangeable in the MVP, and native side
  channels where ACP falls short.
  [ADR-002](decisions/002-acp-for-every-agent.md).
- [x] **The shell.** Settled: Electron, with the runtime in a utility process.
  [ADR-003](decisions/003-electron-shell.md).
- [x] **What the coordinator is.** Settled: an agent session with Charrette's
  tools and read-only access; Charrette keeps its conversation.
  [ADR-004](decisions/004-coordinator-is-an-agent-session.md),
  [architecture 04](architecture/04-coordinator.md).
- [x] **Switching agent mid-task.** Settled for the MVP: the new agent takes
  over everything, from a brief, in the same workspace. Changing model within
  an agent keeps the session.
  [ADR-005](decisions/005-charrette-briefs-every-agent.md).
- [x] **Workspaces.** Settled: a git worktree per task, shared by its steps.
  [ADR-006](decisions/006-worktree-per-task.md).
- [x] **How much rigour the proof of concept gets.** Settled: shortcuts in
  behaviour, never in recorded facts or data shapes.
  [ADR-008](decisions/008-shortcuts-in-behaviour-not-in-records.md).
- [ ] **Tuning a switch.** When you switch because you don't like the work,
  should the new agent get a fresh take without the old agent's reasoning,
  start from base rather than the current code, or get a generated handoff
  in Amp's style? How does the switch menu offer that?
- [x] **Changing model in OpenCode.** Settled by OpenCode itself: 1.18.31
  changes model and mode per session over ACP. Checked with the adapter's probe
  and the contract suite.
- [ ] **Claude Code starts in the user's own default mode.** On a machine where
  that is `bypassPermissions`, the Agent SDK approves every tool call itself.
  Charrette sets the mode on every session and turns bypass off for the
  session's life, so this is handled, but should Charrette also warn when the
  user's Claude Code defaults to bypass, since their own use of it skips every
  check?
- [ ] **Usage limits in ACP itself.** Propose a rate-limit extension to ACP,
  rather than keep a side channel per agent?
- [x] **Agent settings that approve before Charrette sees.** Settled: every
  session gets settings that make the agent ask, and they win over the user's
  and the repository's own. Claude gets ask rules per session (ask beats allow
  in every settings file), Codex runs in `workspace-write` rather than its
  auto-review `agent` mode, and OpenCode gets inline config. Checked on 29
  September 2026 against a repository whose settings allow everything.
  [Architecture 03](architecture/03-agent-runtime-and-auth.md#permission-routing).
- [x] **What Claude's ask rules don't reach.** Settled on 29 September 2026:
  Claude sessions load only the MCP servers Charrette gives them
  (`strictMcpConfig`), so the user's and the repository's own servers, whose
  tools the ask list doesn't cover, never load. A hook that approves can't
  get past an ask rule; checked with a repository whose hook approves every
  tool call. What stays open is below, under trusting a repository's agent
  settings.
- [ ] **Trusting a repository's agent settings.** A repository's hooks
  (`.claude/settings.json`, `.codex/hooks.json`) and Codex project config run
  as code on the Mac whenever the agent uses a tool. Claude's SDK loads them
  without the trust prompt its app shows, and codex-acp marks every session
  folder trusted. Agent Orchestrator is criticised for exactly this
  ([AO#3280](https://github.com/Untrivial-ai/agent-orchestrator/issues/3280)).
  Leaning: opening a project is the trust step, and it says what the
  repository's agent settings will run; untrusted, Claude sessions get
  `disableAllHooks`. Codex can't be told not to trust a folder through
  codex-acp yet.
- [x] **Shell commands that write outside the worktree.** Settled on 29
  September 2026: each agent's own sandbox is the boundary where it has one.
  Codex's is on in `workspace-write`; Claude Code's is now switched on for
  every session, so a command that stays inside runs without asking and one
  that has to leave (the network, a write elsewhere) reaches Charrette. The
  rules read commands as a shell would, for pushes and for the places they
  write, as a second line. Still to do: wrap OpenCode, which has no sandbox,
  in the same sandbox-runtime Claude uses. Dev containers stay a later,
  per-project option: isolation, setup and services per task, but Docker,
  sign-in inside the container and no macOS toolchains.
- [x] **Codex commits in a worktree.** Settled on 29 September 2026: the
  sandbox stays as it is, and the rules allow git's own writes for the task
  (`git add`, `git commit`), so Codex's requests are answered without the
  person, and each is recorded. Making the repository's `.git` writable was
  rejected: it would expose its hooks, config and every other branch. Codex's
  own users rejected it for the same reason
  ([openai/codex#48717](https://github.com/openai/codex/issues/48717)).
  Claude's sandbox already lets a worktree write the main `.git`, hooks and
  config excepted.
- [ ] **Reads and fetches outside the worktree.** The rules allow them, as
  the MVP plan says: agents read widely, and fetch docs. But reading a secret
  and then fetching is how data would leave. Claude's sandbox asks per host
  for the network; Codex's has the network off. Ask for reads of known secret
  places (`~/.ssh`, `.env` outside the worktree), limit hosts per project, or
  accept it for now?
- [ ] **The coordinator's defaults.** Settled on 30 September 2026: it starts
  on the agent and model you last used, and says so and offers the others
  when that one isn't signed in; it answers questions itself, and only changes
  become tasks; the countdown is 25 seconds and the runtime owns it
  ([MVP plan](plans/mvp.md)). Still open: whether task events prompt it, and
  whether it can skip the countdown when you asked for exactly that task. See
  [architecture 04](architecture/04-coordinator.md).
- [x] **Where worktrees live.** Settled: `~/Charrette/<project>/<task>/<repository>`,
  with a root that can be changed per project.
  [ADR-006](decisions/006-worktree-per-task.md).
- [x] **How the lead, Verify and Review work together.** Settled: the lead's
  session spans its nodes, Verify runs the project's checks, review and
  settling loop for at most 3 rounds, reviewers are read-only, and the default
  reviewer is another provider's strongest model.
  [Architecture 05](architecture/05-workflow-engine.md). The demo runs them as
  one fixed graph ([MVP plan](plans/mvp.md)).
- [ ] **Setup per worktree.** Where the setup command and the files to copy
  are declared: in the project rules, or in a file in the repository? On 30
  September 2026 the user took Verify out of the plan, since it would rebuild
  CI; checking the work becomes a manual QA step later.
- [ ] **An acceptance-criteria checker.** A step type that checks the change
  against the task's acceptance criteria, beside Review. When, and what does
  it return?
- [ ] **"Strongest available model."** How Charrette ranks models per provider
  for the default reviewer: a list it ships and updates, or something the
  agent reports?

## From the design review, 27 September

- [x] **Stop, interrupt and cancel are one square today.** Settled as the
  leaning: the composer's square interrupts the lead's turn and keeps the task
  ("Interrupted by you"); ⌘Enter or Send now interrupts and continues; the
  task menu stops, resumes, abandons or reopens the task, and only Stop sets
  "Stopped", drawn as a pause and never as a square. Decided in the kit
  (Composer, You, Furniture, TaskMenu, TaskGlyph) and the prototype's task
  view. Supersede-pending has no control yet.
- [x] **What a stuck task looks like.** Settled: a violet call in the thread
  (kit `thread/Stuck`): what it tried, why as the lead reads it, the failing
  output, then Tell the lead, Try another agent or Abandon. On the board it is
  a CallCard with no choices. After a restart, a quiet line says Charrette is
  checking where the lead had got to, then that nothing ran twice
  (`Restarted`). Prototype: the chat specimen's "When it can't finish".
  Still open: a "take it over yourself" choice, and what `uncertain` looks like
  when a side effect can't be confirmed.
- [x] **"Next step" means two things.** Settled as the leaning: "Enter queues
  it; the lead reads it next". Kit: Composer and You.
- [x] **One vocabulary.** Settled: [the glossary](glossary.md) lists the UI's
  words with the model's word beside each, and the words the UI doesn't use.
  The prototype's task data no longer says canonical, episodic or worker.
  "Agent" versus "runtime" is still to align (see the glossary).
- [ ] **Whose call is it?** "Needs you" assumes one person per project. Once a
  project is shared, a call needs an addressee, and someone else's call
  probably isn't violet for you.
- [ ] **Clocks only while visible, versus autonomy.** The principles say
  clocks run only while you can see them. A plan you never look at then never
  starts. Which wins?
- [x] **Decorative motion.** Settled as the leaning: the Linear card's squares
  hold a still frame until you point at or focus the card (kit `Pixels`,
  `playing`).

## Before a project: first run and sources

- [ ] **One way in, not two.** "Open a repository" and "New project" read as
  the same thing. Leaning, now in the kit and the prototype: one entrance,
  New project, which opens the folder picker (several folders, or cancel for
  none) and then the form with what was chosen. Dropping folders on the window
  does the same. This departs from the two entrances in architecture doc 01;
  if it holds, the doc should change.
- [ ] **The welcome.** Shown once after install (kit `onboarding/Welcome`,
  prototype `#start`). The opening draws the mark; then a drafting table with
  five plots, and a camera that travels to each. At each plot the real
  components are sketched in pencil from their own layout, uncovered, and set
  working: a task visits the project and leaves a note, a lead takes a task, a
  call arrives on the board and a pointer answers it, the last checks pass and
  the change is accepted, an agent finishes signing in. It ends on the whole
  table, built. Settled: the opening starts close on the mark as it is drawn
  and pulls back hard before the name and line come into focus, and the line
  is "Agents come and go. Your project stays." The opening is drawn on the
  table itself, so Begin moves the camera off it to the side, across the same
  paper, straight to the first plot, rather than changing screens; the whole
  table is only shown at the end. From plot to plot the camera glides
  straight and low, tipped toward where it is going, and the pencil route is
  drawn beside it as it goes; the camera does not follow the route's bends
  (chosen over a zoom out and in, a dolly and a whip pan). Open:
  the point (kit story Onboarding/Opening has the versions side by side), a
  plain dot set at the end, a plain circle drawn first and filled, or none;
  can it be replayed from the Help menu; does a major update get a plot of its
  own; is there sound, as Arc has; and should a scene replay when you come
  back to it with Back (today it holds its end).
- [ ] **Explaining "lead" before anyone has met one.** The new-project form now
  says "The agent in charge decides", with the note that each task has one
  agent in charge of it, its lead. ProjectRules uses the same title. Does
  "lead" need to be on screen at all before the first task?
- [ ] **The order of agents.** "Move the work to the next agent free" follows
  "the order of your connections", but nothing sets that order. Drag to order
  in the agents list, or a per-project order in the rules?
- [ ] **What an agent row offers once it is ready.** Today a ready row says who
  it is signed in as, and nothing else. Does it need "use for this project",
  a default model, or a sign-out that hands off to the agent's own?
- [ ] **API keys and local models.** "Connect another" now opens a panel
  (kit `setup/ConnectAgent`): apps Charrette can run but didn't find, APIs that
  take a key (typed once, hidden, into the Keychain), model servers on this
  Mac, and any agent that speaks ACP by its command. Leaning: keys and local
  models run through OpenCode, so Charrette still calls no model API itself
  ([ADR-002](decisions/002-acp-for-every-agent.md)). Open: which apps and APIs
  are listed at launch, and how a connected key shows in the agent list.
- [ ] **Choosing subpaths in a workspace.** The map offers "only these
  folders" as one suggested choice. Choosing folders freely needs a tree
  picker, which doesn't exist yet.
- [ ] **The Sources view.** Every repository's state on this device (ready,
  needs mapping, needs access, changed, unavailable) has vocabulary but no
  screen. It is probably SourceMap with a state per row, in project settings.

## Autonomy: how often Charrette pulls you in

- [ ] **Review findings: when do they reach you?** The default is that the lead
  settles them (fixes, or sets aside with a reason), and you see only what it
  can't settle. That default is set per project, and can be changed from any
  review. We may only learn the right default from user testing.
  *Prototype:* chat workshop, Steps → "Review, settled by the lead", and the
  "Findings reach you" menu.
- [ ] **A learning period.** Could Charrette start by asking about everything
  and ask less as you agree with the lead's calls? Open: what counts as
  agreement, whether it is per project or per kind of decision, and how you see
  where it stands ("6 of 10 so far"). We don't yet know how to build it.
- [ ] **Permissions: who answers.** Leaning: the lead answers permission
  requests from its steps, inside the project's rules. Only what the rules keep
  for you arrives as a card. Open:
  - Does the lead answer, or a separate cheap judge model? The lead is busy and
    expensive; a judge has no task context.
  - ~~How does this map onto ACP?~~ Settled: every session starts in a mode
    that asks, and Charrette answers `session/request_permission` from the
    rules. In the MVP the lead doesn't answer yet.
    [ADR-007](decisions/007-permission-requests-reach-charrette.md).
  - ~~What goes on the default always-ask list?~~ Settled for now: pushes to
    the default branch, force pushes, merges, deploy commands, and writes
    outside the task's worktree.
  *Prototype:* Project → "Project rules", and "Allowed without you".
- [ ] **Project rules: when and where they are set.** Leaning, as mocked in
  the kit's NewProject: creating a project asks one thing, who answers when
  agents need a yes (default "The agent in charge decides"), and every other rule starts
  at its default. Can a task tighten the rules but never loosen them? Where
  are they stored? (See Memory below.)
- [ ] **Kinds of permission.** Commands, web fetches, MCP tools, writes
  outside the workspace, spending, messages to people. Should each kind have
  its own rule, or should there be one list?
  Compared with Claude Code (allow, ask and deny rules per tool, with patterns
  like `Bash(git push:*)`, `Read(./.env)`, `WebFetch(domain:…)`), Codex (a
  sandbox for writes and network, plus an approval mode) and Cursor (command
  allow and deny lists, protection for dotfiles and deletions), Project rules
  covered who answers and what asks. It now also has a **Never** list: hard
  refusals that hold even with everything allowed. Still open:
  - **Allow rules.** Under "Ask me", nothing is pre-approved, so `bun test`
    would ask every time. Leaning: one rule list where each rule is allow,
    ask or never, and "Allow always" on a permission card (ACP's
    `allow_always`) writes an allow rule into it.
  - **Patterns.** Rules are plain sentences now. Leaning: each rule has a
    kind and a pattern (command prefix, path glob, domain, MCP server and
    tool), with the sentence as its label.
  - **Reach, apart from who answers.** Where agents can write (the task's
    worktree, plus listed paths) and whether they have the network (off,
    listed domains, on). This is a sandbox, not a permission, so nothing
    asks. Does Charrette enforce it, or pass it to each runtime's own sandbox?
  - **Scopes.** A personal layer (mine, on this machine) and an organisation
    layer that a project can't loosen.
  *Prototype:* none yet for allow rules, patterns or reach.

## Starting and finishing a task

- [ ] **When is a PR opened?** Settled for the MVP: when the graph finishes,
  a draft PR opens automatically. It's cheap and reversible, CI runs on it,
  and marking it ready and merging stay with you
  ([MVP plan](plans/mvp.md)). Later it becomes a project rule
  ("When a task is done"), shown as the last step of the plan. Still open:
  - Should a task that only answers a question, or makes no code change, skip
    it?
  - Does the lead mark the PR ready once review and checks pass?
  *Prototype:* Project rules, and the last step in "Task about to start".
- [ ] **The plan before a task starts.** The coordinator shows the task's
  steps once, with the agent for each (changeable), optional steps you can
  skip, and a 30 second countdown. Leaving it alone is a yes. Open:
  - The countdown only runs while the plan is on screen. What if you never
    look? Should it start after a longer limit, or wait?
  - Which steps can be skipped, and does a rule-required step ever become
    skippable?
  - Is 30 seconds right?
  *Prototype:* Coordinator → "Task about to start".
- [x] **The task card as status.** Settled: each status change is posted as
  a new card at that point in the coordinator's conversation, so the live card
  is always the latest. The card it replaces folds into one quiet line in its
  old place (what changed, the step it had reached, the time), and the most
  recent line links down to the live card. *Prototype:* Coordinator → "Task
  over time".
- [ ] **Which changes get a new card.** Every step move, or only status
  (running / waiting on you / done)? A long graph would post a lot of cards.
  Leaning: every step move for now, and see if it's noisy.
- [ ] **A plan step whose agent is out.** Leaning: the plan says the step
  waits for the reset, and the countdown still runs; changing the agent
  removes the wait. Open: should the coordinator move an optional step to a
  free agent by itself, and only leave rule-pinned steps waiting?
  *Prototype:* Coordinator → "Plan, an agent is out".
- [ ] **Effort in the plan.** Each step carries its own model and effort,
  which the person sets on the plan's card; the coordinator proposes neither,
  so a step starts on the agent's own. Does the coordinator recommend effort
  per step, or always start at the model's default?
- [ ] **Allow all, with always-ask items in the stack.** "Allow all 7"
  currently covers pushing to main too. Should items the rules keep for you
  be left out of Allow all?
  *Prototype:* Permissions → "Many at once".
- [x] **Pasted links.** Settled on 1 October 2026: issues and pull requests
  from the connected code hosts and trackers unfurl, through Charrette's own
  connectors, not MCP servers
  ([ADR-011](decisions/011-own-connectors-for-hosts-and-trackers.md)). Other
  sources, such as Sentry and Notion, wait for the MCP broker.

## Steps, agents and the graph

- [ ] **Aggregating agents across layers.** There are four layers:
  coordinator → task lead → steps → sub-agents. How does the architecture keep
  one coherent picture across them (status, cost, limits, permissions,
  what is waiting on whom) without every layer reporting everything?
- [ ] **Talking to a parallel step.** The thread has a tab per reviewer, plus
  "Both". Open: does "Both" send to each reviewer separately, or to the
  combine step? Does a message to one reviewer restart only that one?
  *Prototype:* Parallel review → Thread.
- [ ] **Undo window for graph changes.** Currently 10 seconds; nodes the
  change adds are held until the window closes. Open:
  - Does a stop that is part of the change also wait, or happen at once?
  - Is the window per change or per project?
  - What happens if you are not looking during those 10 seconds?
- [ ] **When reviewers disagree.** Today the lead decides, and asks you
  ("Your call") only when nothing on the task settles it. Is "nothing settles
  it" something we can actually detect?

## Usage limits

- [ ] **Limits on steps, not just the lead.** A limit belongs to one of an
  agent's accounts ([ADR-012](decisions/012-several-accounts-per-agent.md)),
  so it pauses every agent on that account at once: the lead, its steps, and
  their sub-agents. Leaning: a project rule moves the work to the
  next free agent, which shows as a quiet line, and the card appears only when
  the rule says to ask. How a limit is detected is settled
  ([architecture 03](architecture/03-agent-runtime-and-auth.md), Usage limits).
  Open:
  - Does paused work move back after the reset?
  - What if no other runtime is connected?
  - What about a step that must stay on one model, such as a review that
    specifically wants a different lab from the lead?

## Memory and where things live

- [ ] **Where memory lives, including review instructions.** Everything in
  the repo (`.charrette/review.md`, rules) is reviewable, diffable and travels
  with the code, but it is crude, and not everything belongs in git. The
  alternative is Charrette's own project store. Maybe a mix: instructions in
  the repo, learned context in the store. This needs its own conversation.
- [ ] **When a dismissal reaches `review.md`.** At dismissal, or once the
  knowledge candidate is accepted? Leaning: once accepted, with the line shown
  as pending until then.
- [ ] **Dismissing without a reason.** Allowed. It still goes to the lead,
  but nothing is kept for future reviews unless you add a reason. Is a bare
  dismissal worth learning from at all?

## Chat primitives

- [ ] **What agents can hand back.** Images are covered (screenshots side by
  side, full size on click). Still open: screen recordings of a UI flow,
  generated PDFs, and larger outputs (logs, data files). Do those get the file
  card, or their own viewers?
- [ ] **"Every finding" mode.** Each open finding waits for you, with Have it
  fixed / Say what to do / Dismiss, plus "Leave them to the lead". Does the
  lead start on the findings you've answered, or wait for the whole list?
  *Prototype:* Review → "Waits for you".
- [ ] **Answering a finding.** The choices are have it fixed, say what to do
  instead, or dismiss, and each can be undone. Until when? Leaning: until the
  lead starts its next round.

- [ ] **MCP calls closed by default** in the thread. They're open in the
  catalogue only so the result shows.
- [ ] **Terminal finish.** Paper for now; Dark stays as a variant in the
  workshop. The command-to-copy snippet follows the same finish.
