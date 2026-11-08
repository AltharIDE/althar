/* What tests/fixtures.ts takes from Vitest, for a page in a browser: a spy is the function it wraps, or one that does nothing. */
const fn = <F extends (...args: never[]) => unknown>(impl?: F): F => impl ?? ((() => undefined) as unknown as F)

export const vi = { fn }
