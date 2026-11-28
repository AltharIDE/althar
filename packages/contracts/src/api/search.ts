import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { TaskLineComments } from '../lineComments'
import { CodeLine } from './internal'
import { call, ClientAuthority } from './rpc'
import { ChangedFile, Finding, TaskPhase } from './shared'

/** A line of a diff: a hunk's head, or a line of the file, with its numbers and, for a changed line, the stretch that differs. */
export const DiffLine = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('hunk'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('context'), old: Schema.Number, new: Schema.Number, text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('added'),
    new: Schema.Number,
    text: Schema.String,
    changed: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literal('removed'),
    old: Schema.Number,
    text: Schema.String,
    changed: Schema.optional(Schema.Array(Schema.String)),
  }),
])
export type DiffLine = typeof DiffLine.Type

/**
 * Something a review of a task found, as it stands: what the reviewer said,
 * in which review, and what the lead did about it. `at` is where it points
 * in the task's change as it is now, its line carried past what changed
 * since the review read it; null where it points at no file of the change's
 * repositories (a picture, a check), or at one gone since.
 */
export const TaskFinding = Schema.Struct({
  id: Schema.String,
  /** The review that found it, by its attempt: what a review's report names. */
  review: Schema.String,
  /** The review round that found it, from 0. */
  round: Schema.Number,
  severity: Finding.fields.severity,
  /** The finding in a line, as its reviewer titled it; null from a reviewer that gave none. */
  title: Schema.NullOr(Schema.String),
  claim: Schema.String,
  /** Where the reviewer said, as it read the change. */
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
  at: Schema.NullOr(
    Schema.Struct({
      /** As the task's Changes view names it: with its repository's slug first, for a task of several. */
      path: Schema.String,
      /** Its line in the file now, from 1; null where the reviewer named the file alone. */
      line: Schema.NullOr(Schema.Number),
      /** The task changed the file since the review read it, the line it points at among what changed. */
      changed: Schema.Boolean,
      /** The task's change leaves the file as it was: it is in the change only because the finding names it. */
      untouched: Schema.Boolean,
    }),
  ),
  state: Schema.Literals(['open', 'fixed', 'set_aside']),
  /** The lead's words on it: what changed, for one fixed; why it stays, for one set aside. */
  reason: Schema.NullOr(Schema.String),
  /** The commit the lead said fixed it. */
  commit: Schema.NullOr(Schema.String),
})
export type TaskFinding = typeof TaskFinding.Type

/**
 * What the reviews of one of a task's runs found, oldest review first, each
 * review's in the reviewer's order; read from the store and git when asked
 * for. `review` is the review asked about, where one was and is known.
 */
export const TaskFindings = Schema.Struct({ findings: Schema.Array(TaskFinding), review: Schema.NullOr(Schema.String) })
export type TaskFindings = typeof TaskFindings.Type

/** One file's diff, read from git when asked for, never kept: its lines, cut short past a limit and saying so. */
export const FileDiff = Schema.Struct({
  file: ChangedFile,
  lines: Schema.Array(DiffLine),
  truncated: Schema.Boolean,
  /** The lines are the whole file, every one of it from its first, unchanged ones too; not one read in hunks. Where it is absent, they are not known to be. */
  whole: Schema.optional(Schema.Boolean),
})
export type FileDiff = typeof FileDiff.Type

/**
 * Where the code a thread's agent names is read from: a task's worktrees as
 * they are now, what isn't committed too; or, for the coordinator, each of
 * the project's repositories at its default branch, as this device last
 * fetched it. Each repository with its branch; where there are several, a
 * path starts with its repository's slug.
 */
export const CodePlace = Schema.Struct({
  kind: Schema.Literals(['task', 'default']),
  repositories: Schema.Array(Schema.Struct({ slug: Schema.String, name: Schema.String, branch: Schema.String })),
})
export type CodePlace = typeof CodePlace.Type

/**
 * A file a name in a message names, there: by its path as the place names
 * it, with the lines the name gave, if any. A name in code (`listEditors`)
 * names the one file that declares it, at that line. What its task changed
 * in it, against where the task's branch started; and, on the default branch,
 * how it was when the message was said, where it changed since, with where
 * the lines named are now (null: they were rewritten since).
 */
