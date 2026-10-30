import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * What can't be undone from a task, stopped where it happens, at git itself
 * (ADR-071): a push to the default branch, a force push, deleting a branch
 * that isn't the task's, on the remote or here, and moving one so it loses
 * commits. The rules read a command for these, but a script or a loop hides
 * them, and inside its sandbox a lead's command isn't read at all. So every
 * lead's git takes its hooks from a folder of Althar's (`core.hooksPath`, by
 * the environment), whose `pre-push` and `reference-transaction` stop them,
 * saying what and how to ask for it, and whose every hook then runs the
 * repository's own, as it would have run.
 *
 * Where the person allows a request that is one of these, Althar writes the
 * session a pass naming the git commands they allowed, for the next two
 * minutes. The guard lets through only a git whose own words (`ps`) are one
 * of those, and only that one run of it: the pass is spent on the git it
 * first lets through, and nothing else gets past on it.
 *
 * What it stops it names on a line of its own (`STOPPED`), which Althar
 * reads on the failed call to count it as a refusal (`guardStopIn`).
 *
 * It holds against a mistake, not an agent set on getting past it: one that
 * changes its environment or git's config gets past it, as one outside its
 * sandbox could anyway. Althar's own git runs no hooks (git.ts).
 */

/** The hooks git runs on the client side, and on a repository on this computer pushed to, all handed over to the repository's own. */
const HOOKS = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'pre-receive',
  'update',
  'proc-receive',
  'post-receive',
  'post-update',
  'reference-transaction',
  'pre-auto-gc',
  'post-rewrite',
  'sendemail-validate',
  'post-index-change',
] as const

/** The hooks the guard reads first: what a push sends, and what a branch is moved or deleted to. */
const GUARDED = ['pre-push', 'reference-transaction']

/**
 * Every hook: the guard first where it reads this one, then the
 * repository's own hook, where it has one, from where its config says
 * (`core.hooksPath`, which this folder stands in for) or its git folder.
 */
const SHIM = `#!/bin/sh
# Althar's hooks folder (ADR-071): its guard, then the repository's own hook.
# The git that runs this hook, whose words a pass names.
ALTHAR_GIT_PID=$PPID
export ALTHAR_GIT_PID
here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$0")
own=$(git config --local --get core.hooksPath 2>/dev/null || git config --global --get core.hooksPath 2>/dev/null || git config --system --get core.hooksPath 2>/dev/null)
[ -n "$own" ] || own="$(git rev-parse --git-common-dir 2>/dev/null)/hooks"
case "$own" in "~/"*) own="$HOME/\${own#\\~/}" ;; esac
[ "$own" = "$here" ] && own=
case "$name" in
  ${GUARDED.join('|')})
    input=$(cat)
    printf '%s\\n' "$input" | "$here/../guard" "$name" "$@" || exit 1
    if [ -n "$own" ] && [ -x "$own/$name" ]; then
      if [ -n "$input" ]; then printf '%s\\n' "$input"; fi | "$own/$name" "$@"
      exit $?
    fi
    exit 0
    ;;
esac
if [ -n "$own" ] && [ -x "$own/$name" ]; then exec "$own/$name" "$@"; fi
exit 0
`

/** What the guard says after what it stopped: how to ask for it, or go another way. */
const HOW =
  'If it should happen, run it as a plain git command on a line of its own, outside your sandbox: Althar asks the person, and lets it through once they allow it. Otherwise find another way.'

/** The line after what the guard says, naming the kind it stopped, for the record to count. */
const STOPPED = '(stopped by Althar: %s)'

/** The kind of what git's guard stopped, where a failed command's output says it did. */
export const guardStopIn = (printed: string): 'default-branch' | 'force-push' | 'delete-branch' | undefined =>
  /\(stopped by Althar: (default-branch|force-push|delete-branch)\)/.exec(printed)?.[1] as
    | 'default-branch'
    | 'force-push'
    | 'delete-branch'
    | undefined

/**
 * The guard: a push of the default branch, of a branch over commits it
 * doesn't have, or deleting a branch that isn't the task's; a branch that
 * isn't the task's deleted or moved so it loses commits here. Tags and
 * remotes' branches go as before. A fresh pass lets through the git it
 * names, once: the run that first spends it.
 */
