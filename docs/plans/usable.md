# Usable end to end

> **Temporary.** The plan for rounding Charrette off into something people use
> every day, not architecture. Delete it when the last step ships, and move
> anything that lasted into the architecture docs.

Agreed with the user on 1 October 2026, after they used the app for real.

## Goal

Charrette solves two problems:

1. **One app for all your agent conversations,** whatever subscription runs
   them, instead of a window per vendor.
2. **Long-running work that doesn't need you:** loops that carry on, and only
   ask when something really is yours.

The shell prototype (`charrette-designs/prototypes/shell`) is the target,
without the knowledge graph, which is set aside for now. Most of what the
prototype shows is already in the kit (`@charrette/ui`); what's missing is
the runtime behind it and the app wiring it up.

## What's missing

1. **Seeing the change.** There's no diff anywhere: a task without a pull
   request has no view of its change, and accepting one means leaving the app.
2. **The board.**
   - Conversation, Board, and both side by side.
   - Its columns:
     - Up next: plans not started yet;
     - Running, with where each is;
     - Needs you: calls, permission asks, changes ready to accept;
     - Settled.
   - Acting from a card in the dock.
   - "3 running · 2 need you" in the chrome.
3. **Work that doesn't need you.**
   - **Usage limits handled:** move to the next agent free, or wait for the reset.
   - **The lead answers permission asks** within the project's rules, which the
     kit's ProjectRules screen sets.
   - **A step that stalls** becomes a call.
   - **macOS notifications** and a dock badge when something needs you or is
     ready.
4. **One app for your conversations.**
   - **Talking without planning:** a session or a question, besides a task
     with a plan.
   - **The kit's model picker,** with effort and pins, and the context ring.
   - **Every conversation in one place,** across projects, with search.
   - **Later:** bringing in existing Claude Code and Codex history.

## Order

One pull request each:

1. **Seeing the change.**
   - The runtime reads a task's change from git when it is asked for:
     - its files, from its base to its worktree, committed or not;
     - a file's diff, in hunks.
   - The kit's ChangeView shows it over the whole window. It opens from the
     task's header, from a file in its pull request, or with ⌘D.
2. **The board,** and the chrome's counts. Merging from it, as the person's
   click, at the head the person saw. Local merging for a task without a pull
   request comes with step 3, and so does sending work back as a step of its
   own: a new run of the task with the note as its input, which ends with the
   lead's summary and a push, rather than a message the lead may or may not
   push after.
3. **Work that doesn't need you.**
4. **Conversations.**

Brought forward from step 4, after the board: **the model picker.** Every
agent's models in one list, read from the agents themselves, with effort, pins
and default efforts, in the coordinator's and a task's composer, a new task's
lead and review, and each step of a plan. Picking another agent's model hands
the conversation to it. The context ring stays with step 4: ACP doesn't say a
model's context window, so the browser shows none.

Then the integrations plan's next step, GitLab.

## Decided

Confirmed with the user on 1 October 2026:

- **Merging a pull request** is a button in the app, as the person's click,
  as marking it ready is.
- **A task without a pull request** merges into its base locally, as the
  person's click.
- **No limit on tasks at once,** and no queue: a cap would be arbitrary, so
  no flow is designed around one (changed on 3 October 2026; it was three
  per project).
- **Permission asks** are the lead's to answer within the project's rules;
  only the "always ask me" list reaches the person.
- **A usage limit is handled as configured:** stop and wait for the reset, or
  move to the next agent automatically. Where it is set comes later; the
  setting exists from the start.

## Usage limits

Next, decided with the user on 3 October 2026, as designed in docs 03 and 05.

- **When.** A turn fails with the agent's usage limit, which its error says,
  with the reset time where it gives one: a lead's, a reviewer's or the
  coordinator's. Also a step about to start on an agent known to be out.
- **Who is out.** The agent's account on this Mac, until its reset. Without
  a reset time, for an hour, then it is tried again.
- **What happens** is the project's setting: move on (the default) or wait.
  The setting exists from the start; where the person sets it comes later.
  - **Move on.** The work goes to the next free agent: signed in, not out,
    in the agents' order. Its model is chosen as below, at the person's
    default effort for it. It takes over from a brief in the same worktree,
    and a step runs again on it, as when the person hands a step over. The
    thread says it in one line: who is out, when it resets, who took over
    and on which model. With no agent free, it waits.
  - **Wait.** A step is held until the reset, then runs again on the same
    agent; its card says what it waits for and until when. Without a reset
    time, the step needs the person, who hands it over or abandons it.
- **Outside a step,** the coordinator or a lead the person is talking to
  moves on the same way, and the person's message goes to the agent that
  took over. Waiting, the message waits in the queue until the reset.

## Which model the next agent runs

When work moves to another agent, its model, in this order:

1. **The plan's choice.** The model the plan named for that agent on this
   step, if it named one.
2. **The person's last.** The model the person last used with that agent in
   this project, since that is the choice they made, on their plan.
3. **The agent's default.** Its own default, as its CLI would start, which
   respects the person's own config.

Later, match the tier of the model it replaces, strongest for strongest,
from a small table of known model families. The move is said in the thread:
which agent reached its limit, when it resets, and which agent and model
took over and why. The next agent is the next free one in the order of the
person's connections, as the kit already words it.
