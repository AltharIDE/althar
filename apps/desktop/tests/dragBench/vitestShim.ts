/* The fixtures' `vi.fn`, in a page: the function it wraps, with nothing recorded. */
export const vi = {
  fn:
    <A extends ReadonlyArray<unknown>, R>(impl: (...args: A) => R = (() => undefined) as (...args: A) => R) =>
    (...args: A): R =>
      impl(...args),
}
