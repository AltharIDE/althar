import type { WorkerGrant } from '@althar/contracts'

import type { SshHomeTarget } from './homes'

/*
 * Adding a worker over SSH, as main runs it (apps/host/bootstrap/README.md, Workers): the person's own OpenSSH reaches
 * the machine, looks it over, gives it the signed release (which carries the worker, its agents' ACP adapters and the
 * agents' own programs), and the release makes the worker's own key. The window has its home sign that key
 * (`AddWorker`); main hands what the home gave to the worker, which starts as a service of its own. One at a time for
 * the whole app. Each step is safe to run again, so Try again starts it over, keeping the worker's key and its release.
 */

export const WORKER_STEPS = ['reach', 'look', 'get', 'enroll', 'start'] as const
export type WorkerStep = (typeof WORKER_STEPS)[number]

/** An agent the worker has, from its release, and whether it is signed in there. */
export interface WorkerAgent {
  readonly id: string
  readonly name: string
  readonly signedIn: boolean
}

export interface WorkerSetup {
  /** Where it is reached: as the person gave it, then as the worker's own user where Althar made one. */
  readonly target: SshHomeTarget
  /** As the person knows it: the host they gave. */
  readonly name: string
  /**
   * `running` a step; `trust`, its SSH host key seen for the first time, the person's to trust; `enroll`, its key made,
   * for the window's home to sign; `failed`; `done`, started as a service.
   */
  readonly phase: 'running' | 'trust' | 'enroll' | 'failed' | 'done'
  /** The step it is at, as `WORKER_STEPS` has them. */
  readonly at: number
  readonly progress?: { readonly bytes: number; readonly total: number }
  readonly hostKey?: { readonly host: string; readonly type: string; readonly fingerprint: string }
  /** What stopped it, by its code; with SSH's or the worker's own last words where it said. */
  readonly problem?: { readonly code: string; readonly said?: string }
  /** The worker's own public key, SPKI DER, base64url: what its home signs. */
  readonly publicKey?: string
  /** What it found looking the machine over: Linux · arm64 · 62 GB free. */
  readonly facts?: string
  /** The release is sent from here, as the machine couldn't download it. */
  readonly sending?: boolean
  /** The release it was given. */
  readonly version?: string
  /** Where the login has no lingering, a line for the machine's administrator: without it the worker stops at logout. */
  readonly linger?: string
  /** The worker it became, once its home signed it and it started. */
  readonly workerId?: string
  readonly agents?: ReadonlyArray<WorkerAgent>
  /** What ran, a line each, for What it ran. */
  readonly log: ReadonlyArray<string>
}

export type WorkerSetupAction =
  | { readonly kind: 'trust' }
  /** What the window's home gave once it signed the worker's key. */
  | { readonly kind: 'enroll'; readonly grant: WorkerGrant }
  | { readonly kind: 'stop' }
  | { readonly kind: 'again' }
  | { readonly kind: 'dismiss' }

/** An agent's sign-in on a worker, as its steps come: the sign-in flow's own, and a page to open in the browser here. */
export type WorkerSignInEvent =
  | { readonly kind: 'browser'; readonly link: string | null; readonly paste: boolean }
  | { readonly kind: 'device'; readonly code: string; readonly page: string; readonly minutes: number }
  | { readonly kind: 'open'; readonly url: string }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'done'; readonly who: string | null; readonly plan: string | null }
  | { readonly kind: 'failed'; readonly message: string }
  /** Checked again once it ended: the worker's agents, and whether it started again to say so. */
  | { readonly kind: 'agents'; readonly agents: ReadonlyArray<WorkerAgent> }

export interface WorkersHost {
  readonly setup: () => Promise<WorkerSetup | null>
  /** Starts adding the worker at `target`; `here`: the window's home is this computer, so the address SSH came from reaches it. */
  readonly setUp: (target: SshHomeTarget, here: boolean) => Promise<void>
  readonly act: (action: WorkerSetupAction) => Promise<void>
  readonly onSetup: (listener: (setup: WorkerSetup | null) => void) => () => void
  /** An agent's sign-in on the worker at `ssh`, its steps told to `onSignIn`. */
  readonly signIn: (ssh: string, agent: string, way: 'browser' | 'device') => Promise<void>
  readonly signInAct: (action: { readonly paste: string } | { readonly cancel: true }) => Promise<void>
  readonly onSignIn: (listener: (event: WorkerSignInEvent) => void) => () => void
  /** The worker's agents and their sign-ins, checked now over SSH. */
  readonly agents: (ssh: string) => Promise<ReadonlyArray<WorkerAgent>>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const isWorkerSetup = (value: unknown): value is WorkerSetup | null =>
  value === null ||
  (isObject(value) &&
    isObject(value.target) &&
    typeof value.target.target === 'string' &&
    typeof value.name === 'string' &&
    typeof value.phase === 'string' &&
    typeof value.at === 'number' &&
    Array.isArray(value.log))
