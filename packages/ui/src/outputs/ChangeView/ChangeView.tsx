import { Dialog } from 'radix-ui'
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Path } from '../../primitives/Path/Path'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { Problem } from '../../primitives/Problem/Problem'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { Diff, type DiffLine, type DiffNote, type DiffPick } from '../../thread/Diff/Diff'
import {
  folderOfPath,
  hasMarks,
  isMarkdownPath,
  markChanges,
  type MarkedMarkdown,
  nextWay,
  type PageWay,
  unmarked,
} from '../../thread/Markdown/changes'
import { Markdown } from '../../thread/Markdown/Markdown'
import { FindingNote, heavyWeight, type NotedFinding } from '../../thread/Reviewer/FindingNote'
import type { FindingWeight } from '../../thread/Reviewer/Reviewer'
import {
  type CommentedLines,
  LineCommentBox,
  LineCommentNote,
  type LineCommentsText,
  lineCommentsText,
  pickedLines,
  type ViewedComment,
} from '../LineComments/LineComments'
import s from './ChangeView.module.css'

/*
 * What a task changed, file by file, over the whole window: the files on the
 * left, with how each changed and how much, and the one you're on as a diff
 * beside them. What isn't committed yet says so, since only commits are
 * pushed. Escape closes it; j and k, or the arrows, go through the files.
 *
 * A markdown file opens as a page with what the change added tinted and what
 * it took out drawn where it was (Changes); Rendered is the page as it is now,
 * with nothing marked, and Source is its diff, as any file's. M goes through
 * them. A finding's line is in the source, so the file a finding is
 * jumped to opens there.
 *
 * With a review's findings, each is a note under the line it is about, and
 * the files they name come first, worst finding first, each saying how many
 * it has; one the change left alone is listed too, as is what isn't about a
 * file at all. [ and ] go from finding to finding, worst first.
 *
 * Where the person can comment (DEV-175), a line's number picks it, Shift
 * with it a range, and a box under the lines takes what they say. Those
 * waiting to go are notes under their lines, numbered as the composer's
 * chips are, until Send takes them to the lead in one message; sent ones
 * stay there, stepping back once a commit addresses them.
 */

/** A comment the person wrote on lines of a file, to gather. */
export interface NewComment extends CommentedLines {
  readonly path: string
  readonly note: string
}

/** How a file changed. */
export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface ViewedFile {
  path: string
  /** Where it was, for a file that moved. */
  from?: string | null
  status: ChangedFileStatus
  add: number
  del: number
  binary?: boolean
  /** Some of its change isn't committed yet. */
  uncommitted?: boolean
  /** Made by a tool, not written: a lockfile, a snapshot, a build's output. It goes last, its diff folded until asked for. */
  generated?: boolean
  /** Left as it was by the change: listed because a finding names it. */
  untouched?: boolean
}

/** A review's finding, where it is in the change now. */
export interface ViewedFinding extends NotedFinding {
  /** The file it is about, as the list names it; null for one about no file of the change. */
  path: string | null
  /** The line of that file it is about now; null where it names the file alone. */
  line: number | null
}

/** The file you're on: its diff while it's read, once it's read, or why it couldn't be. */
export type FileView =
  | { state: 'loading' }
  | { state: 'failed'; message?: string }
  | {
      state: 'ready'
      lines: readonly DiffLine[]
      truncated?: boolean
      /** The lines are the whole file, every one of it and the unchanged ones too, as a page needs; one read in hunks, or cut short, is not. */
      whole?: boolean
    }

export interface ChangeViewText {
  title: string
  close: string
  closeKey: string
  files: (count: number) => string
  /** Where the change goes: `branch into main`. */
  into: (branch: string, base: string) => string
  status: Record<Exclude<ChangedFileStatus, 'modified'>, string>
  movedFrom: (from: string) => string
  uncommitted: string
  uncommittedNote: string
  binary: string
  moved: (from: string) => string
  empty: string
  loading: string
  failed: string
  tryAgain: string
  truncated: string
  list: string
  /** Where generated files are listed, after the rest. */
  generatedList: string
  generated: (add: number, del: number) => string
  showGenerated: string
  /** What became of a review's findings: `3 open, 2 fixed, 1 kept`. */
  findingsSum: (open: number, fixed: number, kept: number) => string
  findingCount: (count: number) => string
  /** Where findings about no file of the change are. */
  loose: string
  untouched: string
  /** Sends the comments waiting to go, to the lead in one message. */
  send: (count: number) => string
  commentCount: (count: number) => string
  /** Comments whose lines are gone from the file. */
  commentsGone: string
  comments: Partial<LineCommentsText>
  /** A markdown file's ways to show: as a page; as a page with its change marked; or as its diff. */
  show: string
  rendered: string
  renderedTip: string
  changes: string
  changesTip: string
  source: string
  sourceTip: string
  /** The key between them. */
  showKey: string
}

