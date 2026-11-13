# Working in this repository as an agent

[DEVELOPMENT.md](DEVELOPMENT.md) says how to set up, check and test. Before you finish a task, show that it works: [Showing a change works](DEVELOPMENT.md#showing-a-change-works) says how to screenshot a component's story or the desktop app, headless, and where the shots go.

Before UI, copy or site work, read [DESIGN.md](DESIGN.md).

Run only what is cheap and fast: the checks and unit tests of the packages you changed and of those that build on them, with few workers (Vitest's `--maxWorkers=1`), and an end-to-end spec only when your change is what it covers (`bun run test:e2e e2e/that.spec.ts`, one worker already). Don't run the full suites, coverage or the desktop app's whole end-to-end run: the pull request runs the checks and the unit tests your change reaches, and the end-to-end run when it reaches the app, the merge queue runs them again, and everything, Windows' tests, coverage and packaging too, runs after merge on main ([Changes and CI](DEVELOPMENT.md#changes-and-ci)). Althar tells you when one fails. Other agents share this computer.

Open your pull request as a draft while you're still pushing to it, and mark it ready for review (`gh pr ready`) when it's done: a draft runs only its checks and unit tests, and each push to a ready one runs the end-to-end runs and the stress run of its changed tests too.

## Git identity

Use `Balázs <balazs@otakomaiya.com>` for agent-created commits in this repository. The GitHub account is `balazsotakomaiya`.

Before creating commits, set the repository-local identity explicitly; the inherited global Git identity may belong to another account:

```sh
git config --local user.name 'Balázs'
git config --local user.email 'balazs@otakomaiya.com'
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
```

Verify that both resolved identities match the approved identity, including any environment overrides. Before pushing or merging, inspect the author, committer and `Co-authored-by` trailers of every outgoing commit. Correct an unwanted account attribution before publishing; authentication to the correct GitHub account does not set Git authorship.
