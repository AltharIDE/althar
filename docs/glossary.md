# Glossary

The words Althar's interface uses, with the word the architecture docs use
for the same thing. The interface says the left column. Code, docs and ADRs may
say the right. When something new needs a name on screen, add it here first.

## Where work happens

| On screen | In the model | What it is |
|---|---|---|
| Project | `Project` | A body of work with its own rules, knowledge and history. It may have no repositories. |
| Repository | `RepositoryBinding` | A repository that the project's tasks may change, with its role. It is shared by everyone on the project. |
| On this Mac, Map it later | `RepositoryLocation`, or none | Where this device keeps that repository. "Map it later" is a binding with no location here. On the Sources view that state is "needs mapping". |
| Reading it | read-only inspection | What Althar does to a folder before a project exists. It changes nothing. |
| Role | `RepositoryBinding.role` | What a repository is to its project: Service, Frontend, Infrastructure, Library, Docs or Other. Suggested from its name, changed on the Repositories screen; tasks and the coordinator are told it. |
| Leave out | `RepositoryBinding.detached_at` | Taking a repository out of a project: new tasks can't change it and the coordinator stops reading it. Tasks made with it keep it. Nothing in its folder changes. Not "remove" or "detach". |
| Where tasks open pull requests | `RepositoryBinding.change_target` | For a fork (an `upstream` remote beside `origin`): on the repository it was forked from, or on the fork. The branch is pushed to the fork either way. |
| Colour | `Project.ink` | The ink a project's mark is drawn in: one of eight, picked for it when it is made, changed under "Name and colour" in its settings. Never "ink" on screen. |
| Remove from Althar | `Project.archived_at` | Taking a project out of the window and the home. Its agents stop and nothing it planned starts. Its folders, its tasks' worktrees and their branches stay. Opening its folder again makes a new project. Not "delete" or "archive". |
| Agent | runtime, adapter | Claude Code, Codex, OpenCode and the like, as installed on this machine. |
| Account | `AgentAccount`, its home | One sign-in of an agent, kept in a folder of its own. The agent's usual sign-in is its first account; the person can add more, or bring in folders a switcher made. Named by the person ("work"), it shows after the agent's name: "Codex (work)". |
| Signed in as | `ProviderPrincipal` | Who the agent says you are, for an account. The agent keeps its own sign-in; Althar never holds the credential. |
| Sign in | vendor login, `auth_required` | Opens the agent's own sign-in, for an account. |
| Out of usage | usage limit, `transient_provider` | The account has used its allowance until a reset. Depending on the project rules, the task is Paused, moves to another of the agent's accounts, then to another agent, or waits on the person, who moves it to a model that is free or waits for the reset. A call for it has the kind Out of usage. |

## Who does the work

