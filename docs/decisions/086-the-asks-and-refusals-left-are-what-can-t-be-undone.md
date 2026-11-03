# ADR-086: The asks and refusals left once the sandbox is the boundary are what can't be undone

- **Status:** Accepted
- **Date:** 2026-11-03
- **Amends:** [ADR-067](067-allow-everything-asks-only-before-what-can-t-be-undone.md),
  [ADR-071](071-the-sandbox-is-the-boundary-anything-inside-it-runs.md)
- **Owner:** Repository maintainers
- **Context:** ADR-071 let what a sandbox holds run unread. An audit of the
  limits leads and the coordinator still met (DEV-185, 31 Oct) found the
  rest. The person allowed all 182 asks ever made, 77 of them from 27 to 30
  Oct. Of what was left, some asks were misreads, some were of what can be
  undone, and some refusals agents worked around in the same turn. The
  person's direction (29 Oct): Althar is permissive by default. Where an OS
  sandbox holds, what it holds runs unread. Only crossings that can't be
  undone ask (ADR-067's list). Never rules and unreadable keys still hold. A
  kind of ask or refusal that agents keep working around is dropped.
- **Decision:** each item, as decided:
  - **Git's guard reads only the task's repositories.** All 5 "push to
    main" asks on 31 Oct were scratch repositories a lead made in its temp
    folder. The guard now acts only on a repository whose git folder is one
    of the task's (`repositories`, `pushGuard.ts`), or a push to one of
    their remotes from anywhere. Git hands `reference-transaction` no old
    value for `branch -d` or `branch -f`, so the guard now reads what the
    branch points at until the change commits. It stops a deletion or a
    move only where its commits are on no other ref.
  - **An automation's run reads only what its guard can't stop.** An
    automation's run never allows a push to the default branch
    (`automated.ts`). With no one to ask, ADR-071 refused any line the rules
    couldn't read wherever Never listed anything. Where git's guard holds
    (`RuleContext.guarded`: every lead but on Windows), a Never of only what
    the guard stops (a push to the default branch, a force push, deleting
    another branch) no longer refuses what it can't read. A Never of a
    deploy or a named command still does, and so does every Never where no
    guard holds.
  - **What a lead asks to run outside goes ahead unread, with everything
    allowed** (`decideLeaving` removed). ADR-071 refused it, saying to run it
    inside or as plain commands. Leads worked around that refusal, and on
    macOS Electron and Chromium can't start inside the sandbox at all, so an
    end-to-end run has to cross. The issue proposed asking instead. The
    person's note of 29 Oct goes further: with everything allowed, what
    Althar can't read goes ahead unasked, and only what the rules read as
    irreversible asks. A crossing now meets the rules as any request does
    (`decide`). The rules still read what they can: `node scripts/e2e.ts &&
    git push origin main` asks. Git's guard stops a script's push to the
    default branch, outside the sandbox too. What a script outside writes to
    the person's checkout is left open, as ADR-071's trade-off already left
    it for what the project runs outside from the start.
  - **The coordinator's readers' list**, for agents whose sandbox Althar
    doesn't hold (Codex, OpenCode, a review's lead), takes `awk` (unless its
    program runs `system()`, pipes to or from a command, prints to a file, or
    `-f` loads one), `seq`, `[[ ]]` (not its numeric comparisons, which work
    out a subscript), `${x:-word}` and `${x:+word}` with a plain word, and
    `git branch`'s `--format`, `--sort`, `--points-at` and `--column`.
  - **`git branch -d` goes.** Git refuses it for a branch whose work isn't
    merged. Only `-D`, or `-d` with `--force`, can lose commits, and those
    ask.
  - **A line is read from where the lead's shell is.** Most cards for
    deleting outside the worktree, and all 7 for "another checkout", were
    relative paths read from the worktree's top when the lead had `cd`'d
    into `packages/ui`. Claude Code writes its shell's folder on every
    entry of its session's transcript (`cwd`). Althar reads the newest
    (`claudeShellFolder`, `provider-adapters/src/shellFolder.ts`) and the
    rules start the line there (`RuleContext.shell`). They believe it only
    where it is in the task's worktree or a temp folder. Otherwise, and for
    agents that keep no such record, the line is read from the top, as
    before.
  - **A lead may pop or drop its own stash entry.** Git names an entry by
    the branch it was stashed on (`On althar/retry: …`, `WIP on
    althar/retry: …`). An entry on the task's branch, picked by its place
    (`stash@{n}`, `n`, or the newest where none is named), goes. Another's,
    one named by a hash, and `git stash clear` still ask, since every
    checkout shares the stash. The issue's "tagged as the brief tells it"
    became the branch name git already writes, so no brief needs to say
    anything. **Turned down:** `git reflog expire` and `git gc --prune`
    still ask. They throw away what git keeps to recover lost work, for
    every checkout, and nothing marks what is the task's.
  - **`push_to_pull_request` hands the lead the steps** where someone pushed
    to the branch elsewhere: call `fetch_from_remote` with the pull request,
    merge what it got, and push again. It used to end in "Tell the person".
  - **`security` reads what holds no secret.** `find-identity`,
    `find-certificate`, `list-keychains` (not `-s`), `show-keychain-info`,
    `verify-cert`, `cms` (not `-S`, which signs), `error` and `help` go, as
    a build does to find its signing identity. Every other subcommand, or an
    option before it, may read a password or a key or change the keychain,
    and is refused as before.
  - **Tearing down, deleting and publishing ask, even with everything
    allowed** (ADR-067's `irreversible`). These are: `destroy` (`cdk`,
    `terraform`, `tofu`, `pulumi`, `fly`), `terraform apply -destroy`,
    `kubectl delete`, `helm uninstall`, `wrangler delete`, `vercel remove`,
    `netlify sites:delete`, and publishing a package (`npm`, `bun`, `pnpm`,
    `yarn`, `cargo`, `gem`, `twine`, `poetry`), whose version a registry
    never takes again. A dry run doesn't ask. A deploy still goes ahead
    with everything allowed, as ADR-067 decided: the next deploy replaces
    it. Being irreversible, these go to the person without the coordinator's
    judgment.
  - **The coordinator's brief** no longer says a task's lead can't fetch a
    branch. #504 had already removed that line before this work started.
