/*
 * The asides' conversations the window shows right now: a prompt a thread raises itself (a computer-use permission, say)
 * is drawn in the conversation that has it, so where that is already shown the window stays where it is, and anywhere else
 * it goes to the thread, or the person would never see the prompt.
 */
const shown = new Set<string>()

/** A project's conversation shows the aside on `threadId`, until the returned function is called. */
export const showingAside = (threadId: string): (() => void) => {
  shown.add(threadId)
  return () => void shown.delete(threadId)
}

/** Whether the window already shows the thread's conversation, over a project's coordinator, so its prompt is in view. */
export const staysInPlace = (threadId: string) => shown.has(threadId)