| On screen | In the model | What it is |
|---|---|---|
| Coordinator | coordinator | The project's agent in the Talk room. It plans tasks and hands them out, but writes no code itself. |
| Task | `Task` | One piece of work with an outcome, usually one change. |
| Change, Review (a card's kind) | a task's kind, `TaskCard.kind`, read from what it has and never stored (DEV-96) | The word after where a task stands on its card and in its row. Review: it reads someone else's pull request, with nothing of its own. A plain task has no word: a quick task the coordinator starts at once (a question, a prototype, a release from this Mac), whose plan stays on this Mac, whatever its lead wrote. Change: every other task, every planned one among them, a quick task the person had made one, and any task with a pull request. A task only moves toward Change, when the person says so: they ask a quick task's lead to make it a change. |
| This task's work is on a branch of its own now, …, which stays on this Mac | `workspace.branched` from no branch (`firstWrite.ts`, ADR-035) | A quiet line in a quick task's thread as its lead first changes the repository: Althar made the task's branch there, with that work on it, so nothing is lost, in the same folder with the same lead. The task stays plain, and nothing of it is pushed or opens a pull request. What its lead throws away in its scratch folder, and pictures it hands back, don't count. |
| This task is a change now: reviewed by …, it opens a draft pull request when it's done | `make_it_a_change`, the lead's tool (`task.made_change`, ADR-035) | A quiet line in a quick task's thread once the person asked its lead to make it a real thing: its new title, the reviewer it named (or "with no review"), and how it ends (a draft pull request, one ready for review, or, where its repository is on no host Althar knows, on its branch), with the branch its work is on under it. The lead's next report goes through the review, then the pull request opens. |
| Lead | the task's primary agent (the docs sometimes say worker) | The agent that owns a task: it implements, runs the steps and answers them. Never "worker" on screen. |
| Step | workflow node | One stage of a task: Implement, Review, Verify. Steps report back to the lead. |
| Steps, the plan | workflow graph | A task's steps before it starts (the plan) and while it runs. |
| Tried three ways | run attempts, the repair ladder | What Althar already did before asking you: a retry, a repair, another agent. |

## You and the work

| On screen | In the model | What it is |
|---|---|---|
| Call | attention request | Something only a person can decide. Violet. |
| Needs you | attention requests addressed to you, and tasks ready to accept | The board lane, the count at the top of a project's screen, and the violet number on a project's tab (the home's tab counts every project). A task waiting on a call shows in it once, as its own card saying the call's kind and why; a call no task waits on, such as the coordinator's question, is a card of its own. A task that is Finished sits in the lane, but no count includes it. |
| Tab | a project the window keeps open | One per project the person keeps open, at the top of the window, after the home's. It goes back to where in the project they last were. ⌘1 is the home, ⌘2 onwards the projects. |
| Round the notch, In the menu bar | the edge (`main/edge.ts`) | Where Althar shows what needs you while you're in another app: an island round the notch on a Mac that has one, which is the notch alone until something needs you, or Althar's mark in the menu bar, with a dot while something needs you. Either opens to what needs you, where a permission is answered in place, with the work in progress counted in one line under it. Settings calls it "In other apps" and shows it on every system: off a Mac with a notch it is the menu bar, the system tray, or, on a desktop with no tray, only Althar's window, and there is nothing to choose. |
| Permission | permission attention request | A call asking whether an agent may do something, such as run a command or change a file. Allow it once or always, or don't: with what to do instead, or never (on the edge, once or not). Several at once stack, with Allow all. |
| Allowed, Denied; Once, Always, Never | a permission answered on the home or the edge | An answered permission's line, which stays where it was, at its height, quiet, until you leave: its kind says Allowed or Denied, and where its answers were it says what you said (Once, Always or Never), then where an always or a never was kept ("kept in meridian's rules"), your note when you denied with one, or else which project it was in. |
| Question, Needs your answer | question attention request | A call where an agent asks the person to choose: one or more questions, each with its options, each option with what it means, and room for your own words. Answered in the task, where it was asked. The home and the edge list it calmly, by what it asks and why, in what the agent said just before (or else who asks, and where), and Answer takes you to it, its first choice in hand; the board's card shows its options' names. Answered, it folds to what you said; withdrawn, it says "Not answered" and why. |
| Stuck | attention request at the end of the repair ladder | A task that can't finish without you. There is no Failed status. |
| Ready to accept | task phase `ready` | Work that is done and waits for you to accept it. |
| Finished | a plain task's phase `ready`, not seen since (`tasks.seen_at`) | A plain task whose lead is done, in its project's Needs you until you open it, with the pictures or files it handed back, small, or else its branch, where its lead wrote in the repository. Not on the home, the edge, the Dock's count or in notifications: it asks nothing of you. |
| Done | a plain task settled once seen (`task.done`, `seen: true`) | A Finished task you opened: it moves to Settled. Writing to its lead later opens it again as a follow-up. |
| Queue, "Enter queues it; the lead reads it next" | `after_current` | What you write while the lead works. It waits for the lead's current turn to end. |
| Send now | `interrupt_and_continue` | Stops the lead's turn to read your message, then it carries on with both. |
| Interrupt the lead | turn interrupt | The composer's square. Ends the lead's turn; the task stays open. The line in the thread reads "Interrupted by you". |
| Listening to | `external_links.listening` | Over a task's composer: the pull requests Althar asks for news while it runs, what they last said, and, for a moment, what just came. Stop stops it: nothing said there after reaches the thread or the lead. |
| Running, Ran | what an agent left running (`LeftRunning`, ADR-022), and Althar's own runs (`Launches`, ADR-023) | Over a task's composer: commands its lead sent to the background, such as a dev server, and what Althar runs of the task itself; over the coordinator's, every run Althar has going in the project, each saying where it runs. Each with where it answers, which opens in your browser. Stop stops one. One that ended by itself says how ("exited 1") until you clear it. What a lead left runs as long as its session does; Althar's runs until you stop it or quit. |
| Run card | a `run` thread item (`RunCard`, ADR-023) | What a run of the project leaves in the thread it was asked for in: where it runs, the command, where it answers, as a link, and how long it has been up, with Stop. It stays once the run is over, saying how it ended, with Run again. |
| Installing dependencies in meridian…, Installed dependencies in meridian | a `setup` thread item (`Setups.ts`, ADR-023) | A line across a task's thread: Althar setting up the task's worktree before its lead starts, with the install its lockfile names, or "Setting up meridian…" with the setup kept for it. Failed, the end of what it printed stands under it, and the lead is told. Not "bootstrap" or "provision". |
| Asks you to push | a `push_request` thread item (`PushRequest`) | The lead asking you to push what it committed to the task's pull request, in the task's thread: the commits that would go up, with Push. Nothing goes up until you press it, and then only what it shows. It stays once pushed, asked again or closed. |
| Run `bun run dev` | `RunProject`, ADR-023 | In a task's menu, what it built, in its worktree; on the project's front, its default branch, in a copy of Althar's. Althar runs it, with no agent, with the command the repository says or that's kept for it. |
| Find a task, ⌘K | `SearchTasks`, the coordinator's `find_tasks`, `task_search` (ADR-035) | Finding a task by what it was about: its title, what you asked, what its lead built, a pull request's number, a branch or a file. ⌘K in a project searches it; on the home, every project. With nothing typed it lists the tasks changed last ("Recent"); found, each says where it stands in a word and what matched besides its title. Not "search results" or "query" on screen. |
| Hold | plan held | On a plan waiting to start: its countdown stops, and it starts when you say. |
| Start now | plan accepted | Starts a plan waiting to start, from its card or the task menu. |
| Issue draft | an `issue_draft` thread item, `issue_drafts` | An issue the coordinator drafted on a connected tracker, as a card in the Talk room: the tracker, where it goes there, its title, description and labels. Nothing is filed until you file it. |
| File issue, File again, Edit, Discard | issue draft filed, changed, discarded | On an issue draft: File puts it on the tracker, and the card then shows its key as a link; Edit changes it first; Discard drops it, filing nothing. Not filed, the card says why, and File again tries again. Perhaps filed (its answer was lost), the card says it may be on the tracker already, to look there before File again. Never "create", "submit" or "approve" on screen. |
| Review, Review #123 | a review task: one with an external link of kind `review` and a workspace it only reads (`Reviews.ts`) | A task that reviews someone else's pull request, started by asking the coordinator or pasting the pull request's link and asking. Its lead reads a copy of the pull request's code that Althar fetched, runs nothing of it, and drafts a review. Not "audit" or "inspect" on screen. |
| Reads ninemate’s branch · runs nothing of it · no network · posts nothing until you do | what a review's lead can reach (`ReachLine`) | The sentence under a review's header; each phrase opens what it means. "No network" is there for a pull request from outside the team: from a fork, or by someone GitHub doesn't name one of the repository's people. "Posts once drafted" replaces the last phrase where the setting below posts it. |
| Review draft | a `review_draft` thread item, `review_drafts` | The review a lead drafted, as a card in the review's thread: the pull request, your verdict beside the lead's suggestion, its summary, and its comments on lines, each Kept or Dropped. Nothing is on GitHub until you post it. On a pull request from outside the team, Approve is never chosen for you. Waiting to be posted, its task says Review drafted: on its card in Needs you, on the home, the edge, in a notification and in its header. |
| Your verdict; Comment, Approve, Request changes | `ReviewVerdict` | What a review says of a pull request as a whole. The lead suggests one ("Claude Code suggests Request changes"); yours is what posts. |
| Post review, Post again, Edit, Discard | review draft posted, changed, discarded | On a review draft: Post review puts it on the pull request with your verdict and the comments kept, and the card folds to "Review posted on #123: Request changes, 2 comments", with Open on GitHub; the review is then settled. Edit rewords its summary and comments; Discard drops it, posting nothing. Not posted, the card says why, and Post again tries again. Perhaps posted (its answer was lost), the card says it may be on GitHub already, to look there first. Never "submit" or "approve" for Post on screen. |
| Post reviews of my team’s pull requests without asking | the `post_team_reviews` setting | In Settings, off by default: a review of a pull request by one of the repository's people, from a branch of its own, posts itself as soon as its lead drafts it. One from outside the team always waits for Post. |
| Stop the task | run suspended | From the task menu. Every agent on it stops, and the step it was on is cut short. Nothing runs, and nothing waits on you, until you resume it. Status: Stopped. |
| Resume | run resumed | From the task menu, or by writing to a stopped task: the lead carries on the step it was on, with what you wrote first. |
| Abandon | task abandoned, its run suspended | From the task menu, asked first. Ends the task without its change. It moves to Settled. Its worktree and branch stay. |
| Reopen | an abandoned task open again | Only for an abandoned task, never a merged one. It opens on the same worktree and branch, where it was: a step cut short resumes, work that had passed is ready again. Writing to an abandoned task reopens it too. |
| Follow-up, Following up | a round of work after the plan (a run with no plan, ADR-034) | What the person asks a task's lead for once its plan's steps are done: the task runs again, ready, merged or settled as it was, and its track names its first step Follow-up, its header Following up. The lead finishes it with its summary, a review follows where the plan has one, and one that changed nothing leaves the task where it was. Not "round" or "iteration" on screen. |
| Skip the review | a run's review step skipped | In a task's menu while its work still has a review to come or under way: it is ready once its lead is done, unreviewed this time. The next follow-up has its review again. |
| Open a new pull request, Before this | a task's next pull request (ADR-034) | Offered once a task's pull request merged or closed and its lead committed more after it: a new draft, on a new branch from the default branch, with only the commits after the last. The task shows its latest pull request, and each earlier one under it as "Before this: PR #1, merged on GitHub." |
| Althar restarted | reconciliation after process loss | Not said in threads: a lead that stopped with Althar starts again when the person next writes to it, and nothing it was doing runs twice. A step that was running carries on by itself, with a line in its thread; it asks the person only if its lead can't start, or a restart stops it again soon after the last one carried it on. |

A call's kind reads the same everywhere it shows: on the board, in the bar's preview and on the home.

## Updates

| On screen | In the model | What it is |
|---|---|---|
| This update couldn’t move your data | a migration that didn't finish (`MigrationFailed`, `ForeignKeyViolations`), or the copy before it (`BackupFailed`) | What the window shows instead of opening when an update couldn't bring the person's data to its new shape. It says the data is safe, where the copy from before the update is, and what stopped it. Nothing of Althar runs behind it. |
| Copy from before the update | a backup, in the profile's `backups` folder | The copy of the person's data Althar makes before an update moves it, kept as a file they can find. The newest three are kept. |

## What comes back

| On screen | In the model | What it is |
|---|---|---|
| Change | `ChangeSet` | A task's pull requests across its repositories, with files and checks. |
| Accept | approve, merge | Takes the change. Merging stays yours unless the rules say otherwise. |
| Ask for changes | request changes | Writes the lead a note about what should change; sent, the lead takes the work up again with it. |
| Findings | review findings | What a review step found. By default the lead settles them. |
| Artifacts | artifacts | What a task wrote that is worth keeping and isn't in a repository. |
| Screenshots, Image | artifact of kind `image` | Pictures an agent hands back, under what it said, full size on a click. One without a name is "Image 1". |
| Add images, Drop to add them to your message | `user_input_images`, artifacts of kind `image` | Images you send with a message: dropped on the composer, pasted, or picked with Add images; shown small above what you write, each with Remove, and above your message once sent. PNG, JPEG, GIF or WebP, up to ten a message; one wider than 2000 pixels or over 5 MB is made smaller first. An agent that doesn't take images gets none: the composer says so. One copied with no name is "Pasted image". |
| Document | a markdown file an agent wrote or pointed at | Its card stands under what it said; "Read in the panel" opens it beside the thread, as it is now in the worktree. |
| Output | artifact of kind `log` | What a command printed, in its tool call: its last lines, "N earlier lines" a click away. |
| Knowledge | knowledge claims | Everything the project holds. It has two parts: |
| Notes | project notes, `project_notes`; later, canonical claims | Decisions the person made in conversation that the code doesn't show, a sentence each, which the coordinator keeps and every session of it starts with (ADR-031). Shown in the project's settings, where one that no longer holds is removed. Later, what every task starts with too: decisions, conventions, architecture. |
| Seen in tasks | episodic claims | What one task observed. It can be proposed as a note. |
| Project rules | execution policy, `ProjectRules` | When agents need a yes, what always asks, what is never allowed, how a task ends, how its branches and pull requests are named, what a usage limit does, and which accounts work runs on (ADR-013). |
| Always ask me, Ask me | `alwaysAsk` kinds, `ask` command rules | What waits for the person whoever would answer: kinds of request, and commands they named by how they start or exactly. The rules screen's sentence for it is "Ask me". |
| Never | `never` kinds and command rules | What is refused without asking anyone, even with everything allowed. |
| Always allowed, Go ahead | `alwaysAllow` kinds, `allow` command rules | What is let through without asking, short of what always asks or is never allowed: kinds, and commands by how they start or exactly. Where the coordinator decides, these answer before it is asked. Answering a permission with "always allow" adds one (ADR-018). The rules screen's sentence for it is "Go ahead". |
| The rest | the mode, `permissions` | What happens to what no rule keeps: allowed, the coordinator decides, ask me, or allow everything. A kind of request on no list is with the rest. |
| Allow always, Never allow | an answer that keeps a rule, by its scope | An answer that is also kept in the project's rules: for this exact command, commands starting the same way, or the kind of request. Offered only where the rule would hold. |
| Rules from your agents, Import from your agents | `ReadAgentRules`, `ImportAgentRules` | What the agents' own settings (`.claude/settings.json`, Codex's rules, `opencode.json`) would add to a project's rules, offered once as the project opens and from the rules screen. The person takes all of it, some or none; a rule taken says the file it came from (ADR-036). |
| Allowed by the project's rules | a decision a rule made | The quiet line under a turn for what an allow rule let through, opening to each command and its rule. |
| Settled | terminal states | Calls answered, changes accepted, tasks abandoned, plain tasks seen (Done). |

## Althar itself

| On screen | In the model | What it is |
|---|---|---|
| Althar 0.1.1 is ready, Restart | an update Squirrel has in place (`main/updates.ts`) | A newer Althar, downloaded in the background, said in one quiet line in the window's bar and Settings' foot. Restart is there only while no work runs; otherwise the line says it installs when you quit. Checking and downloading never show. |
| Check for Updates… | `checkNow` | In the app menu: looks now, and says in a dialog what it found. |
| What's new | a release's notes | In Settings' foot, beside the version: that version's GitHub Release, in the browser. |
| CPU, MEM; This Mac's load | `GetLoad`, `LoadMeter` (ADR-029) | How hard the computer works, as two short meters in the window's bar, Althar's work's part of each in cobalt; "Memory is tight" or "Memory is short" beside them when macOS says so. Clicked, the last two minutes, the figures, and what each task, coordinator and default branch running uses. On by default; "Show how hard this Mac works" in Settings, or "Show in the bar" in the peek, turns it off for every window. |

## Words the interface doesn't use

Worker, session, run, attempt, node, graph patch, compensation, attention
request, canonical, episodic, binding and failed. Each has an entry above.
If one of them turns up on screen, treat it as a bug.

## Still to align

- The model browser says "runtime", in its column and in "Connect a runtime".
  First run and the rules say "agent". Leaning: "agent" everywhere on screen.
