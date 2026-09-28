# Open questions

Things we have not decided yet. They came up while designing the shell and the
chat primitives. Tick one off when it is settled, and say where it was decided
(an ADR, an architecture doc, a prototype). Newest at the top of each section.

Leanings are only where we are now. None of them are decisions.

"The kit" is `@charrette/ui` (`packages/ui`). "The prototype" is the shell
prototype in the `charrette-designs` repository (`prototypes/shell`).

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
- [ ] **Changing model in OpenCode.** Its ACP couldn't change model per session
  as of June 2026. Restart it with a new configuration, treat the change as an
  agent switch, or use OpenCode's own server API?
- [ ] **Usage limits in ACP itself.** Propose a rate-limit extension to ACP,
  rather than keep a side channel per agent?
- [ ] **Agent settings that approve before Charrette sees.** A user's own allow
  rules, in Claude Code's settings for example, can approve an action before
  it reaches Charrette, so the always-ask list never sees it. Warn, read those
  settings, or accept it?
- [ ] **The coordinator's defaults.** Its default model; whether task events
  prompt it; whether it can skip the countdown when you asked for exactly that
  task. See [architecture 04](architecture/04-coordinator.md).
- [ ] **Setup per worktree.** Where the setup command and the files to copy
  are declared: in the project rules, or in a file in the repository?

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
  - What goes on the default always-ask list?
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

- [ ] **When is a PR opened?** Leaning: when the graph finishes, open a
  **draft** PR automatically. It's cheap and reversible, CI runs on it, and
  marking it ready and merging stay with you. This is a project rule ("When a
  task is done"), shown as the last step of the plan so it can be changed per
  task. Open:
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
- [ ] **Effort in the plan.** Each step's agent now has its own effort
  (the composer's picker). Does the coordinator recommend effort per step,
  or always start at the model's default?
- [ ] **Allow all, with always-ask items in the stack.** "Allow all 7"
  currently covers pushing to main too. Should items the rules keep for you
  be left out of Allow all?
  *Prototype:* Permissions → "Many at once".
- [ ] **Pasted links.** Linear issues are shown inline when pasted. Which
  other sources should be (GitHub issues and PRs, Sentry, Notion), and should
  that go through MCP servers or built-in integrations?

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

- [ ] **Limits on steps, not just the lead.** A limit belongs to a runtime's
  account, so it pauses every agent on that runtime at once: the lead, its
  steps, and their sub-agents. Leaning: a project rule moves the work to the
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