export const changeViewText: ChangeViewText = {
  title: 'Changes',
  close: 'Close',
  closeKey: 'esc',
  files: (count) => (count === 1 ? '1 file' : `${count} files`),
  into: (branch, base) => `${branch} into ${base}`,
  status: { added: 'New', deleted: 'Deleted', renamed: 'Moved' },
  movedFrom: (from) => `from ${from}`,
  uncommitted: 'Not committed',
  uncommittedNote: 'Not committed yet. Althar pushes commits only, so this part isn’t in what it pushes.',
  binary: 'A binary file. Its contents aren’t shown.',
  moved: (from) => `Moved from ${from}, with nothing else changed.`,
  empty: 'Nothing has changed yet.',
  loading: 'Reading the diff',
  failed: 'Althar couldn’t read this file’s diff.',
  tryAgain: 'Try again',
  truncated: 'Cut short here. The rest is in the file.',
  list: 'Changed files',
  generatedList: 'Generated',
  generated: (add, del) => `Made by a tool, not written: ${add} lines added, ${del} removed. Its diff is folded.`,
  showGenerated: 'Show the diff',
  findingsSum: (open, fixed, kept) =>
    [open > 0 && `${open} open`, fixed > 0 && `${fixed} fixed`, kept > 0 && `${kept} kept`].filter(Boolean).join(', '),
  findingCount: (count) => (count === 1 ? '1 finding' : `${count} findings`),
  loose: 'Not in the code',
  untouched: 'Unchanged',
  send: (count) => (count === 1 ? 'Send 1 comment' : `Send ${count} comments`),
  commentCount: (count) => (count === 1 ? '1 comment' : `${count} comments`),
  commentsGone: 'Their lines aren’t in this file’s change any more.',
  comments: {},
  show: 'Show',
  rendered: 'Rendered',
  renderedTip: 'As a page',
  changes: 'Changes',
  changesTip: 'As a page, with what changed marked',
  source: 'Source',
  sourceTip: 'The diff',
  showKey: 'm',
}

/** What the host gives a markdown file's images and links: the files it names beside it, by their paths as the list names them. */
export interface ChangeViewMarkdown {
  /** Draws an image the file names. Without it, an image's words stand in. */
  image?: (image: { readonly path: string; readonly alt: string; readonly title?: string }) => ReactNode
  /** Opens a file the file links to that the change doesn't hold (one it does is picked here). Without it, a link is only its words. */
  open?: (path: string) => void
}

export interface ChangeViewProps {
  /** The task's branch, and the branch it goes into. */
  branch: string
  base?: string
  files: readonly ViewedFile[]
  /** The file you're on; with none, the first. */
  selected: string | null
  onSelect: (path: string) => void
  /** The selected file's diff. */
  view: FileView
  onRetry?: () => void
  onClose: () => void
  /** A review's findings, each under its line. */
  findings?: readonly ViewedFinding[]
  /** The finding you're on: its file is the one selected, unless it is about none. */
  finding?: string | null
  /** Goes to a finding: [ and ], or a note picked. */
  onFinding?: (id: string) => void
  /** The person's comments on its lines (DEV-175): those waiting to go, those sent, and those addressed since. */
  comments?: readonly ViewedComment[]
  /** The comment opened from the thread: its file is the one selected. */
  comment?: string | null
  /** Takes a comment written on lines picked. Without it, lines can't be picked. */
  onComment?: (comment: NewComment) => void
  /** Next number in the thread’s composer, which can also have page or canvas comments. */
  nextCommentNumber?: number
  /** Changes what one waiting to go says. */
  onEditComment?: (id: string, note: string) => void
  /** Takes one waiting to go off. */
  onRemoveComment?: (id: string) => void
  /** Sends those waiting to go to the lead, in one message. */
  onSendComments?: () => void
  /** They are on their way. */
  sendingComments?: boolean
  /** What else opens it, beside Close: an editor, at the file. */
  actions?: ReactNode
  /** What a markdown file's images and links need of the host. */
  markdown?: ChangeViewMarkdown
  /**
   * space: the system draws its lights over the window's top row, as on
   * macOS, so the view stays below that row; none: it may reach the top.
   */
  lights?: 'space' | 'none'
  text?: Partial<ChangeViewText>
}

