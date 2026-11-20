/* What tests/fixtures.ts takes from @althar/testing, for a page in a browser: the rest of it reads files. */
export const isoAfter = (milliseconds: number, now = Date.now()): string => new Date(now + milliseconds).toISOString()
