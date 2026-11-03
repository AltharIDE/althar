# ADR-070: Run opens its list, and runs where it is picked

- **Status:** Accepted
- **Date:** 2026-11-03
- **Owner:** Repository maintainers
- **Context:** ADR-044 made Run a split button whose one press ran the
  default; ADR-066 added running a branch or pull request from a modal under
  its chevron, in a copy of its own. In use, the person found the whole thing
  broken, worst around branches. What ran, and from where, was said in three
  places: the button (only the default), the Running pill over the
  project's composer (everything, each place in words), and the run's card.
  The button's checklist said "running in main" for a task's run. A branch
  run left the dialog the moment it started, and showed only in the pill.
  Fetching showed only in the dialog. A failure to start showed only as
  "Ran" on the pill. Once something ran, the button said its name and address
  instead of Run, so it no longer read as the way to run things. In a
  large project, one press assumed the most common thing was what the person
  wanted. Four directions were prototyped on the real app (where the place is
  picked: in the list, beside Run, or as a grid of places by what runs). The
  person picked a place beside Run, with every Run a dropdown and no running
  marks on the place.
- **Decision:**
  - **A press on Run only opens its list.** Nothing runs until a line is
    picked, the first in the person's order included. The button always
    says **Run**; after it, short and behind a thin rule, how many failed
    (red), else how many run, else a spinner while one starts or fetches.
  - **Each line keeps its state in place.** At rest: Run. Starting or
    fetching: it says so. Running: where it answers, which opens it, how
    long it has run, and Stop. Ended by itself, not well: "Exited 1" in red,
    with Run again and Clear. Couldn't be fetched: why, with Try again and
    Clear. What runs comes first, in an order fixed as the list opens, so
    nothing moves under the pointer. A list longer than eight opens on a
    field to find in: the arrows move, and Enter runs, opens or tries again.
    Adding something to run and editing the list sit at its foot.
  - **In a task, Run is the task's:** what runs in its worktree. There is
    nowhere to pick. The chip over the task's composer keeps what its lead
    left running, why it waits and what it listens to. Althar's own runs of
    the task are Run's to say.
  - **On the project, where Run runs is picked beside it,** as a branch
    switcher is: the default branch, a task's worktree (a task under way
    with a branch, not a review), or a pull request or branch the remote
    has. The remote is asked as the switcher opens, and a pull request's
    number typed that it didn't list is still offered. It stays picked, kept
    per project on this Mac, until another place is picked, or its task is
    gone with nothing of it running. The chip itself says only the place.
    In its list, each place quietly names what runs there, and what failed
    in red, so a run left going is found where it runs.
  - **A branch or pull request is fetched as something runs on it,** not
    as it is picked (ADR-066 otherwise holds: a copy of its own, no task).
    The line says Fetching… until it runs; what went wrong stays on the line.
  - **Nothing over the project's composer says what runs.** The Running pill
    there is gone; the run's card in the thread stays.
  - **The list's first is still its default:** what `run_project` runs with
    no name, and first in Run's list.
- **Alternatives considered:**
  - **The place at the head of Run's list** ("Run on main ▾"). One control in
    the bar, but the place is hidden until the list opens, and changing it
    is two levels deep.
  - **Every place at once,** a grid of places by what each runs, every cell
    one press. Shows everything, but it is heavy for the common case of one
    place, and wide.
  - **Keeping one press for the default.** Fast for a small project, but it
    guesses what the person wants. In a project with twenty or thirty things
    to run, the guess is often wrong.
  - **Marks on the place for what runs elsewhere.** The person found they
    said nothing worth the room. The switcher's list says it where it
    matters.
- **Consequences:**
  - The default is one click further than it was.
  - A run on another place shows only in the switcher's list, not on the
    bar. A failure there is red in that list.
  - A pull request's run is matched to its place by the number in what it
    was fetched as (PR #12 · feature/x). A branch's is matched by its name.
  - `RunBranch`, the modal, is gone from the kit; `RunPlacePicker` replaces
    it, and `RunButton` is a popover rather than a split button.
