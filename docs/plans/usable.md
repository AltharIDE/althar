# Usable end to end

> **Temporary.** The plan for rounding Althar off into something people use
> every day, not architecture. Delete it when the last step ships, and move
> anything that lasted into the architecture docs.

Agreed with the user on 1 October 2026, after they used the app for real.

## Goal

Althar solves two problems:

1. **One app for all your agent conversations,** whatever subscription runs
   them, instead of a window per vendor.
2. **Long-running work that doesn't need you:** loops that carry on, and only
   ask when something really is yours.

The shell prototype (`althar-designs/prototypes/shell`) is the target,
without the knowledge graph, which is set aside for now. Most of what the
prototype shows is already in the kit (`@althar/ui`); what's missing is
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
     ready. A notification only while the person looks elsewhere, never for
     progress; the badge counts calls and tasks ready, across projects.
   - **Several accounts per agent**
     ([ADR-012](../decisions/012-several-accounts-per-agent.md)). They form a
     pool, which a project's rules can narrow, and switchers people already
     use are supported. A usage limit moves work to the agent's next account
     first.
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
   request comes with step 3.
3. **Work that doesn't need you.** Done so far:
   - usage limits;
   - notifications and the Dock badge;
   - accounts in the runtime, and the agent's accounts on the start
     (Accounts, below);
   - the project rules screen (Project rules, below);
   - stalls: a running turn is watched for signs of life, carried on, started
     afresh, then asked about; loops and a budget of time and turns besides
     ([05](../architecture/05-workflow-engine.md)).

   - pushing is the person's: what the lead commits after the pull request
     opens waits for a Push button, which pushes up to the commit the person
     saw;
   - projects of several repositories, and of a folder inside one, asked for
     on 2026-10-05: a folder's repositories are listed to keep or leave out, a
     task names the ones it changes, and each is worked, published and pushed
     on its own
     ([01](../architecture/01-concepts-and-project-model.md)).

   Next:
   1. Local merging.
   2. The lead answers permission requests: the "lead decides" mode.

   Decided on 2026-10-04:
   - **No "send back" step.** The task's chat is how the person sends work
     back: the card shows the lead at work and is ready again after. The
     dock's note goes into that same chat.
   - **Later: always push.** A choice next to Push, per project, for people
     who want follow-ups pushed as the lead commits them.
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

Confirmed with the user on 3 October 2026:

- **Several accounts per agent,** each in its own folder. They form a pool
  that a project's rules can narrow, as in ADR-012. The account switchers
  people already use for Codex, OpenCode and Claude Code are supported:
  - homes a switcher made are adopted;
  - the account a swapping switcher made active is the agent's first;
  - rotation inside the agent works unchanged.

## Usage limits

Next, decided with the user on 3 October 2026, as designed in docs 03 and 05.

- **When.** A turn fails with the agent's usage limit, which its error says,
  with the reset time where it gives one: a lead's, a reviewer's or the
  coordinator's. Also a step about to start on an agent known to be out.
- **Who is out.** The account the work ran on, until its reset. Without a
  reset time, for an hour, then it is tried again. Until accounts come, an
  agent has one, so the agent is out. With accounts, its others are not
  (ADR-012).
- **What happens** is one of the project's rules: move on (the default) or
  wait, a new revision of its rules when the person changes it, which a run
  cites. Where the person sets it comes later.
  - **Move on.** With accounts, where the project rotates (off until the
    person turns it on), the work first goes to the same agent's next
    account that the project allows, signed in and not out, on the same
    model; the person added it, so a key pays as well as a plan. Then it goes to the next free agent: signed in on a plan,
    not out, in the agents' order, and not the other step's agent unless
    nothing else is free (the thread then says it reviews its own work). An
    agent paid per use, on a key, is never moved to unasked: that spends the
    person's money; the person can still hand work to it. Its model is chosen as below, at the person's
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

## Accounts

Next in step 3, decided with the user on 3 October 2026, as designed in
ADR-012 and doc 03 (Several accounts). One pull request for the runtime and
Settings, then the project rules screen.

- **The record.** An account per sign-in, with:
  - its agent and device;
  - the person's name for it and their order;
  - its home, or none for the agent's usual folder;
  - who it is signed in as, and whether a plan or a key pays for it.

  Each session records its account. A migration gives every agent's existing
  sign-in an account with no home, so nothing changes for one sign-in.
- **Running on an account.**
  - The registry says each agent's home variable (`CLAUDE_CONFIG_DIR`,
    `CODEX_HOME`, `XDG_DATA_HOME`), and a session starts with its account's
    home set in it.
  - The sign-in check, the paid-by reading and the model probe run per
    account.
  - Limits are kept per account.
- **Adding one.**
  - Settings, under the agent: Add an account, with a name.
  - Althar makes the home, links the person's usual settings into it, and
    opens the agent's own sign-in in a terminal.
  - It then shows who the account is signed in as.
- **Bringing one in.**
  - Settings lists the folders of the known switchers that give each account
    a home, and the person picks which to add. Any other folder can be added
    by hand.
  - Nothing is opened inside them.
- **Which runs.**
  - A conversation stays on its account.
  - A new session takes the first allowed account in the person's order
    that is signed in and not out.
  - On a limit, the same agent's next account comes before the next agent.
  - The thread names accounts only where it matters: a move, a session's
    header, Settings.
- **The project's rules** gain which accounts of each agent the project may
  use (all by default) and whether work rotates through them (off by
  default), as a revision like the usage-limit rule. The runtime and the API
  (`SetProjectAccounts`) have them; the person sets them on the project
  rules screen, next.
- **Removing one** Althar made signs it out with the agent's own tool and
  deletes its folder; one another tool made stays as it is.
- **Tests.**
  - Fake agents get a home each. A home's variable reaches the fake, which
    says which account it runs on.
  - An e2e test where one account is out and the same agent's next takes
    over.

## Project rules

Decided on 4 October 2026, after looking at how other agent tools do it
(ADR-013 has the comparison). Their shape is the industry's: a mode, rules
that ask or refuse with refusal winning, and commands matched by how they
start, per command of a shell line. What changed from the prototype's
screen, to say only what Althar does:

- **Who answers.** "Allow, except what you keep" is the default, with "Ask
  me" and "Allow everything". "The agent in charge decides" comes back with
  the lead answering requests.
- **Always ask me, and Never:**
  - the kinds of request the rules know, each switchable;
  - commands the person adds by how they start, with a note that rules hold
    for what agents ask to do beyond their sandbox.
- **Rows dropped for now:** review findings, and "Ask me" on a usage limit.
- **Usage limits:** move or wait.
- **Accounts:** for agents with more than one account, which ones the
  project may use, and whether work goes on with the next account when one
  runs out (off by default).
- **When a task is done:** the project's ending, used where a plan names
  none.
- **Where it lives:** the project's title bar opens it, and each change is
  saved at once, as a revision.

Folded in, from #23's review: rotation off means each agent's first allowed
account (skipping one signed out), with its being out handled by the
usage-limit rule. A removed account's folder goes only after the agent's own
sign-out worked, and only ever a folder right under the accounts root.

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
