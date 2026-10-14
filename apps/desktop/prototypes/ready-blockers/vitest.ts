/* What the desktop tests' fixtures take from vitest, in a browser: vi.fn is the function it is given. */
type Fn = (...args: never[]) => unknown

export const vi = {
  fn: <F extends Fn>(impl?: F): F => impl ?? ((() => undefined) as unknown as F),
}
