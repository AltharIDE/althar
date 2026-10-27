# ADR-062: Althar runs any branch or pull request, and fetches for leads

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owner:** Repository maintainers
- **Context:** A person asked their coordinator to "start the app's feature
  branch that adds a services directory (not pulled yet)". `run_project`
  (ADR-023, ADR-044) ran a fresh copy of the default branch or a task's
  worktree, nothing else, so the coordinator started a task. Its lead carried
  none of the person's sign-ins (ADR-011: credential helpers reset, `gh`
  signed out, no SSH agent), so `git fetch` failed in its sandbox and out of
  it; it had no way to ask Althar, so it used a stale `origin/<branch>` and
  told the person to fetch it themselves. Setting the branch's upstream wrote
  `.git/config`, which its sandbox refused, leaving the worktree detached. It
  never ran the app. The person got a task card and a report instead of the
  branch running.
- **Decision:** Althar fetches, with its own sign-in, whatever a run or a lead
  needs from the code host; credentials never leave it.
  - **A run of a branch or a pull request** (`run_project`'s `branch` and
    `pull_request`, the `RunProject` call's `branch` and `pullRequest`):
    Althar fetches it into the person's repository (`Fetches.ts`), through
    the connection to its host where there is one (`http.extraHeader`, as
    pushes go), else through git's own way to the remote. It then makes a
    copy of its own, detached at the commit it got, as the default branch's
    copy is made (`copyAt`), under the project's folder in `.runs/<run>`, and
    runs the runnable asked for there, or the first of that repository's
    that says how it runs. There is no task, no agent and no local branch,
    and the person's checkout is untouched. The copy goes as the run does:
    stopped, ended by itself, or left by an earlier launch, removed as
    Althar starts. One already running is the one returned.
  - **A pull request** is fetched by its own branch where it is the
    repository's, into `origin/<branch>`, and otherwise, as a fork's is, from
    the host's ref for it (`refs/pull/N/head`, `refs/merge-requests/N/head`)
    into `refs/althar/pull/N`. A fork's repository asks `upstream`.
  - **An unknown branch is refused** with the names like it; the run says the
    commit it got, and its pill and card name the branch (`PR #12 ·
    feature/x`). Run again from its card, it fetches what was asked for
    afresh.
  - **The Run menu has "Run a branch or pull request…"** on the project:
    a picker of the remote's open pull requests (first, by title and number)
    and its branches, asked of the remote as it opens. A number typed that
    the list doesn't have runs that pull request still.
  - **A lead asks Althar to fetch** (`fetch_from_remote`: a branch, a tag or
    a pull request) into its task's repository, whose refs its worktree
    shares. Althar says the commit it got. It never pushes, never moves a
    branch of the lead's, and never hands over a credential. The lead's
    instructions say to use it when a fetch fails for credentials, rather
    than retrying outside the sandbox or asking the person.
  - **A branch an agent makes from a remote's follows nothing**
    (`branch.autoSetupMerge=false` in `withoutSignIns`): `git switch -c x
    origin/x` then never writes `.git/config`, which an agent's sandbox
    refuses.
- **Alternatives considered:**
  - **Hand the lead a short-lived token.** It would fetch as it likes, but
    the token is then in a process Althar doesn't control, readable by what
    the lead runs, and it can push. ADR-011's line is that credentials stay
    in Althar.
  - **Run the branch in a task's worktree.** Reuses what exists, but makes a
    task, a local branch and an agent for what is only a look, and puts a
    card on the board that the person must settle.
  - **Check the branch out in the person's own checkout.** No copy to make,
    but it moves the person's work under them, and fails where they have
    changes.
  - **A worktree (`git worktree add`) for each run.** Writes the person's
    `.git/worktrees`, which outlives a crash; the copy, which borrows their
    objects, leaves nothing in their repository but the refs it fetched.
- **Trade-off:** each branch run makes a copy and fetches before it starts, a
  few seconds more than the default branch's shared copy, and installs its
  setup afresh. Fetching updates the person's `origin/<branch>` and adds
  `refs/althar/pull/N`, as `git fetch` would. Without a connection to the
  host, the picker lists branches but no pull requests, and says so.
- **Revisit when:** a run should follow a branch as it is pushed to; a
  host keeps no ref for a fork's pull request (Bitbucket); or the copies of
  several branches running at once cost too much disk.
