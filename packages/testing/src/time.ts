/** An ISO time relative to the test's present (or its explicitly fixed clock), never a date that will expire. */
export const isoAfter = (milliseconds: number, now = Date.now()): string => new Date(now + milliseconds).toISOString()
