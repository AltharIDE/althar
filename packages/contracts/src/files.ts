/*
 * What a message may carry of the person's files and folders (`Send`'s
 * `files`), beside its images: Althar copies each where the thread's agent
 * reads (`.althar/attachments` in the task's folder, or in the coordinator's),
 * and links the copy in the prompt, so the agent opens it with its own tools.
 * The window says what is over before it sends; the runtime refuses what is
 * still over as it copies.
 */

export const MESSAGE_FILES = {
  /** Files and folders in one message. */
  count: 10,
  /** Bytes in one file, or in all of one folder's files. */
  bytes: 50 * 1024 * 1024,
  /** Bytes in all of one message's files and folders together. */
  total: 100 * 1024 * 1024,
  /** Files in one folder, at every depth. */
  entries: 2000,
  /** Bytes of a text file whose words go in the prompt too, for an agent that takes them (ACP's `promptCapabilities.embeddedContext`). */
  embedded: 100 * 1024,
} as const
