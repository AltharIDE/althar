import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/*
 * Builds the app and runs the end-to-end tests (any arguments go to
 * Playwright, so `bun run test:e2e e2e/home.spec.ts` runs one file), at most
 * a few runs at once on this computer. Agents in several worktrees each run
 * them, and many Electron apps and builds at once load the machine until
 * tests time out, so a run takes one of a few slots every worktree shares
 * (ALTHAR_E2E_SLOTS, 3 unless set), waiting while all are taken, or while
 * another run in the same worktree has one. They are kept in /tmp rather
 * than the temporary folder, which a sandboxed agent may have of its own
 * (ALTHAR_E2E_LOCKS moves them). CI runs alone and takes none.
 */

interface Owner {
  readonly pid: number
  readonly cwd: string
}

const locks = process.env.ALTHAR_E2E_LOCKS ?? join(process.platform === 'win32' ? tmpdir() : '/tmp', `althar-e2e-${userInfo().uid}`)
const SLOTS = Math.max(1, Number.parseInt(process.env.ALTHAR_E2E_SLOTS ?? '', 10) || 3)
/** How long a slot with no owner written yet is left alone: a run between taking it and saying whose it is. */
const UNCLAIMED = 10_000
const POLL = 2_000

const slotAt = (index: number) => join(locks, `slot-${index}`)

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // There, but another user's.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const owner = (slot: string): Owner | undefined => {
  try {
    return JSON.parse(readFileSync(join(slot, 'owner.json'), 'utf8')) as Owner
  } catch {
    return undefined
  }
}

const age = (slot: string) => {
  try {
    return Date.now() - statSync(slot).mtimeMs
  } catch {
    return 0
  }
}

/** Takes a free slot, waiting while every one is taken; undefined where they can't be made here, and the run goes ahead without one. */
const take = async (): Promise<string | undefined> => {
  let told = false
  for (;;) {
    const holders: Array<Owner | undefined> = []
    // A worktree has one build and one test-results folder, which a second run there would pull from under the first.
    const mine = Array.from({ length: SLOTS }, (_, index) => owner(slotAt(index))).find(
      (holder) => holder?.cwd === process.cwd() && alive(holder.pid),
    )
    for (let index = 0; mine === undefined && index < SLOTS; index++) {
      const slot = slotAt(index)
      try {
        mkdirSync(locks, { recursive: true })
        mkdirSync(slot)
        writeFileSync(join(slot, 'owner.json'), JSON.stringify({ pid: process.pid, cwd: process.cwd() } satisfies Owner))
        return slot
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') {
          console.warn(`Running without an end-to-end slot (${code ?? String(error)} at ${locks}).`)
          return undefined
        }
        const holder = owner(slot)
        // Left by a run that ended without letting go: free for the next look.
        if (holder === undefined ? age(slot) > UNCLAIMED : !alive(holder.pid)) rmSync(slot, { recursive: true, force: true })
        holders.push(holder)
      }
    }
    if (!told && mine !== undefined) console.warn('Waiting for the end-to-end run already going in this worktree to finish…')
    else if (!told) {
      const where = holders.map((holder) => holder?.cwd ?? 'another worktree').join(', ')
      console.warn(`Waiting for one of ${SLOTS} end-to-end runs to finish: ${where}…`)
    }
    told = true
    await sleep(POLL)
  }
}

const release = (slot: string | undefined) => {
  if (slot !== undefined && owner(slot)?.pid === process.pid) rmSync(slot, { recursive: true, force: true })
}

let child: ReturnType<typeof spawn> | undefined
let slot: string | undefined

const run = (command: string, args: ReadonlyArray<string>) =>
  new Promise<number>((resolve) => {
    // Windows finds bun and playwright as .cmd files, which only a shell runs.
    child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    child.once('exit', (code, signal) => resolve(code ?? (signal === null ? 1 : 128)))
    child.once('error', () => resolve(1))
  })

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    child?.kill(signal)
    release(slot)
    process.exit(130)
  })

if (process.env.CI === undefined) slot = await take()
try {
  const built = await run('bun', ['run', 'build'])
  process.exitCode = built === 0 ? await run('playwright', ['test', ...process.argv.slice(2)]) : built
} finally {
  release(slot)
}
