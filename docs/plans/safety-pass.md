# Safety pass: what agents do unasked

> **Temporary.** The findings of DEV-69, a code-level audit of what an agent
> can do on someone else's computer without them asking, and what changed
> because of it. Not architecture: move what lasts into the ADRs and
> [03](../architecture/03-agent-runtime-and-auth.md), and delete this once
> the open rows below are settled.

Done on 15 October 2026, on `main` at #214, without real agents: each case is
traced through the code that decides it, and the fixes are covered by unit
tests. What needs a real Claude Code or Codex session to confirm is listed at
the end.

## The aim

Strangers will point Althar at work they care about. One destroyed branch or
deleted folder ends their trial. So: **anything that destroys work, or leaves
the machine, without the person asking is refused by default or asked about,
whatever the coordinator would decide.**

## What decides

A request passes four layers, and only the last two are Althar's:

1. **The agent's own sandbox and mode.** Claude Code starts in `default`
   with ask rules for Bash, Edit, Write, MultiEdit, NotebookEdit and
   WebFetch, and its sandbox on with `autoAllowBashIfSandboxed` and
   `allowUnsandboxedCommands` (`provider-adapters/src/registry.ts:403-421`).
   A command the sandbox contains runs without asking; the sandbox lets
   writes into the worktree and into the main repository's `.git` (but its
   hooks and config), reads anywhere, and no network but localhost. Codex runs
   in `workspace-write` (`registry.ts:566`): it edits and runs commands in
   the workspace, reads anywhere, has no network, and asks to go beyond.
   OpenCode has no sandbox, and every edit, command and fetch asks
   (`registry.ts:325`, `630`).
2. **The agent's environment.** An allowlist of variables, without the SSH
   agent (`provider-adapters/src/process.ts:27`); `gh` and `glab` signed
   out, git's credential helpers reset, no terminal prompt
   (`runtime/src/Config.ts:235`). An unencrypted key in `~/.ssh`, or one
   ssh unlocks from the macOS keychain, still lets `git push` over SSH sign
   in.
3. **The rules** (`runtime/src/rules.ts`, `decide`), for what reaches
   Althar as a permission request: what no project can change, then Never,
   then Allow everything, then the always-ask list, then allow rules, then
   the coordinator's judgment, then the person.
4. **The coordinator's judgment** (ADR-019, `PermissionJudge.ts`), only in a
   project where the coordinator decides, only for what no rule answers.

The default rules are the MVP's (`rules.ts`, `MVP_RULES`): every kind on
the always-ask list, everything else allowed. Allow everything is a switch
for a project or a task (ADR-043, `Permissions.ts:293-301`) that turned the
mode to `allow`: everything short of Never and what no project can change.

## Findings

"Default" is a new project's rules; "Allow everything" is the switch on.
Line numbers are `main` before this change unless they say otherwise.

