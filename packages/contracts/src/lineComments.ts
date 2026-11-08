import { Schema } from 'effect'

/*
 * Comments the person makes on lines of a task's diff (DEV-175, ADR-105): a
 * line or a range of one file, what they said about it, and the code as it
 * showed, quoted, so the lead never has to guess which line is meant. Sent
 * with a message (`Send`'s `comments`), kept on the person's message as
 * they went, and read back with where each is in the change now and whether
 * a commit since changed its lines (`GetLineComments`).
 */

export const LINE_COMMENTS = {
  /** Comments in one message. */
  count: 30,
  /** Lines quoted in one comment: a longer range is cut to its first ones. */
  lines: 80,
  /** Characters in one quoted line. */
  lineText: 2000,
  /** Characters in what the person said of one. */
  note: 8000,
  /** Characters in a file's path. */
  path: 1000,
} as const

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/** A line of the diff as it was quoted: unchanged, added or removed, and its text. */
export const QuotedLine = Schema.Struct({
  kind: Schema.Literals(['context', 'added', 'removed']),
  text: Schema.String.check(Schema.isMaxLength(LINE_COMMENTS.lineText)),
})
export type QuotedLine = typeof QuotedLine.Type

/**
 * A comment on lines of a task's diff, as the window sends it. `path` is the
 * file as the Changes view names it (with its repository's slug first, in a
 * task of several). `side` says whose numbers `start` and `end` are: the
 * file as the task has it (`new`), or, for lines it only took out, the file
 * as it was (`old`), with `under` the line of the new file they were taken
 * out after (0 at its top). `code` is the lines as they showed, in order.
 */
export const LineComment = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(LINE_COMMENTS.path)),
  side: Schema.Literals(['new', 'old']),
  start: Line,
  end: Line,
  under: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  code: Schema.Array(QuotedLine).check(Schema.isMinLength(1), Schema.isMaxLength(LINE_COMMENTS.lines)),
  note: Schema.String.check(Schema.isMaxLength(LINE_COMMENTS.note)),
})
export type LineComment = typeof LineComment.Type

/** The comments sent with one message, in the order they were made: at most `LINE_COMMENTS.count`. */
export const LineComments = Schema.Array(LineComment).check(Schema.isMaxLength(LINE_COMMENTS.count))

/** A comment as the person's message keeps it: by an id of its own, which the diff and the thread both name it by. */
export const SentLineComment = Schema.Struct({ id: Schema.String, ...LineComment.fields })
export type SentLineComment = typeof SentLineComment.Type

/**
 * A comment the person sent, as it stands now: on which message, when, and
 * where its lines are in the task's change (`at`, its first line carried past
 * what changed since it was made; null where its file is gone, or Althar
 * can't read where it is); and `addressed` once a commit since it was made
 * changed those lines.
 */
export const LineCommentNow = Schema.Struct({
  ...SentLineComment.fields,
  itemId: Schema.String,
  sentAt: Schema.String,
  at: Schema.NullOr(Schema.Struct({ path: Schema.String, line: Schema.Number })),
  addressed: Schema.Boolean,
})
export type LineCommentNow = typeof LineCommentNow.Type

/** Every comment sent on a task's diff, oldest first. */
export const TaskLineComments = Schema.Struct({ comments: Schema.Array(LineCommentNow) })
export type TaskLineComments = typeof TaskLineComments.Type