const GUARD = `#!/bin/sh
# Althar's guard (ADR-071): stops what can't be undone from a task, at git itself.
hook=$1
shift
pass=\${ALTHAR_GUARD_PASS:-}
git=\${ALTHAR_GIT_PID:-}
task=\${ALTHAR_TASK_BRANCH:-}
defaults=" \${ALTHAR_DEFAULT_BRANCHES:-} "
how='${HOW.replaceAll("'", "'\\''")}'
# Whether the person allowed this git: a fresh pass names its words, and no other git has spent it.
passes() {
  [ -n "$pass" ] && [ -n "$git" ] && [ -f "$pass" ] && [ -n "$(find "$pass" -mmin -2 2>/dev/null)" ] || return 1
  spent=$(sed -n 's/^spent //p' "$pass")
  if [ -n "$spent" ]; then [ "$spent" = "$git" ]; return; fi
  words=$(ps -o args= -p "$git" 2>/dev/null | sed -E -e 's#^[^ ]*/git( |$)#git\\1#' -e 's/[[:space:]]+/ /g' -e 's/ $//')
  [ -n "$words" ] && grep -Fqx -e "$words" "$pass" || return 1
  printf 'spent %s\\n' "$git" >> "$pass"
}
stop() {
  passes && return 0
  printf 'Althar stopped this: %s\\n%s\\n${STOPPED}\\n' "$2" "$how" "$1" >&2
  exit 1
}
zero() { case "$1" in *[!0]*) return 1 ;; esac; return 0; }
case "$hook" in
  pre-push)
    remote=$1
    while read -r local_ref local_sha remote_ref remote_sha; do
      case "$remote_ref" in refs/heads/*) ;; *) continue ;; esac
      branch=\${remote_ref#refs/heads/}
      case "$defaults" in *" $branch "*) stop default-branch "a push to $branch, the default branch, can't be undone from the task." ;; esac
      if zero "$local_sha"; then
        [ "$branch" = "$task" ] && continue
        stop delete-branch "deleting $branch on $remote can't be undone: it isn't this task's branch."
      fi
      zero "$remote_sha" && continue
      if git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
        git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null ||
          stop force-push "a force push to $branch can't be undone: it throws away commits $remote has there."
      else
        stop force-push "$remote has commits on $branch this repository doesn't, and pushing over them by force can't be undone. Fetch them first (fetch_from_remote), then push what includes them."
      fi
    done
    ;;
  reference-transaction)
    [ "$1" = prepared ] || exit 0
    while read -r old new ref; do
      case "$ref" in refs/heads/*) ;; *) continue ;; esac
      branch=\${ref#refs/heads/}
      [ "$branch" = "$task" ] && continue
      if zero "$new"; then stop delete-branch "deleting the branch $branch can't be undone from the task: it isn't this task's."; fi
      zero "$old" && continue
      git merge-base --is-ancestor "$old" "$new" 2>/dev/null ||
        stop force-push "moving $branch so it loses commits can't be undone from the task: it isn't this task's branch."
    done
    ;;
esac
exit 0
`

/** The guard's folder: its hooks, the guard, and each session's pass. */
export interface Guard {
  readonly hooks: string
  readonly passes: string
}

let made: Guard | undefined

/** Althar's hooks folder for this runtime, made the first time it's asked for, outside any agent's sandbox. */
export const guard = (root: string = tmpdir()): Guard => {
  if (made !== undefined) return made
  const folder = mkdtempSync(join(root, 'althar-guard-'))
  const hooks = join(folder, 'hooks')
  const passes = join(folder, 'passes')
  mkdirSync(hooks)
  mkdirSync(passes)
  const write = (path: string, text: string) => {
    writeFileSync(path, text)
    chmodSync(path, 0o755)
  }
  write(join(folder, 'guard'), GUARD)
  for (const hook of HOOKS) write(join(hooks, hook), SHIM)
  made = { hooks, passes }
  return made
}

/** The pass of a session: a file whose age says whether it still holds. */
const passOf = (sessionId: string, at: Guard) => join(at.passes, sessionId.replace(/[^\w-]/g, '_'))

/**
 * What a lead's environment adds so its git runs Althar's hooks: git's
 * config by the environment, after the `count` entries already there
 * (`withoutSignIns`'), and what the guard reads.
 */
export const guardEnv = (input: {
  readonly sessionId: string
  readonly taskBranch: string | null
  readonly defaultBranches: ReadonlyArray<string>
  readonly count: number
  readonly at?: Guard
}): Readonly<Record<string, string>> => {
  const at = input.at ?? guard()
  return {
    GIT_CONFIG_COUNT: String(input.count + 1),
    [`GIT_CONFIG_KEY_${input.count}`]: 'core.hooksPath',
    [`GIT_CONFIG_VALUE_${input.count}`]: at.hooks,
    ALTHAR_TASK_BRANCH: input.taskBranch ?? '',
    ALTHAR_DEFAULT_BRANCHES: [...new Set(input.defaultBranches)].join(' '),
    ALTHAR_GUARD_PASS: passOf(input.sessionId, at),
  }
}

/**
 * Lets past the guard, for the next two minutes, the one run of git whose
 * words are among `commands` (`gitCommandsOf`): the person allowed what it
 * stops. A new pass takes the place of the one before, spent or not.
 */
export const passGuard = (sessionId: string, commands: ReadonlyArray<string>, at: Guard | undefined = made): void => {
  if (at === undefined || commands.length === 0) return
  try {
    // Its file's own time is what the hook reads, so writing it again starts the two minutes again.
    writeFileSync(passOf(sessionId, at), commands.map((each) => `${each}\n`).join(''))
  } catch {
    // A pass that can't be written leaves the guard as it is: the command says what stopped it.
  }
}

/** Takes a session's pass away, as when it has ended. */
export const dropPass = (sessionId: string, at: Guard | undefined = made): void => {
  if (at === undefined) return
  rmSync(passOf(sessionId, at), { force: true })
}
