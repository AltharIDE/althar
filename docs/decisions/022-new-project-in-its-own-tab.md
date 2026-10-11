# ADR-022: A new project is made in a tab of its own, under the id the window gave it

- **Status:** Accepted
- **Date:** 2026-10-11
- **Owner:** Repository maintainers
- **Context:** Once there were projects, adding one meant the system's
  folder picker straight away: the folder became the project, named after
  it, and a folder of several repositories opened a form for which to keep.
  People think of a project as a body of work first, and its folders
  second, often several from different places. A project's mark is drawn
  from its id, which the runtime made as the project was, so any mark shown
  while the project was being named would have changed the moment it was
  made. Its colour was the runtime's pick, never the person's.
- **Decision:**
  - **A new project has a tab of its own,** beside the projects' tabs, from
    the tabs' +, the home's projects, ⌘N, or folders dropped on the home. It
    is named first; its folders come after, from the system's picker
    (several at once), dropped, or one press from the repositories found
    where people keep code, those named like it first. Each is read as it is
    added, and what reading them found is said before anything is made.
    The first project stays the first screen's.
  - **The window makes the project's id** (`proj_` and a UUIDv7, as the
    runtime makes them) as the tab opens, and draws the mark from it while
    the project is named. `OpenProject` takes it, with the ink the person
    saw; the runtime checks its shape at the boundary and refuses one any
    project has had. Without them, a project is made as before.
  - **The runtime's pick of ink is shared** (`inkFor`, in the contracts), so
    the window shows it before the project exists, and sends it.
  - **A project made on purpose is new** even where its first folder is
    another project's already; that folder stays the other project's to
    find when it is opened. Repositories may be in several projects (01).
  - **The draft is the window's, for this launch:** the same whichever tab
    the person goes to meanwhile, never stored. Closing its tab, or Escape,
    makes nothing; made, its tab becomes the project's.
- **Alternatives considered:**
  - **A sheet over the home, or a panel from the +** (the prototypes' B1
    and B3). Both work, but leave no room to read several folders and what
    they say, and take the person away from where they were.
  - **The mark drawn from the name while typing.** It would change on every
    rename, and the mark is meant to be learnt by sight.
  - **A runtime command that reserves an id.** A round trip before the tab
    can draw anything, and reservations left behind by tabs that closed.
  - **Keeping the picker first and naming after.** It is what people found
    backwards: the folder decided the project.
- **Trade-off:**
  - **Clients now propose a project's id.** The runtime still decides:
    it checks the shape and that the id is free, in the same transaction as
    the project, and a retry under the same command id is answered from its
    receipt. Other ids stay the runtime's.
  - **A folder inside a repository** (one package of a monorepo) can't be
    one of several folders here; the first screen still makes a project of
    one, and the new tab says to add the repository itself.
  - **What reading found is only what the window can tell from a remote**:
    the code host and whether it is connected. Branches naming tracker
    issues aren't read yet.
- **Revisit when:**
  - Projects are shared across devices or people: whether a client-made id
    still holds, and how two windows making the same project meet.
  - A project can be made without any repository, or of clones made on
    purpose (01's deliberate path).
