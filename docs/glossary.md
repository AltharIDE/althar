# Glossary

The words Charrette's interface uses, with the word the architecture docs use
for the same thing. The interface says the left column. Code, docs and ADRs may
say the right. When something new needs a name on screen, add it here first.

## Where work happens

| On screen | In the model | What it is |
|---|---|---|
| Project | `Project` | A body of work with its own rules, knowledge and history. It may have no repositories. |
| Repository | `RepositoryBinding` | A repository that the project's tasks may change, with its role. It is shared by everyone on the project. |
| On this Mac, Map it later | `RepositoryLocation`, or none | Where this device keeps that repository. "Map it later" is a binding with no location here. On the Sources view that state is "needs mapping". |
| Reading it | read-only inspection | What Charrette does to a folder before a project exists. It changes nothing. |
| Agent | runtime, adapter | Claude Code, Codex, OpenCode and the like, as installed on this machine. |
| Account | `AgentAccount`, its home | One sign-in of an agent, kept in a folder of its own. The agent's usual sign-in is its first account; the person can add more, or bring in folders a switcher made. Named by the person ("work"), it shows after the agent's name: "Codex (work)". |
| Signed in as | `ProviderPrincipal` | Who the agent says you are, for an account. The agent keeps its own sign-in; Charrette never holds the credential. |
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
| Tried three ways | run attempts, the repair ladder | What Charrette already did before asking you: a retry, a repair, another agent. |

## You and the work

| On screen | In the model | What it is |
|---|---|---|
| Call | attention request | Something only a person can decide. Violet. |
| Needs you | attention requests addressed to you | The board lane and the count in the title bar. |
| Stuck | attention request at the end of the repair ladder | A task that can't finish without you. There is no Failed status. |
| Queue, "Enter queues it; the lead reads it next" | `after_current` | What you write while the lead works. It waits for the lead's current turn to end. |
| Send now | `interrupt_and_continue` | Stops the lead's turn to read your message, then it carries on with both. |
| Interrupt the lead | turn interrupt | The composer's square. Ends the lead's turn; the task stays open. The line in the thread reads "Interrupted by you". |
| Stop the task | run suspended | From the task menu. Nothing runs until you resume it. Status: Stopped. |
| Abandon | `cancel_run` | Ends the task without its change. It moves to Settled. |
| Reopen | a new run on a finished task | Only for a task that is done. |
| Charrette restarted | reconciliation after process loss | The thread line shown while Charrette checks what the lead had done, so nothing runs twice. |

## What comes back

| On screen | In the model | What it is |
|---|---|---|
| Change | `ChangeSet` | A task's pull requests across its repositories, with files and checks. |
| Accept | approve, merge | Takes the change. Merging stays yours unless the rules say otherwise. |
| Send back | request changes | Returns the change to the lead with a note. |
| Findings | review findings | What a review step found. By default the lead settles them. |
| Artifacts | artifacts | What a task wrote that is worth keeping and isn't in a repository. |
| Knowledge | knowledge claims | Everything the project holds. It has two parts: |
| Notes | canonical claims | What every task starts with: decisions, conventions, architecture. |
| Seen in tasks | episodic claims | What one task observed. It can be proposed as a note. |
| Project rules | execution policy | When agents need a yes, what always asks, what is never allowed, how a task ends, what a usage limit does. |
| Settled | terminal states | Calls answered, changes accepted, tasks abandoned. |

## Words the interface doesn't use

Worker, session, run, attempt, node, graph patch, compensation, attention
request, canonical, episodic, binding and failed. Each has an entry above.
If one of them turns up on screen, treat it as a bug.

## Still to align

- The model browser says "runtime", in its column and in "Connect a runtime",
  and the rules say "a runtime's account". First run says "agent".
  Leaning: "agent" everywhere on screen.
