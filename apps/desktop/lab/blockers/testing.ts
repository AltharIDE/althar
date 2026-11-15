/* What tests/fixtures.ts takes from @althar/testing, for a page: its index reaches node's file system and process. */
export const isoAfter = (milliseconds: number, now = Date.now()): string => new Date(now + milliseconds).toISOString()