- **Not done here: the keychain.** ADR-071's open trade-off stands.
  Patching the Claude Code that Althar bundles so its sandbox denies the
  keychain's service is the person's decision and hasn't been tried. A
  check of this repository (3 Nov) found that only the release workflow
  touches a keychain. It makes its own on CI and signs from it. Leads'
  builds, unit tests and end-to-end runs don't use the keychain. A project
  that signs locally (an iOS or Mac app's `xcodebuild`, `codesign`) does
  need it, and denying the service would break `security find-identity`
  there too.
- **Alternatives considered:**
  - **Asking for an unreadable crossing**, as DEV-185 proposed. Under
    everything allowed, that brings back the cards ADR-071 counted. The
    person allowed every one of them, and they asked for none.
  - **Telling leads to `cd` back to the top before each command.** That
    reads words, not where the shell is, and agents don't keep to it.
  - **A stash tag written in the brief.** Git already names the branch in
    every entry, and an agent that forgets a tag would be asked again.
- **Trade-off:** reading the shell's folder from the transcript trusts a
  file the agent's own process writes. A lead that wrote a false `cwd`
  there could have a relative path read from another folder of its worktree
  or temp folder, never from beyond them. With everything allowed, a script
  run outside unread can write anywhere the person's account can, as ADR-071
  already left open for what the project runs outside from the start.
- **Revisit when:** a lead loses work through a crossing that went ahead
  unread, or through a stash entry or branch it took as its own; Claude
  Code stops writing `cwd` to its transcript; the keychain decision is made.