export const CodeFile = Schema.Struct({
  kind: Schema.Literal('file'),
  /** The name, as the agent wrote it. */
  name: Schema.String,
  path: Schema.String,
  line: Schema.optional(CodeLine),
  end: Schema.optional(CodeLine),
  /** The name in code it named, where it named one rather than the file. */
  symbol: Schema.optional(Schema.String),
  /** Found by its file's name alone: the one file of that name, or the one in a folder the message names. */
  byName: Schema.Boolean,
  bytes: Schema.Number,
  /** Its lines; none counted for what isn't text, or is too large to read. */
  lines: Schema.Number,
  /** Text to show; not text; or too large to read here. */
  content: Schema.Literals(['text', 'binary', 'large']),
  changed: Schema.NullOr(Schema.Struct({ add: Schema.Number, del: Schema.Number })),
  since: Schema.NullOr(
    Schema.Struct({
      /** The commit it was read at when said. */
      commit: Schema.String,
      /** When the message was said. */
      said: Schema.String,
      /** Where the lines named are now; null where they were rewritten since; absent where it named none. */
      now: Schema.optional(Schema.NullOr(Schema.Struct({ line: CodeLine, end: Schema.optional(CodeLine) }))),
    }),
  ),
})
export type CodeFile = typeof CodeFile.Type

/**
 * What a name in a message names: a file; a path that isn't there, with
 * files of nearly its name; or a file's name that several files have, which
 * the message doesn't tell apart. A name that is none of these, such as a
 * command or a word, isn't code, and isn't answered.
 */
export const CodeFound = Schema.Union([
  CodeFile,
  Schema.Struct({ kind: Schema.Literal('missing'), name: Schema.String, path: Schema.String, near: Schema.Array(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal('several'),
    name: Schema.String,
    line: Schema.optional(CodeLine),
    end: Schema.optional(CodeLine),
    paths: Schema.Array(Schema.String),
  }),
])
export type CodeFound = typeof CodeFound.Type

/** The most names one message is asked about, and the most messages at once. */
export const CODE_NAMES = { perMessage: 100, messages: 200 } as const

/** A file's text, whole, or past a size the lines around the one asked for: `from` is its first line's number, `total` how many it has. */
export const CodeText = Schema.Struct({
  path: Schema.String,
  text: Schema.String,
  from: CodeLine,
  total: Schema.Number,
  cut: Schema.Boolean,
  /** Asked for as a picture: its bytes in base64 and their kind, with no text. */
  image: Schema.optional(Schema.Struct({ type: Schema.String, data: Schema.String })),
})
export type CodeText = typeof CodeText.Type

/** A stretch of what a found task holds, in order: the words that matched what was asked for are `hit`. */
export const FoundPart = Schema.Struct({ text: Schema.String, hit: Schema.Boolean })
export type FoundPart = typeof FoundPart.Type

/**
 * A task found by what it was about (ADR-035): enough to show it in a list
 * and open it. Where it stands is read as its card's phase is, from the
 * store and the agents at work, never from git.
 */
export const FoundTask = Schema.Struct({
  taskId: Schema.String,
  /** Its own thread, which opens it. */
  threadId: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  phase: TaskPhase,
  /** As the store keeps it: draft, open, done or abandoned. */
  state: Schema.String,
  /** Its latest pull request, as its host writes it (#143, !12); null where it has none. */
  pullRequest: Schema.NullOr(Schema.String),
  /** When what it is found by last changed. */
  changedAt: Schema.String,
  /** What matched besides its title, a few words either side, ellipses where it was cut; null where only its title did, or nothing was asked for. */
  matched: Schema.NullOr(Schema.Array(FoundPart)),
})
export type FoundTask = typeof FoundTask.Type

/** The most a search finds at once. */
export const FOUND_MOST = 50

/** What a search found, best first. */
export const FoundTasks = Schema.Struct({ tasks: Schema.Array(FoundTask) })
export type FoundTasks = typeof FoundTasks.Type

const DocumentKind = Schema.Literals(['task', 'pull', 'issue', 'conversation', 'said', 'note'])

export const FinderQuery = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(500)),
  projectId: Schema.optional(Schema.String),
  kinds: Schema.optional(Schema.Array(DocumentKind).check(Schema.isMaxLength(6))),
  /** Find related documents that contain at least one of the search words. */
  matchAny: Schema.optional(Schema.Boolean),
})
export type FinderQuery = typeof FinderQuery.Type

