# ADR-036: A project runs many things, from a list with a default

- **Status:** Accepted
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** ADR-023 gave each repository one way to run, worked out or
  kept, behind one Run button: `bun run dev`, and nothing else. A project has
  more worth running by hand: a dev server, Storybook, the app itself, tests
  in watch mode, a docs site, a migration, a one-off script. The one button
  hid that there was more, and the person had no way to add or remove what
  runs. Five directions were prototyped on the real app (a split button, a
  panel made like Settings, chips in the bar, a launcher on ⌘R, a dock with
  output); the person chose the split button.
- **Decision:**
  - **A project keeps what it runs as a list,** in the person's order, the
    first its default. Each runs in one of its repositories: its name, where
    someone gave one, and its command. One with no command of its own is its
    repository's own way to run, kept with `set_run_command` or worked out
    from it as ADR-023 says, and follows the repository as it changes. Every
    repository has its own way in the list as it is bound, so nothing changes
    for a project until more is added. The setup a repository keeps or works
    out makes a fresh copy ready for each of its runnables alike.
  - **The Run button is a split button** at the top of the project's front and
    in a task's bar (where the task menu's Run item was). One press runs the
    default, as before; while that runs, it says where it answers and opens
    it. Its chevron lists everything, those running first, checked, each with
    where it answers or how it last ended; picking one starts or stops it, and
    the list stays open, so several start at once. Then **Add something to
    run…** (typing its command, picking from the repository's package.json
    scripts, workspaces' too, or asking the coordinator to work it out) and
    **Edit the list…** (reorder, make one the default, edit, remove). With
    nothing known to run, the button offers the three ways.
  - **Several run at once, one of each in a place:** a task's worktree, or the
    default branch's copy. Runs of the default branch share their repository's
    copy, made fresh as a run starts only where nothing of that repository
    runs from it now, which a fresh copy would change under it.
  - **Who said how is kept and shown:** worked out from the repository, added
    by the person, added by the coordinator, or kept by an agent. Changing a
    repository's own way gives it a command of its own, the person's.
  - **Agents keep more with `keep_run`,** by a short name and a command, the
    coordinator and leads alike; a null command drops one. `run_project`
    runs one by name, its default without. The coordinator is asked, in the
    project's conversation, when the person picks "Ask the coordinator".
  - **Kept in the store** (`runnables`, migration 0032): dropping one keeps its
    row, as a note's does. A change to the list changes the project, so every
    screen that shows what it runs reads it again.
- **Alternatives considered:**
  - **A Runs panel made like Settings,** each runnable a round switch opening
    out to its output. Native, and the richest at a glance; but two controls
    in the bar, and the default a click further.
  - **Chips in the bar, each its own toggle.** Shows best that there are many,
    but runs out of room past four, sooner in a task's bar.
  - **A launcher on ⌘R over every runnable and script, the list kept in
    project settings.** Fast from the keyboard, but what runs is hidden.
  - **A dock beside the work with each run's output.** Takes a column the
    board's dock already wants.
  - **A launch file in the repository** (ADR-023's alternative) stays an
    alternative: the list is Althar's, and can be written there later.
  - **The default as a flag of its own.** First in the list says it with the
    order the person already sets.
- **Trade-off:**
  - **Two runs of the same repository may want the same port.** The second
    says so in what it prints, as ADR-023's runs of a task and of the default
    branch already could.
  - **One that answers nowhere** (an app's window, a watcher) is taken as
    starting for ten seconds, then as running with no address.
  - **No run is pinned to the default branch from a task:** a task's runs are
    in its worktree.
  - **Output is in the Running pill and the run's card, not the list.**
- **Revisit when:**
  - A project needs things that run together, as one.
  - A run needs to stay on the default branch from a task, or its own setup.
  - A run's output needs reading where it is started.
