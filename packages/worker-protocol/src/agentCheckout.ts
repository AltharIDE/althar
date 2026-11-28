/** The most a worker that doesn't keep history (one set up before it did) takes in one send: its whole bundle. */
export const MAX_WORKER_BUNDLE_BYTES = 128 * 1024 * 1024
/**
 * The most a worker that keeps each project's history takes in one send, as the protocol's 32-bit size allows. Only its
 * first send for a project carries the history; later ones carry what its copy lacks.
 */
export const MAX_WORKER_HISTORY_BYTES = 2 ** 32 - 1
/** The most commits of one project's history a worker says it holds, newest first. */
export const MAX_WORKER_HISTORY_COMMITS = 32
/** The most projects whose history a worker says it holds. */
export const MAX_WORKER_HISTORIES = 64
export const gitObjectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export interface WorkerCheckout {
  readonly size: number
  readonly sha256: Uint8Array
  readonly head: string
  readonly contents: (signal: AbortSignal) => AsyncIterable<Uint8Array>
}

/** What one send to a worker may be: whole and small for one that doesn't keep history, up to 4 GiB for one that does. */
export const sendLimitOf = (keepsHistory: boolean): number => (keepsHistory ? MAX_WORKER_HISTORY_BYTES : MAX_WORKER_BUNDLE_BYTES)

/** How much longer a send of `bytes` may take than a small one: as at 256 KiB a second, a slow link's pace. */
export const transferMsOf = (bytes: number): number => Math.ceil(bytes / (256 * 1024)) * 1_000

export const validCheckout = (checkout: WorkerCheckout, maxBytes = MAX_WORKER_BUNDLE_BYTES): boolean =>
  Number.isSafeInteger(checkout.size) &&
  checkout.size > 0 &&
  checkout.size <= maxBytes &&
  checkout.sha256.byteLength === 32 &&
  gitObjectId.test(checkout.head)

export const sourceOf = (checkout: WorkerCheckout) => ({ size: checkout.size, sha256: checkout.sha256, head: checkout.head })