/** Local documents found by search. The original catalog is still paged. */
export const SearchDocument = Schema.Struct({
  id: Schema.String,
  kind: DocumentKind,
  projectId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  itemId: Schema.NullOr(Schema.String),
  title: Schema.String,
  body: Schema.String,
  ref: Schema.String,
  url: Schema.NullOr(Schema.String),
  changedAt: Schema.String,
  state: Schema.String,
})
export type SearchDocument = typeof SearchDocument.Type
export const SearchDocuments = Schema.Struct({
  documents: Schema.Array(SearchDocument),
  next: Schema.NullOr(Schema.String),
  indexed: Schema.optional(Schema.Boolean),
  indexing: Schema.optional(Schema.Boolean),
})
export type SearchDocuments = typeof SearchDocuments.Type

/**
 * Finding and reading what work touched: searching tasks, documents and files, and the code a thread names.
 * A task's diff, its review findings and the line comments on it.
 */
export const SearchApi = RpcGroup.make(
  /**
   * Finds tasks by what they were about: their titles, what the person asked,
   * what their leads reported and built, their pull requests' numbers and
   * issues' keys, their branches, and the files their leads changed. In one
   * project, or every one still in the window; each word typed finds the
   * words it begins, and every word must be found. Best first, recent first
   * among equals; with nothing typed, the most recently changed.
   */
  call(
    'SearchTasks',
    {
      projectId: Schema.optional(Schema.String),
      text: Schema.String.check(Schema.isMaxLength(500)),
      limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: FOUND_MOST }))),
    },
    FoundTasks,
  ),
  call('GetSearchDocuments', { after: Schema.optional(Schema.String), search: Schema.optional(FinderQuery) }, SearchDocuments),
  call('GetSearchFiles', { threadId: Schema.String }, Schema.Struct({ files: Schema.Array(Schema.String) })),
  /** One file a task changed, as a diff from its base to its worktree. */
  /**
   * One file a task changed, as a diff from its base to its worktree; with
   * `untouched`, a file it left as it was, every line of it unchanged, as a
   * review's finding may name one.
   */
  call('GetFileDiff', { taskId: Schema.String, path: Schema.String, untouched: Schema.optional(Schema.Boolean) }, FileDiff),
  /**
   * What the reviews of a task's run found, each where it is in the change
   * now and what became of it: the run of the review whose report is
   * `review`, a thread item; without it, the latest run that found anything.
   */
  call('GetTaskFindings', { taskId: Schema.String, review: Schema.optional(Schema.String) }, TaskFindings),
  /**
   * The comments the person sent on lines of a task's diff (decisions: desktop-app § Comments on the diff), each
   * where its lines are in the change now, and addressed once a commit since
   * it was made changed them.
   */
  call('GetLineComments', { taskId: Schema.String }, TaskLineComments),
  /**
   * What the names in a thread's messages name, where its agent works
   * (CodePlace): for each message, by the item it is where it has one, so
   * it is read as it was when it was said, what its names are.
   */
  call(
    'FindCode',
    {
      threadId: Schema.String,
      messages: Schema.Array(
        Schema.Struct({
          itemId: Schema.optional(Schema.String),
          names: Schema.Array(Schema.String.check(Schema.isMaxLength(300))).check(Schema.isMaxLength(CODE_NAMES.perMessage)),
        }),
      ).check(Schema.isMaxLength(CODE_NAMES.messages)),
    },
    Schema.Struct({ place: CodePlace, messages: Schema.Array(Schema.Struct({ found: Schema.Array(CodeFound) })) }),
  ),
  /**
   * A file where a thread's agent works, by its path as FindCode named it:
   * as it is now, or at the commit it was when a message was said. Whole,
   * or past a size, the lines around `line`. With `image`, a picture a task's
   * markdown file names beside it, as it is now: only an image, only from
   * inside the task's folders, and not past a size.
   */
  call(
    'ReadCode',
    {
      threadId: Schema.String,
      path: Schema.String,
      commit: Schema.optional(Schema.String),
      line: Schema.optional(CodeLine),
      image: Schema.optional(Schema.Boolean),
    },
    CodeText,
  ),
).middleware(ClientAuthority)
