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
| Remove from Althar | `Project.archived_at` | Taking a project out of the window and the home. Its agents stop and nothing it planned starts. Its folders, its tasks' worktrees and their branches stay. Opening its folder again makes a new project. Not "delete" or "archive". |
| Agent | runtime, adapter | Claude Code, Codex, OpenCode and the like, as installed on this machine. |
| Account | `AgentAccount`, its home | One sign-in of an agent, kept in a folder of its own. The agent's usual sign-in is its first account; the person can add more, or bring in folders a switcher made. Named by the person ("work"), it shows after the agent's name: "Codex (work)". |
| Signed in as | `ProviderPrincipal` | Who the agent says you are, for an account. The agent keeps its own sign-in; Althar never holds the credential. |
| Sign in | vendor login, `auth_required` | Opens the agent's own sign-in, for an account. |
| Out of usage | usage limit, `transient_provider` | The account has used its allowance until a reset. Depending on the project rules, the task is Paused, or moves to another of the agent's accounts, then to another agent. |

## Who does the work

| On screen | In the model | What it is |
|---|---|---|
| Coordinator | coordinator | The project's agent in the Talk room. It plans tasks and hands them out, but writes no code itself. |
| Task | `Task` | One piece of work with an outcome, usually one change. |
| Lead | the task's primary agent (the docs sometimes say worker) | The agent that owns a task: it implements, runs the steps and answers them. Never "worker" on screen. |
| Step | workflow node | One stage of a task: Implement, Review, Verify. Steps report back to the lead. |
| Steps, the plan | workflow graph | A task's steps before it starts (the plan) and while it runs. |
| Tried three ways | run attempts, the repair ladder | What Althar already did before asking you: a retry, a repair, another agent. |

## You and the work

| On screen | In the model | What it is |
|---|---|---|
| Call | attention request | Something only a person can decide. Violet. |
| Needs you | attention requests addressed to you, and tasks ready to accept | The board lane, the count in the title bar, and the violet number on a project's tab (the home's tab counts every project). |
| Tab | a project the window keeps open | One per project the person keeps open, at the top of the window, after the home's. It goes back to where in the project they last were. ⌘1 is the home, ⌘2 onwards the projects. |
| Round the notch, In the menu bar | the edge (`main/edge.ts`) | Where Althar shows what needs you while you're in another app: an island round the notch on a Mac that has one, which is the notch alone until something needs you, or Althar's mark in the menu bar, with a dot while something needs you. Either opens to what needs you, where a permission is answered in place, with the work in progress counted in one line under it. Settings calls the choice "While you're in another app", and offers it only with a notch. |
| Permission | permission attention request | A call asking whether an agent may do something, such as run a command or change a file. Allow it once or always, or don't: with what to do instead, or never (on the edge, once or not). Several at once stack, with Allow all. |
| Allowed, Denied; Once, Always, Never | a permission answered on the home or the edge | An answered permission's line, which stays where it was, at its height, quiet, until you leave: its kind says Allowed or Denied, and where its answers were it says what you said (Once, Always or Never), then where an always or a never was kept ("kept in meridian's rules"), your note when you denied with one, or else which project it was in. |
| Stuck | attention request at the end of the repair ladder | A task that can't finish without you. There is no Failed status. |
| Ready to accept | task phase `ready` | Work that is done and waits for you to accept it. |
| Queue, "Enter queues it; the lead reads it next" | `after_current` | What you write while the lead works. It waits for the lead's current turn to end. |
| Send now | `interrupt_and_continue` | Stops the lead's turn to read your message, then it carries on with both. |
| Interrupt the lead | turn interrupt | The composer's square. Ends the lead's turn; the task stays open. The line in the thread reads "Interrupted by you". |
| Stop the task | run suspended | From the task menu. Nothing runs until you resume it. Status: Stopped. |
| Abandon | `cancel_run` | Ends the task without its change. It moves to Settled. |
| Reopen | a new run on a finished task | Only for a task that is done. |
| Althar restarted | reconciliation after process loss | Not said in threads: a lead that stopped with Althar starts again when the person next writes to it, and nothing it was doing runs twice. A step that was running asks the person to carry it on. |

A call's kind reads the same everywhere it shows: on the board, in the bar's preview and on the home.

## What comes back

| On screen | In the model | What it is |
|---|---|---|
| Change | `ChangeSet` | A task's pull requests across its repositories, with files and checks. |
| Accept | approve, merge | Takes the change. Merging stays yours unless the rules say otherwise. |
| Ask for changes | request changes | Writes the lead a note about what should change; sent, the lead takes the work up again with it. |
| Findings | review findings | What a review step found. By default the lead settles them. |
| Artifacts | artifacts | What a task wrote that is worth keeping and isn't in a repository. |
| Screenshots, Image | artifact of kind `image` | Pictures an agent hands back, under what it said, full size on a click. One without a name is "Image 1". |
| Document | a markdown file an agent wrote or pointed at | Its card stands under what it said; "Read in the panel" opens it beside the thread, as it is now in the worktree. |
| Output | artifact of kind `log` | What a command printed, in its tool call: its last lines, "N earlier lines" a click away. |
| Knowledge | knowledge claims | Everything the project holds. It has two parts: |
| Notes | canonical claims | What every task starts with: decisions, conventions, architecture. |
| Seen in tasks | episodic claims | What one task observed. It can be proposed as a note. |
| Project rules | execution policy, `ProjectRules` | When agents need a yes, what always asks, what is never allowed, how a task ends, how its branches and pull requests are named, what a usage limit does, and which accounts work runs on (ADR-013). |
| Always ask me | `alwaysAsk` kinds, `ask` command rules | What waits for the person whoever would answer: kinds of request, and commands they named by how they start. |
| Never | `never` kinds and command rules | What is refused without asking anyone, even with everything allowed. |
| Always allowed | `alwaysAllow` kinds, `allow` command rules | What is let through without asking, short of what always asks or is never allowed: kinds, and commands by how they start or exactly. Where the coordinator decides, these answer before it is asked. Answering a permission with "always allow" adds one (ADR-018). |
| Allow always, Never allow | an answer that keeps a rule, by its scope | An answer that is also kept in the project's rules: for this exact command, commands starting the same way, or the kind of request. Offered only where the rule would hold. |
| Allowed by the project's rules | a decision a rule made | The quiet line under a turn for what an allow rule let through, opening to each command and its rule. |
| Settled | terminal states | Calls answered, changes accepted, tasks abandoned. |

## Words the interface doesn't use

Worker, session, run, attempt, node, graph patch, compensation, attention
request, canonical, episodic, binding and failed. Each has an entry above.
If one of them turns up on screen, treat it as a bug.

## Still to align

- The model browser says "runtime", in its column and in "Connect a runtime",
  and the rules say "a runtime's account". First run says "agent".
  Leaning: "agent" everywhere on screen.
