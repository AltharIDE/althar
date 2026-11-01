# ADR-085: A fork's branches go upstream by a choice of the project's, offered on what its host says

- **Status:** Accepted
- **Date:** 2026-11-01
- **Owner:** Repository maintainers
- **Context:** Althar knows a fork from its clone's remotes (`forkOf`: an
  `upstream` beside `origin` on the same host), and its tasks' branches always
  went to the fork. The project could choose only where the pull requests
  open. Someone who forks a repository often gets invited to it later, as
  ninemate was to AltharIDE/althar, and from then on works through a fork
  they no longer need. The only way out was renaming git remotes by hand, and
  a pull request already open from the fork then had nowhere clear to go: its
  next commits could land on a new branch upstream, beside it.
- **Decision:**
  - **Where a fork's work goes is a choice per project,** with a third answer
    beside pull requests upstream and pull requests on the fork: branches and
    pull requests both on the repository it was forked from
    (`change_target = 'upstream_branch'`).
  - **It is offered on what the host says.** The host's own answer about the
    signed-in account (`Repository.canPush`) decides, asked as a project's
    repositories are read and kept a few minutes, not by a new polling loop,
    and asked again the moment it is chosen. Without access the choice isn't
    offered and the setting says so plainly. If access goes later, publishing
    falls back to the fork, and the map draws what actually happens.
  - **The offer is made once.** When the host first says the person can push
    there, the project's room and its settings ask. Taking it or saying not
    now is recorded (`upstream_offer_at`), and it isn't asked again, whatever
    they switch to later; the choice stays in the project's settings.
  - **Remotes are never rewritten.** `origin` and `upstream` stay as they are,
    the setting is Althar's alone, and switching back is one choice.
  - **An open pull request stays where its branch is.** Its commits go to the
    repository the host last said its branch is on, whatever the project says
    now, until it closes. Only tasks without an open pull request, and new
    ones, follow the setting, so no commit lands on a stray branch. Where the
    host says its fork is gone, or doesn't say where its branch is and no
    branch of that name is where the clone's remotes would send it, nothing is
    pushed and the person is told why.
  - **A clone whose remotes were renamed by hand just works.** With `origin`
    the repository it came from and `fork` the fork, it is a normal project:
    new work goes to `origin`, not to whichever remote sorts first, and pull
    requests open from the fork keep taking their commits there.
  - **The default branch stays out of reach, whatever the target** (ADR-016,
    ADR-071): publishing refuses a task branch named as the default branch of
    the repository it would push to, and never forces.
- **Alternatives considered:**
  - **Rewriting the remotes when the person accepts:** the clone is theirs, and
    their own git, scripts and other tools read those names. It also couldn't
    be undone cleanly.
  - **Moving open pull requests to the new target:** a host can't change a
    pull request's source repository, so it would mean closing and reopening
    them, losing their reviews.
  - **Trying the push and reading the refusal:** it finds out late, on a task's
    branch, and can't make an offer.
  - **A new polling loop for access:** reading it where repositories are
    already read notices soon enough, and costs at most one request per fork
    every few minutes.
- **Trade-off:**
  - Reading a fork's repositories now asks its host, waiting at most five
    seconds and reading on without an answer.
  - The access can be a few minutes old where it is only shown, though never
    where it is chosen or published.
  - A task keeps each pull request's own place in its snapshot, so an older
    snapshot without one asks the host once.
- **Revisit when:**
  - A host offers notice of a change of access: the offer can come from that
    rather than from a read.
  - A person wants branches upstream and pull requests elsewhere: the three
    answers would become two separate choices.
