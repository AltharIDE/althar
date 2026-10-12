import { MOST_AT_ONCE } from '@althar/contracts'

/*
 * How many tasks may be at work at once on a machine, by default, from its
 * cores and its memory (DEV-58, ADR-031). A lead with its test runs easily
 * takes several GB and many cores, so each figure is conservative: a task
 * counts 2.5 cores and 3 GB, and 4 GB are left for the system, the person's
 * own apps and Althar itself. The default is the lower of the two, never
 * fewer than one and never more than the 16 runs at once Althar is built
 * for (docs/architecture/07). It is worked out again at each launch, so a
 * machine that changes gets a default that fits it; only a number the
 * person sets is kept.
 */

/** The cores a task at work takes, its lead and what it runs: a test run fills several. */
export const CORES_EACH = 2.5
/** The memory a task at work takes, in GB: its agent, and the installs, builds and test runs it starts. */
export const MEMORY_EACH = 3
/** The memory left for everything that isn't Althar's work, in GB: the system, the person's apps, and Althar's own window and runtime. */
export const MEMORY_KEPT = 4
/** The most at once, by default or by the person: the active runs Althar is built for (docs/architecture/07). */
export const MOST = MOST_AT_ONCE

const GB = 1024 ** 3

/** A machine as Node says it: how many cores (`os.cpus()`), and all its memory in bytes (`os.totalmem()`). */
export interface Machine {
  readonly cores: number
  readonly memory: number
}

/** The default and what it came from: the machine's cores, its memory in whole GB, and the figure each gives. */
export interface AtOnceDefault {
  readonly count: number
  readonly cores: number
  readonly memory: number
  readonly byCores: number
  readonly byMemory: number
}

/** How many tasks may be at work at once on `machine`, unless the person says otherwise, and why. */
export const atOnceFor = (machine: Machine): AtOnceDefault => {
  const cores = Math.max(0, Math.floor(machine.cores))
  // In whole GB, as the machine is sold and as Settings says it, so the reason reads as the sum.
  const memory = Math.max(0, Math.round(machine.memory / GB))
  const byCores = Math.floor(cores / CORES_EACH)
  const byMemory = Math.floor((memory - MEMORY_KEPT) / MEMORY_EACH)
  return { count: clamp(Math.min(byCores, byMemory)), cores, memory, byCores, byMemory }
}

/** Within what may be at once: one at least, and at most MOST. */
export const clamp = (count: number) => Math.min(MOST, Math.max(1, Math.floor(count)))

/** Whether the person may set `count`: a whole number from one to MOST. */
export const isAtOnce = (count: number) => Number.isInteger(count) && count >= 1 && count <= MOST