| Case | Default, today | Allow everything, today | Evidence | Verdict | Fix or recommendation |
| --- | --- | --- | --- | --- | --- |
| An agent's edit tool writing outside the worktree | Waits for the person (`outside`) | Allowed | `rules.ts:1059-1068`, `1114-1123` | Fine: a write is what allowing everything is for | Kept. A **delete or move** by the agent's tool outside the worktree now asks even with everything allowed |
| A shell command deleting outside the worktree (`rm -rf ~/code/app`, `rm -rf ~`) | Claude Code's and Codex's sandboxes block it; a retry outside the sandbox reaches Althar, whose rules read `rm`'s operands: waits for the person | **Allowed** | `rules.ts:853-880`, `1114-1123` | Gap | **Fixed**: deleting or moving away outside the worktree asks whatever the mode (`rm`, `rmdir`, `unlink`, `shred`, `rimraf`, `trash`, `mv`'s sources, every operand where `-t` names the folder, `find -delete` and `-exec rm`, `rsync --delete` and `--remove-source-files`) |
| A shell command or the agent's edit overwriting outside the worktree (`cp x ~/code/app/main.ts`, `> file`, an Edit there) | Waits for the person | Allowed | as above | Gap where it's a git checkout: what isn't committed there is nowhere else, as `git checkout -- .` there already counted | **Decided and fixed**: replacing a file that's there, in another git checkout (the person's, another task's), asks whatever the mode: an edit, a `>` redirect, where a copy or move goes, `tee`, `truncate`, `sed -i`, `dd of=`, `Set-Content`, `Out-File`; a copy or move into a folder there, by what lands on it (`cp main.ts ~/code/app`, `-t`, `cp -r src/. ~/code/app`, rsync's `src/`); and an edit of many files, whichever of them is there. Adding a file there, appending (`>>`, `tee -a`, `Add-Content`), and writes anywhere else outside (`~/Desktop`, dotfiles) still go ahead with everything allowed: that's what the switch is for. **Open for the person**: whether overwriting a file outside any checkout (a dotfile, a document) should ask too |
| A script writing outside (`node scripts/clean.js`) | Sandboxed: blocked; unsandboxed: the rules read only the words, so allowed | Allowed | `rules.ts:21-28` | Known limit (ADR-013's sandbox gap) | Recommendation: OpenCode in the same sandbox runtime as Claude Code (03 says it's next) |
| `git push --force` | Waits for the person | **Allowed**, pushed with the person's SSH key where one signs in | `rules.ts:703-704`, `1114-1123` | Gap | **Fixed**: asks even with everything allowed; the coordinator never judges it |
| Pushing to the default branch, or deleting it | Waits for the person | **Allowed** | `rules.ts:753-756` | Gap | **Fixed**, as above |
| Deleting remote branches (`push --delete`, `:branch`, `--prune`) | Waits for the person | **Allowed** | `rules.ts:708-709`, `751-756` | Gap | **Fixed**, as above. `--mirror` counted only as many branches; it now counts as a force push and a deletion too |
| **Deleting a local branch** (`git branch -D feature`, `update-ref -d`, `branch -f`, `-M`, `checkout -B`, `switch -C`) | **Allowed**: no kind; in Claude Code's sandbox it runs without asking at all | **Allowed** | `rules.ts:913-926` (only `push` is read); `registry.ts:387-391` | **Severe**: a worktree shares the person's branches, so this deletes or moves *their* branch, unpushed commits and all | **Fixed** in the rules: deleting, or moving, renaming or resetting by force, a branch that isn't the task's is `delete-branch`, and asks whatever the mode; `update-ref --stdin`, whose refs come in on its input, asks whatever the mode as what the rules can't tell. **Open**: what Claude Code's sandbox runs without asking never reaches the rules (below) |
| `reset --hard`, `clean -fdx`, `checkout -- .`, `restore`, `stash` in the person's own checkout | `git -C <checkout>` or `cd <checkout> && git …` is "git in another folder": waits for the person | **Allowed** | `rules.ts:913-917` | Gap | **Fixed**: git that throws away work in another checkout asks whatever the mode; there a `checkout` counts unless it only switches to a branch, by a name that can't be a file there (`checkout README.md` counts) |
| Shared repository state from inside the worktree: `git stash clear`, `stash drop`, `stash pop`, `reflog expire`, `gc --prune=now`, `prune` | **Allowed**; runs without asking in Claude Code's sandbox | **Allowed** | `rules.ts:913-926` | Gap: every checkout shares the stash and the reflog, and `stash@{0}` is whoever stashed last, the person or another task | **Fixed** in the rules (`outside`, asks whatever the mode); `git stash` and `stash apply` keep every entry and go ahead. Same sandbox caveat |
| A delete or git command whose target shows only when it runs (`… \| xargs rm -rf`, `rm -rf $DIR`, `"$(…)"/dist`, `git push origin $BRANCH`, `eval rm …`, `cd "$DIR" && git reset --hard`), or in a loop, a branch or a subshell (`do rm …`, `then rm …`, `(rm …)`, `{ rm …; }`) | Allowed: `xargs`'s input and a variable read as a name in the worktree; a command after `do`, `then` or `(` wasn't read at all | **Allowed** | `rules.ts` (`expandShells`, `unwrap`) | Gap, found in review | **Fixed**: what `xargs` and `eval` run is read as a command, git included (`eval git stash drop`); shell keywords and a subshell's parentheses are taken off, however they're spaced (`( rm … )`); a `cd` inside `( … )`, a script handed to a shell, a backgrounded command or a pipe's side holds only there (a pipe's last side is read from both folders, as zsh keeps its `cd` and bash doesn't); a `cd` the shell may skip or that may fail (after `&&` or `||`, in an `if`, a loop, a `case` or a function, to a folder that isn't there) leaves what follows read from every folder it could be in, `cd -` and `popd` from any it's been in, and a function's or an alias's `cd` from wherever it's called; what a function's body or a `case`'s branch runs is read too; the secret check follows `cd` the same way; a command whose target shows only when it runs is read again with it standing for the root of the disk and for the default branch, and after a `cd` to such a folder what follows is read from the root, and where that could lose work, it asks whatever the mode, as what the rules can't tell. `$HOME`, `$TMPDIR` and `$PWD` are read as what they are. **Limit**: `find … \| xargs rm` asks too, as the rules don't follow a pipe |
| `reset --hard` or `clean -fdx` in the task's own worktree | Allowed | Allowed | | Fine: the task's own work, which the record and its branch keep | None |
| Rewriting already-pushed history | An agent's force push: as above. Althar's own: only when the person presses Push on a rewritten branch, with `--force-with-lease`, never where Never lists force pushes | same | `Changes.ts:1458-1475`, `git.ts:485-510` | Fine for Althar's own; agents' covered by the force-push row | None |
| Tags (#212): `push_tag` and `git push --tags` | Waits for the person (`many-branches`, held) | **Allowed**: Althar pushes the tag with the person's own git | `Changes.ts:1849-1905`, `rules.ts:706-707` | As designed in #212 and ADR-043, but a tag often starts a release | **Recommendation** (debatable, not built): count a tag as something that leaves the machine for good, and ask even with everything allowed, or give tags a kind of their own |
| A tag pushed by its bare name (`git push origin v1.0.0`) | Read as a push to a branch named `v1.0.0`: **allowed**, and goes up where an SSH key signs in | Allowed | `rules.ts:729-751`; #212's "Not in this PR" | Gap, open: the words alone can't tell a tag from a branch | Recommendation: have `Permissions.ts` look the name up in the worktree (`refs/tags/…`) before deciding, as it does the current branch |
| Deploying and publishing | Waits for the person | Allowed | `rules.ts:768-813` | As designed (ADR-043's own example) | None |
| Reading the keychain or git's credential helpers | Refused, every role | Refused | `rules.ts:182-191` | Fine | None |
| **Reading key and sign-in files** (`~/.ssh/id_*`, `~/.aws/credentials`, `~/.npmrc`, `~/.config/gh/hosts.yml`, `~/.kube/config`) | **Allowed** where it reaches Althar; the coordinator, a reader, "may read anything"; in both sandboxes a `cat` runs without asking | **Allowed** | `rules.ts:170-175`, `1897-1903`; `docs/open-questions.md` ("A sandbox for agents' shells") | **Severe**: ADR-013 says no project can let agents read credentials, and only the keychain was covered | **Fixed**: a request that names one of these places (a path, a command's word, `@file`, `--key=file`, inside quotes or `$(…)`, after a `cd`, through a symlink in the worktree to a file not there yet, from the folder a reader works in, in any case on Windows and macOS, whose disks don't tell `~/.SSH` from `~/.ssh`; and a `cd` into one of them, wherever it starts, since there a key's bare name is enough) is refused for every role, whatever the mode. Claude Code sessions are given the same places as denied reads, which its documentation says its sandbox applies to shell commands too (to verify). **Open**: Codex's sandbox reads anywhere, and a command that finds a file itself (`grep -r token ~`) names none |
| `.env` files | None in a worktree (not copied, ADR-006). The person's checkout's: **allowed** to read | **Allowed** | `rules.ts:1059-1070` | Gap | **Fixed**: reading a `.env` outside the task's worktree asks whatever the mode (`.env.example` and the like don't). A `.env` in the worktree is the task's |
| Sending things off the machine (`curl -d @file`, `scp`, a web fetch with data in its URL) | Allowed where it reaches Althar: no rule reads the network. Claude Code's sandbox asks per host, and Althar allows it | Allowed | `rules.ts:1073`, `1124-1139`; `registry.ts:387-398` | **Gap, open** | Partly: uploading a key file is refused (above), and the judge is told to ask before any upload. **Recommendation**: a network rule, hosts beyond package registries asking, or a host allowlist in the agents' sandboxes (ADR-007 and ADR-019 both say "when network policy arrives") |
| Global installs (`npm i -g`, `brew install`, `pip install --user`, `cargo install`, `apt-get install`) | Sandboxed: the write fails; the retry reaches Althar and was **allowed** (no kind) | Allowed | `rules.ts:853-880` | Gap | **Fixed**: counted as writing outside the worktree, so it waits for the person by default; allowed with everything allowed. **Open**: `curl … \| sh` installers aren't read as installs |
| Network beyond package registries | As "sending things off the machine" | | | Open | As above |
| The judge (coordinator decides) | Never sees what always asks, or what the rules can't tell. Judges everything else that isn't routine, including a force push or `rm -rf` outside where the person moved that kind to "The rest". Its prompt: "Allow reasonable task work" | Not asked | `rules.ts:1144`, `PermissionJudge.ts:97-106` | Gap: no floor under the judge but Never and the keychain | **Fixed**: what could lose work goes to the person, not the judge, unless the person always allows its kind; the prompt now says never to allow losing work, reading secrets or uploading |
| A hard floor | Only the keychain and git's helpers, changing the code host, `flatpak-spawn`, and Never | same | `rules.ts:1101-1108` | Gap | **Fixed**: the floor below |
| Claude Code hooks in the person's or the repository's settings | Run as code on every tool call | same | `registry.ts:528-531` (`knownGaps`) | Known | Recommendation: `disableAllHooks` for leads too, or a setting for it, as review leads have |

### The floor, as built

`Kept.floor` in `rules.ts` marks what could lose work or a secret:

- a force push (and `--mirror`); a push to, or deletion of, the default
  branch; deleting a remote branch that isn't the task's; a push the rules
  can't read;
- deleting, or moving, renaming or resetting by force, a local branch that
  isn't the task's;
- clearing the stash, dropping or popping an entry of it, `reflog expire`,
  `gc --prune=now`, `prune`;
- git that throws away work in another checkout, and replacing a file that's
  there in one;
- a delete or git command whose target shows only when it runs, where it
  could be one of these;
- deleting or moving away anything outside the task's worktree (a shell
  command, or the agent's own delete and move tools), and removing a
  worktree that isn't the task's;
- reading a `.env` outside the task's worktree.

What it does:

| Where | Before | Now |
| --- | --- | --- |
| Default rules | Waits for the person, held (its kind always asks) | Unchanged |
| A kind moved to "The rest", rules "Allowed" | Allowed | Force pushes, the default branch, deleting branches: unchanged, that's the person's choice about that kind. Writing outside: waits for the person (below) |
| A kind moved to "The rest", the coordinator decides | The coordinator judged it | Waits for the person, with "always allow" for its kind but writing outside's |
| A kind moved to "The rest", "Ask me", a read | Allowed as a routine read | Waits for the person |
| A kind on "Always allowed" (switch off) | Allowed | Force pushes, the default branch, deleting branches: unchanged. Writing outside: waits for the person |
| Allow everything | Allowed | Waits for the person, its reason ending "even with everything allowed"; no "always allow" holds |
| Never | Refused | Unchanged |

Reading where the person keeps keys and sign-ins (`SECRET_PLACES`,
`provider-adapters/src/secrets.ts`) is refused outright, for every role and
mode, as the keychain already was.

Writing outside the worktree is a kind broader than what could lose work
there: most such writes are harmless (a report on the Desktop, a global
install), so a person who always allows it, or takes it off the always-ask
list, means those, not `rm -rf` of their checkout. What could lose work of
that kind, and what the rules can't tell, asks the person whatever they
chose about the kind, and its card offers no "always allow" that wouldn't
hold. A force push, the default branch and deleting branches are kinds that
are only what could lose work, so a choice about them is one about that.

ADR-043 (amended) says Allow everything stops short of it; ADR-013 and
ADR-019 are amended to match.

### On Windows

Since Windows support (#285) a lead's command may be cmd's or PowerShell's,
with drive letters and backslashes, which the rules first read as a POSIX
shell would: `rd /s /q C:\code\app` was no command they knew, and
`C:\code\app` unquoted lost its backslashes. Now (`rules.ts`, "Windows"):

- each command is read also as the POSIX command that does the same:
  `rd /s`, `rmdir /s`, `del`, `erase`, `Remove-Item` and its aliases (`-Path`,
  `-LiteralPath`, `-Path:x`, lists with commas) as `rm`; `Move-Item`, `move`,
  `Rename-Item`, `ren` as `mv`; `Copy-Item`, `copy`, `xcopy` as `cp`;
  `robocopy` as `rsync`, `/MIR` and `/PURGE` deleting where it copies to,
  `/MOV` and `/MOVE` from where it copies from; `Set-Content`, `Out-File`,
  `New-Item` and the like as writes; `Set-Location`, `pushd` as `cd`; a
  program by its name in any case, without its folder or `.exe` (`git.exe`,
  `GIT`, `& "C:\Program Files\Git\cmd\git.exe"`);
- `cmd /c …` and `powershell -Command …` (and `pwsh -c`, and Windows
  PowerShell's bare `powershell Remove-Item …`) are read as the commands
  they run, with backslashes as separators;
- on Windows a line is read also with its backslashes as separators, and
  paths with Windows's own rules: drive letters, either slash, any case;
- the home folder as `~`, `$HOME`, `$env:USERPROFILE` or `%USERPROFILE%`,
  for keys and sign-ins too (`type %USERPROFILE%\.npmrc` is refused);
- `winget`, `choco`, `scoop` and PowerShell's `Install-Module` and the like
  install for the whole computer.

A second reading only adds what a command is. Covered by tests with Windows
paths ("on Windows (DEV-69)"). Not covered: `-EncodedCommand`, like `eval`,
is read as what the rules can't tell only where its line names a push, a
deploy, a publish or a merge; and a reader (the coordinator, a review) runs
only what its allowlist names, which has no Windows command on it, so it is
refused the rest.

## What Althar's own git does to the person's checkout

| Operation | Where | Can it lose work? |
| --- | --- | --- |
| Task worktrees: `git worktree add -b` from the person's repository, into `~/Althar/<project>/<task>/<repository>` | `git.ts:419-431` | No. Althar never removes a worktree or a branch of the person's (no `worktree remove` in the runtime) |
| `git worktree prune` before adding one | `git.ts:427`, `431` | Barely: it drops git's record of any worktree whose folder is missing, such as one on a drive that isn't mounted (locked ones are kept). Recommendation: `--expire` a week, or lock the worktrees Althar makes |
| Fetching before a task starts, and for pull requests and reviews | `git.ts:261`, `281`, `381`; `Changes.ts:889`, `1520`, `3163`; `Reviews.ts:396` | No: into `refs/althar/…` or remote-tracking refs, never a local branch |
| Merging a task here, without a pull request | `localMerge.ts` | No: worked out without a working tree; the default branch moves as a ref where nothing has it checked out, else only by a fast-forward in a checkout with nothing uncommitted and no untracked file in the way; undone with `reset --keep` |
| Pushing the task's branch | `git.ts:493-516` | No: never forced, except when the person presses Push on rewritten commits, with a lease |
| The coordinator's and a review's copies: `checkout --force`, `clean -fdq` | `coordinatorFolder.ts`, `reviewCopy.ts:40-41` | No: folders Althar made for itself. The coordinator's are repositories of their own, whose git folder is made again for every turn; a link left in place of a copy or its git folder is removed, never followed, and only a copy's own old worktree record is dropped (ADR-058) |
| A fresh branch for a follow-up change, deleted when the switch fails | `Changes.ts:893-906` | No: only the branch it just made |
| Hooks | The runtime's git runs with the repository's hooks off | No |

## Left for a person with real agents

Each of these needs a real session, which this audit couldn't run; until
then each holds only as far as unit tests of the rules' verdicts show it:

1. **Claude Code: does a sandboxed command ask?** The session's ask rule for
   `Bash` sits beside `autoAllowBashIfSandboxed: true`; the code and 03 say a
   sandboxed command runs without asking. Confirm with `git branch -D
   <another branch>` and `git stash clear` in a lead: if they run without a
   card, the local-branch and stash fixes only hold where the command leaves
   the sandbox, and the leaning in `docs/open-questions.md` ("Rules the
   sandbox hides from Althar": Claude Code ask rules such as `Bash(git branch
   -D:*)`) is the next step.
2. **Claude Code: do the denied reads hold in its sandbox?** In a lead, ask
   for `cat ~/.ssh/id_ed25519` (or any file under `~/.aws`): it should fail
   inside the sandbox, and its retry outside should be refused by Althar.
   Check the session still starts and works with the 56 deny rules. They deny
   all of `~/.ssh`, `config` and `known_hosts` too, which Althar's own rules
   let through, so inside the sandbox ssh reads neither; the sandbox has no
   network for it anyway, and its retry outside the sandbox, which Althar
   answers, isn't bound by those denies. Confirm that `git fetch` and `git
   push` over SSH still work from a lead that way, and that a host alias in
   `~/.ssh/config` is used.
3. **Claude Code: how a sandboxed command's network ask arrives** over ACP,
   and that Althar sees the host.
4. **Codex: escalations.** In `workspace-write`, check that `git branch -D
   <another branch>` asks (its sandbox keeps the main repository's `.git`
   read-only, so it should), and that `rm -rf <outside>` arrives as a
   request Althar reads.
5. **Allow everything on a task, end to end:** ask the lead to force push
   the task's branch, and to `git -C <your checkout> reset --hard`: each
   should wait as a card saying "even with everything allowed", and Allow
   all should still clear the stack once.
6. **The judge:** with the coordinator deciding and "Force pushes" moved to
   The rest, a force push should come to the person, with "always allow" for
   force pushes on the card.