/** Lines added and removed, each only when there are some: a moved or binary file shows none. */
const counts = (add: number, del: number) => ({ ...(add > 0 ? { add } : {}), ...(del > 0 ? { del } : {}) })

const WEIGHTS: readonly FindingWeight[] = ['blocking', 'major', 'minor', 'nit']

/** Worst first; within a weight, as the reviewer gave them. */
export const worstFirst = <T extends { readonly weight: FindingWeight }>(findings: readonly T[]): T[] =>
  findings.toSorted((a, b) => WEIGHTS.indexOf(a.weight) - WEIGHTS.indexOf(b.weight))

/** A task's change over the whole window. A modal dialog: mount it to open it. */
export function ChangeView({
  branch,
  base,
  files: given,
  selected,
  onSelect,
  view,
  onRetry,
  onClose,
  findings: raised = [],
  finding = null,
  onFinding,
  comments = [],
  comment = null,
  onComment,
  nextCommentNumber,
  onEditComment,
  onRemoveComment,
  onSendComments,
  sendingComments = false,
  actions,
  markdown,
  lights = 'none',
  text,
}: ChangeViewProps) {
  const t = { ...changeViewText, ...text }
  const waiting = comments.filter((one) => one.state === 'draft')
  const findings = worstFirst(raised)
  const loose = findings.filter((one) => one.path === null)
  // The files the findings name first, worst finding first; then what was written, then what a tool made: the eye starts on the work.
  const named = [...new Set(findings.flatMap((one) => (one.path === null ? [] : [one.path])))].flatMap((path) =>
    given.filter((file) => file.path === path),
  )
  const rest = given.filter((file) => !named.includes(file))
  const written = rest.filter((file) => file.generated !== true)
  const made = rest.filter((file) => file.generated === true)
  const files = [...named, ...written, ...made]
  const madeFrom = named.length + written.length
  const detached = waiting.filter((one) => !files.some((file) => file.path === one.path)).map((one) => ({ ...one, line: null }))
  const detachedNotes = <EarlierLineNotes comments={detached} current={comment} text={t.comments} onRemove={onRemoveComment} showPath />
  const current = files.find((file) => file.path === selected) ?? files[0]
  const on = findings.find((one) => one.id === finding)
  // How each markdown file is shown, where the person chose: a page, a page with its change marked, or its diff.
  const [chosen, setChosen] = useState<ReadonlyMap<string, PageWay>>(new Map())
  // On what isn't about a file: where the finding you're on is about none, until a file is picked.
  const [apart, setApart] = useState(on !== undefined && on.path === null)
  const [goneTo, setGoneTo] = useState(finding)
  if (goneTo !== finding) {
    setGoneTo(finding)
    if (on !== undefined) setApart(on.path === null)
    // A finding's note sits under a line of the file's source: going to one opens it there, whatever way the file was shown.
    if (on?.path != null) setChosen((now) => new Map(now).set(on.path ?? '', 'source'))
  }
  // With no file to be on, what isn't about one is all there is to show.
  const showingLoose = loose.length > 0 && (apart || current === undefined)
  const notes: readonly DiffNote[] = findings
    .filter((one) => one.path !== null && one.path === current?.path)
    .map((one) => ({
      key: one.id,
      line: one.line ?? 1,
      node: <FindingNote finding={one} current={one.id === finding} {...(onFinding === undefined ? {} : { onPick: onFinding })} />,
    }))
  const open = findings.filter((one) => one.state === 'open').length
  const fixed = findings.filter((one) => one.state === 'fixed').length
  const add = files.reduce((sum, file) => sum + file.add, 0)
  const del = files.reduce((sum, file) => sum + file.del, 0)
  // A markdown file as a page, unless asked for as its diff (or a finding's note is in it, which sits under a diff's line).
  const markdownFile = current !== undefined && isMarkdownPath(current.path) && current.binary !== true && current.generated !== true
  const marked =
    markdownFile && view.state === 'ready' && view.whole === true && view.truncated !== true && view.lines.length > 0
      ? markChanges(view.lines)
      : null
  // Its change marked, where it has one to mark: a file that is new is only a page, and one that is gone only what it took out.
  const ways: readonly PageWay[] = !hasMarks(marked)
    ? ['rendered', 'source']
    : current?.status === 'deleted'
      ? ['changes', 'source']
      : ['rendered', 'changes', 'source']
  const commentedPath = comments.find((one) => one.id === comment)?.path
  const [openedComment, setOpenedComment] = useState(comment)
  if (openedComment !== comment) {
    setOpenedComment(comment)
    if (commentedPath !== undefined) setChosen((now) => new Map(now).set(commentedPath, 'source'))
  }
  const wanted =
    current === undefined
      ? undefined
      : (chosen.get(current.path) ?? (current.path === commentedPath || notes.some((note) => note.key === finding) ? 'source' : 'changes'))
  const way = wanted === undefined ? undefined : ways.includes(wanted) ? wanted : ways[0]
  const page = marked === null || way === 'source' ? null : way === 'changes' ? marked : unmarked(marked)
  const show = (next: PageWay) => {
    if (current !== undefined) setChosen(new Map(chosen).set(current.path, next))
  }
  const code = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  // A new file starts at its top.
  useEffect(() => {
    if (code.current !== null) code.current.scrollTop = 0
  }, [current?.path])

  const step = (by: number) => {
    if (current === undefined) return
    const next = files[files.indexOf(current) + by]
    if (next !== undefined) pick(next.path)
  }
  const pick = (path: string) => {
    setApart(false)
    onSelect(path)
  }
  // From finding to finding, worst first: to its file, or to what isn't about one.
  const goFinding = (by: number) => {
    const at = findings.findIndex((one) => one.id === finding)
    const next = findings[at === -1 ? (by > 0 ? 0 : findings.length - 1) : at + by]
    if (next === undefined) return
    onFinding?.(next.id)
    if (next.path === null) setApart(true)
    else {
      setApart(false)
      if (next.path !== current?.path) onSelect(next.path)
    }
  }
  const keys = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    // Keys a menu opened from it handled, bubbling here through its portal, aren't the view's.
    if (event.defaultPrevented || !(dialog.current?.contains(target) ?? false)) return
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA'
    )
      return
    if (event.key === 'j' || event.key === 'ArrowDown') step(1)
    else if (event.key === 'k' || event.key === 'ArrowUp') step(-1)
    else if (event.key === ']' && findings.length > 0) goFinding(1)
    else if (event.key === '[' && findings.length > 0) goFinding(-1)
    else if (event.key === t.showKey && marked !== null && way !== undefined) show(nextWay(ways, way))
    else return
    event.preventDefault()
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          ref={dialog}
          className={cx('ch-root', s.dialog, lights === 'space' && s.underLights)}
          aria-describedby={undefined}
          onKeyDown={keys}
          // Escape in a comment's box leaves the box, not the view.
          onEscapeKeyDown={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-own-escape]') !== null) event.preventDefault()
          }}
          // The view itself takes focus, where j and k work, rather than its close button.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            dialog.current?.focus()
          }}
        >
          <header className={s.head}>
            <Dialog.Title className={s.title}>{t.title}</Dialog.Title>
            <span className={s.branch}>{base ? t.into(branch, base) : branch}</span>
            <span className={s.sum}>
              {t.files(files.filter((file) => file.untouched !== true).length)}
              <Delta {...counts(add, del)} />
            </span>
            {findings.length > 0 && <span className={s.sum}>{t.findingsSum(open, fixed, findings.length - open - fixed)}</span>}
            {(actions !== undefined || (waiting.length > 0 && onSendComments !== undefined)) && (
              <span className={s.actions}>
                {waiting.length > 0 && onSendComments !== undefined && (
                  <Button variant="signal" size="small" busy={sendingComments} onClick={onSendComments}>
                    {t.send(waiting.length)}
                  </Button>
                )}
                {actions}
              </span>
            )}
            <Dialog.Close asChild>
              <ActionButton
                icon="close"
                kbd={t.closeKey}
                className={cx(s.close, (actions !== undefined || (waiting.length > 0 && onSendComments !== undefined)) && s.closeAfter)}
              >
                {t.close}
              </ActionButton>
            </Dialog.Close>
          </header>
          {current === undefined && loose.length === 0 ? (
            detached.length > 0 ? (
              detachedNotes
            ) : (
              <p className={s.empty}>{t.empty}</p>
            )
          ) : (
            <div className={s.body}>
              <nav className={s.files} aria-label={t.list}>
                <ul>
                  {loose.length > 0 && (
                    <li>
                      <button
                        type="button"
                        className={cx(s.file, showingLoose && s.on)}
                        aria-current={showingLoose ? 'true' : undefined}
                        onClick={() => setApart(true)}
                      >
                        <span className={s.path}>{t.loose}</span>
                        <FindingMark here={loose} t={t} />
                      </button>
                    </li>
                  )}
                  {files.map((file, index) => {
                    const on = !showingLoose && file.path === current?.path
                    const status = file.untouched === true ? t.untouched : file.status === 'modified' ? null : t.status[file.status]
                    const here = findings.filter((one) => one.path === file.path)
                    const said = comments.filter((one) => one.path === file.path && one.state !== 'addressed').length
                    return (
                      <li key={file.path}>
                        {index === madeFrom && madeFrom > 0 && <p className={s.group}>{t.generatedList}</p>}
                        <button
                          type="button"
                          className={cx(s.file, on && s.on, file.generated === true && s.made)}
                          aria-current={on ? 'true' : undefined}
                          onClick={() => pick(file.path)}
                        >
                          <Path path={file.path} className={s.path} dirClassName={s.dir} />
                          <Delta {...counts(file.add, file.del)} className={s.delta} />
                          {(status !== null || file.uncommitted) && (
                            <span className={s.meta}>
                              {[status, file.uncommitted ? t.uncommitted : null].filter((part) => part !== null).join(' · ')}
                            </span>
                          )}
                          {here.length > 0 && <FindingMark here={here} t={t} />}
                          {said > 0 && <span className={s.mark}>{t.commentCount(said)}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </nav>
              {showingLoose || current === undefined ? (
                <section className={s.code} ref={code} aria-label={t.loose}>
                  <div className={s.fileHead}>
                    <span className={s.filePath}>{t.loose}</span>
                  </div>
                  {detachedNotes}
                  <div className={s.apart}>
                    {loose.map((one) => (
                      <FindingNote
                        key={one.id}
                        finding={one}
                        current={one.id === finding}
                        {...(onFinding === undefined ? {} : { onPick: onFinding })}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <section className={s.code} ref={code} aria-label={current.path}>
                  <div className={s.fileHead}>
                    <span className={s.filePath}>{current.path}</span>
                    {current.from && <span className={s.from}>{t.movedFrom(current.from)}</span>}
                    {marked !== null && (
                      <Segmented<PageWay>
                        label={t.show}
                        value={way ?? 'rendered'}
                        onChange={show}
                        className={s.ways}
                        options={ways.map((one) => ({
                          value: one,
                          label: t[one],
                          tooltip: {
                            label: one === 'rendered' ? t.renderedTip : one === 'changes' ? t.changesTip : t.sourceTip,
                            kbd: t.showKey,
                          },
                        }))}
                      />
                    )}
                  </div>
                  {detachedNotes}
                  {current.uncommitted && <p className={s.note}>{t.uncommittedNote}</p>}
                  <FileBody
                    key={current.path}
                    file={current}
                    view={view}
                    notes={notes}
                    comments={comments.filter((one) => one.path === current.path)}
                    comment={comment}
                    next={nextCommentNumber ?? waiting.length + 1}
                    page={page}
                    {...(markdown === undefined ? {} : { markdown })}
                    onOpen={pick}
                    has={(path) => files.some((file) => file.path === path && file.untouched !== true)}
                    t={t}
                    {...(onRetry === undefined ? {} : { onRetry })}
                    {...(onComment === undefined ? {} : { onComment })}
                    {...(onEditComment === undefined ? {} : { onEditComment })}
                    {...(onRemoveComment === undefined ? {} : { onRemoveComment })}
                  />
                </section>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Under a file's name in the list: how many findings it has, warm while a heavy one is open, ticked once all are settled. */
function FindingMark({ here, t }: { here: readonly ViewedFinding[]; t: ChangeViewText }) {
  const open = here.filter((one) => one.state === 'open')
  return (
    <span className={open.some((one) => heavyWeight(one.weight)) ? s.markHeavy : s.mark}>
      {t.findingCount(here.length)}
      {open.length === 0 && <Icon name="check" size={11} />}
    </span>
  )
}

function FileBody({
  file,
  view,
  notes: found,
  comments,
  comment,
  next,
  page,
  markdown,
  onOpen,
  has,
  t,
  onRetry,
  onComment,
  onEditComment,
  onRemoveComment,
}: {
  file: ViewedFile
  view: FileView
  notes: readonly DiffNote[]
  comments: readonly ViewedComment[]
  comment: string | null
  /** The number a new comment gets. */
  next: number
  /** A markdown file as a page, with what of its change is marked; null where it shows as its diff. */
  page: MarkedMarkdown | null
  markdown?: ChangeViewMarkdown
  /** Picks a file of the change, where a markdown page links to it. */
  onOpen: (path: string) => void
  /** Whether a path is a file of the change. */
  has: (path: string) => boolean
  t: ChangeViewText
  onRetry?: () => void
  onComment?: (comment: NewComment) => void
  onEditComment?: (id: string, note: string) => void
  onRemoveComment?: (id: string) => void
}) {
  // The lines picked to comment on, by their place in the lines they were picked in: from the line first picked to the
  // one last picked, Shift moving the last. Lines read again, as the change moves, leave nothing picked, so a comment is
  // never made on lines other than those it showed. And the comment waiting to go that is open again in its box.
  const lines = view.state === 'ready' ? view.lines : []
  const [picking, setPicking] = useState<{ readonly lines: readonly DiffLine[]; readonly anchor: number; readonly focus: number } | null>(
    null,
  )
  const [editing, setEditing] = useState<string | null>(null)
  const pick: DiffPick | null =
    picking === null || picking.lines !== lines
      ? null
      : { from: Math.min(picking.anchor, picking.focus), to: Math.max(picking.anchor, picking.focus) }
  const setPick = (next: null) => setPicking(next)
  const picked = pick === null ? null : pickedLines(lines, pick)
  const onPick =
    onComment === undefined
      ? undefined
      : (at: number, extend: boolean) => {
          setEditing(null)
          setPicking((now) => {
            const current = now !== null && now.lines === lines ? now : null
            if (extend && current !== null) return { ...current, focus: at }
            return current?.anchor === at && current.focus === at ? null : { lines, anchor: at, focus: at }
          })
        }
  const ct = { ...lineCommentsText, ...t.comments }
  const said: DiffNote[] = comments.flatMap((one) =>
    one.line === null
      ? []
      : [
          {
            key: `comment-${one.id}`,
            line: one.line,
            old: one.side === 'old',
            node:
              editing === one.id && onEditComment !== undefined ? (
                <LineCommentBox
                  lines={ct.lines(one.side, one.start, one.end)}
                  n={one.n ?? next}
                  defaultValue={one.note}
                  existing
                  text={t.comments}
                  onSubmit={(note) => {
                    onEditComment(one.id, note)
                    setEditing(null)
                  }}
                  onCancel={() => setEditing(null)}
                  {...(onRemoveComment === undefined
                    ? {}
                    : {
                        onRemove: () => {
                          onRemoveComment(one.id)
                          setEditing(null)
                        },
                      })}
                />
              ) : (
                <LineCommentNote
                  comment={one}
                  current={one.id === comment}
                  text={t.comments}
                  {...(one.state === 'draft' && onEditComment !== undefined ? { onEdit: () => setEditing(one.id) } : {})}
                  {...(one.state === 'draft' && onRemoveComment !== undefined ? { onRemove: () => onRemoveComment(one.id) } : {})}
                />
              ),
          },
        ],
  )
  const box: DiffNote[] =
    pick === null || picked === null || onComment === undefined
      ? []
      : [
          {
            key: 'comment-new',
            line: 0,
            at: Math.max(pick.from, pick.to),
            node: (
              <LineCommentBox
                lines={ct.lines(picked.side, picked.start, picked.end)}
                n={next}
                text={t.comments}
                onSubmit={(note) => {
                  onComment({ path: file.path, ...picked, note })
                  setPick(null)
                }}
                onCancel={() => setPick(null)}
              />
            ),
          },
        ]
  const notes = [...found, ...said, ...box]
  // Comments whose lines are gone from the file's change: above it, saying so.
  const gone = (
    <EarlierLineNotes
      comments={comments.filter((one) => one.line === null)}
      current={comment}
      text={t.comments}
      onRemove={onRemoveComment}
      caption={t.commentsGone}
    />
  )
  // A generated file's diff stays folded until asked for: its lines are a tool's, not the work's.
  const [shown, setShown] = useState(file.generated !== true || notes.length > 0 || comments.length > 0)
  // Where there are no lines to put them under, the notes go first.
  const alone = notes.length > 0 && (
    <div className={s.apart}>
      {notes.map((note) => (
        <div key={note.key}>{note.node}</div>
      ))}
    </div>
  )
  if (file.binary)
    return (
      <>
        {gone}
        {alone}
        <p className={s.quiet}>{t.binary}</p>
      </>
    )
  if (!shown)
    return (
      <div className={s.made}>
        <p className={s.quiet}>{t.generated(file.add, file.del)}</p>
        <Button size="small" onClick={() => setShown(true)}>
          {t.showGenerated}
        </Button>
      </div>
    )
  switch (view.state) {
    case 'loading':
      return (
        <>
          {gone}
          <p className={s.quiet}>
            <Spinner size="small" />
            {t.loading}
          </p>
        </>
      )
    case 'failed':
      return (
        <>
          {gone}
          {alone}
          <div className={s.failed}>
            <Problem
              as="div"
              banner
              {...(onRetry === undefined
                ? {}
                : {
                    action: (
                      <Button size="small" onClick={onRetry}>
                        {t.tryAgain}
                      </Button>
                    ),
                  })}
            >
              {view.message ?? t.failed}
            </Problem>
          </div>
        </>
      )
    case 'ready':
      if (view.lines.length === 0)
        return (
          <>
            {gone}
            {alone}
            <p className={s.quiet}>{file.from ? t.moved(file.from) : t.empty}</p>
          </>
        )
      if (page !== null)
        return (
          <>
            {gone}
            {alone}
            <Markdown
              source={page.source}
              marks={page.marks}
              size="panel"
              className={s.page}
              file={{
                folder: folderOfPath(file.path),
                ...(markdown?.image === undefined ? {} : { image: markdown.image }),
                ...(markdown?.open === undefined ? {} : { open: (path: string) => (has(path) ? onOpen(path) : markdown.open?.(path)) }),
              }}
            />
          </>
        )
      return (
        <>
          {gone}
          <Diff
            lines={view.lines}
            label={file.path}
            path={file.path}
            oldNumbers
            fold={3}
            notes={notes}
            className={s.diff}
            {...(onPick === undefined ? {} : { onPick, picked: pick })}
          />
          {view.truncated && <p className={s.quiet}>{t.truncated}</p>}
        </>
      )
  }
}

function EarlierLineNotes({
  comments,
  current,
  text,
  onRemove,
  showPath,
  caption,
}: {
  comments: readonly ViewedComment[]
  current: string | null
  text: Partial<LineCommentsText>
  onRemove: ((id: string) => void) | undefined
  showPath?: boolean
  caption?: string
}) {
  if (comments.length === 0) return null
  return (
    <div className={s.apart}>
      {caption !== undefined && <p className={s.note}>{caption}</p>}
      {comments.map((one) => (
        <LineCommentNote
          key={one.id}
          comment={one}
          current={one.id === current}
          text={text}
          {...(showPath === true ? { showPath: true } : {})}
          {...(one.state === 'draft' && onRemove !== undefined ? { onRemove: () => onRemove(one.id) } : {})}
        />
      ))}
    </div>
  )
}
