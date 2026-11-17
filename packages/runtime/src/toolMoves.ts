/*
 * How often each thread's tool calls moved in this launch: one started, or
 * one's status changed, however long ago it started. The files a lead
 * changed are read from git again only as its calls move (Queries.ts
 * `gitOf`): a call's progress alone changes nothing on disk, and reading
 * every call's status from the store to see whether one moved reads
 * thousands of them in a long thread. A count of the latest few calls
 * would miss an older one that ends after newer ones did, and the files
 * its edit left would stay unread.
 */
const moves = new Map<string, number>()

/** Says a thread's tool call started, or its status changed. */
export const toolCallMoved = (threadId: string) => void moves.set(threadId, (moves.get(threadId) ?? 0) + 1)

/** How often the thread's tool calls moved in this launch. */
export const toolCallMoves = (threadId: string) => moves.get(threadId) ?? 0
