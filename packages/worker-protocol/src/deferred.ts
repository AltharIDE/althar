export interface Deferred<A> {
  readonly promise: Promise<A>
  readonly resolve: (value: A) => void
  readonly reject: (error: Error) => void
}

export const deferred = <A>(): Deferred<A> => {
  let resolve!: Deferred<A>['resolve']
  let reject!: Deferred<A>['reject']
  const promise = new Promise<A>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
