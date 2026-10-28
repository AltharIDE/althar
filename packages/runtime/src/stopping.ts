import { Duration, Effect } from 'effect'

import { holding, processes, treeOf } from './ports'

/*
 * How Althar stops processes it doesn't run itself: what its agents left
 * running in the background, and what settled work left (LeftBehind.ts).
 * Claude Code runs a background command in a shell that leads a process
 * group of its own; stopping the command ends that shell, and what the shell
 * started, a dev server, Storybook or `vp preview`, runs on under launchd in
 * the shell's old group. So a command is stopped with everything it started,
 * found while its shell still holds the file its output goes to: each
 * process, and the group it leads, asked to stop, then killed. Not on
 * Windows, which has no groups and where `lsof` can't say.
 */

/** How long a process asked to stop has before it is killed, and how long a kill is given. */
const GRACE = Duration.seconds(3)
const KILLED = Duration.seconds(1)

/** Whether a process runs, or the group it led does: a shell's group outlives it. */
const alive = (pid: number) =>
  [pid, -pid].some((target) => {
    try {
      process.kill(target, 0)
      return true
    } catch {
      return false
    }
  })

/** Sends a process, and the group it leads where it leads one, a signal; one gone already is fine. */
const signal = (pid: number, sent: 'SIGTERM' | 'SIGKILL') => {
  for (const target of [-pid, pid])
    try {
      process.kill(target, sent)
    } catch {
      // Gone already, or no group of its own.
    }
}

/** Waits for each to end, up to `limit`; those still running. */
const survivorsOf = (pids: ReadonlyArray<number>, limit: Duration.Duration) =>
  Effect.gen(function* () {
    const until = Date.now() + Duration.toMillis(limit)
    let left = pids.filter(alive)
    while (left.length > 0 && Date.now() < until) {
      yield* Effect.sleep(Duration.millis(50))
      left = left.filter(alive)
    }
    return left
  })

/**
 * Stops processes: each, and its group, asked to stop (TERM), then those
 * still running killed once `grace` is up. Those that outlived that.
 */
export const stopProcesses = (pids: ReadonlyArray<number>, grace: Duration.Duration = GRACE) =>
  Effect.gen(function* () {
    if (pids.length === 0) return []
    for (const pid of pids) signal(pid, 'SIGTERM')
    const asked = yield* survivorsOf(pids, grace)
    for (const pid of asked) signal(pid, 'SIGKILL')
    return yield* survivorsOf(asked, KILLED)
  })

/**
 * What a background command runs as, while it runs: the processes holding
 * the file its output goes to, with everything they started. Only what
 * `agent` started, never the agent itself, which reads that file too, nor
 * Althar; with no agent process, as in tests, what Althar started. None
 * where there is no such file (Codex) or nothing holds it.
 */
export const treeOfCommand = (outputPath: string | null, agent: number | undefined): Effect.Effect<ReadonlyArray<number>> =>
  Effect.gen(function* () {
    if (outputPath === null || process.platform === 'win32') return []
    const held = yield* holding(outputPath)
    if (held.length === 0) return []
    const parents = yield* processes()
    const below = treeOf(parents, [agent ?? process.pid])
    const roots = held.filter((pid) => below.has(pid) && pid !== agent && pid !== process.pid)
    return [...treeOf(parents, roots)]
  })
