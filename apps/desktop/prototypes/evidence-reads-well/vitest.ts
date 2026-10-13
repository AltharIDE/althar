/* What the app's test fixtures take from vitest, in a browser: a fake is just the function it wraps. */
type Fn = (...args: never[]) => unknown
export const vi = { fn: <F extends Fn>(impl?: F) => impl ?? ((() => undefined) as unknown as F) }
