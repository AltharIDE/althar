export const MAX_WORKER_BUNDLE_BYTES = 128 * 1024 * 1024
export const gitObjectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export interface WorkerCheckout {
  readonly size: number
  readonly sha256: Uint8Array
  readonly head: string
  readonly contents: (signal: AbortSignal) => AsyncIterable<Uint8Array>
}

export const validCheckout = (checkout: WorkerCheckout): boolean =>
  Number.isSafeInteger(checkout.size) &&
  checkout.size > 0 &&
  checkout.size <= MAX_WORKER_BUNDLE_BYTES &&
  checkout.sha256.byteLength === 32 &&
  gitObjectId.test(checkout.head)

export const sourceOf = (checkout: WorkerCheckout) => ({ size: checkout.size, sha256: checkout.sha256, head: checkout.head })
