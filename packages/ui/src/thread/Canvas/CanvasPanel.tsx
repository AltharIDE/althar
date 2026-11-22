import { createPortal } from 'react-dom'
import { type ReactNode, type Ref, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { Problem } from '../../primitives/Problem/Problem'
import { SidePanel, SidePanelTitle, sidePanelText, type SidePanelText } from '../../primitives/SidePanel/SidePanel'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { type CanvasKind, canvasKindWords } from './canvas'
import s from './Canvas.module.css'

/*
 * One of the project's canvases beside the conversation (ADR-104), on the
 * workbench: its title and the version shown, with who published it and
 * what it changed; a step back and on through its versions; Comment, which
 * writes a note on the canvas, or on the words selected in a document, that
 * waits in the composer with the person's next message, as a comment on a
 * page does; and the comments already sent on it. What is on it (a
 * document, a diagram, a picture or a page) is the host's to draw, as wide
 * as the panel. A version the person reads stays while a newer one is
 * published: the bar says so, with Show. Its host adds what the artifact
 * offers beside Comment (saving it to a repository, downloading it), a bar of
 * its own under what is on it (a canvas of boards'), and a way back to where
 * it was opened from.
 */

export interface CanvasPanelText extends SidePanelText {
  version: (n: number, of: number) => string
  older: string
  newer: string
  latest: string
  /** A newer version is out while an older one shows. */
  newerOut: (n: number) => string
  show: string
  notLatest: string
  comment: string
  commentOn: (version: number) => string
  commentOnWords: (words: string) => string
  add: string
  sent: (n: number) => string
  answered: string
  /** A comment's pin on a board, by its number. */
  pin: (n: number) => string
  onVersion: (n: number) => string
  reload: string
  kinds: Readonly<Record<CanvasKind, string>>
  /** The canvas couldn't be read, before its words. */
  failed: string
}

export const canvasPanelText: CanvasPanelText = {
  ...sidePanelText,
  version: (n, of) => (n === of ? `v${n}` : `v${n} of ${of}`),
  older: 'Older version',
  newer: 'Newer version',
  latest: 'Latest',
  newerOut: (n) => `v${n} is out`,
  show: 'Show',
  notLatest: 'Not the latest',
  comment: 'Comment',
  commentOn: (version) => `Comment on v${version}`,
  commentOnWords: (words) => `Comment on “${words}”`,
  add: 'Add to message',
  sent: (n) => (n === 1 ? '1 comment' : `${n} comments`),
  answered: 'Answered',
  pin: (n) => `Pin ${n}`,
  onVersion: (n) => `on v${n}`,
  reload: 'Load again',
  kinds: canvasKindWords,
  failed: 'Althar couldn’t read this canvas.',
}

/** A comment the person sent on the canvas, as its list under the canvas shows it. */
export interface CanvasPanelComment {
  readonly id: string
  readonly version: number
  readonly body: string
  /** Where it points, in words: “Whole canvas”, the words it is on. */
  readonly place: string
  readonly answered: boolean
  /** What the agent that answered it said, where it said something. */
  readonly answer?: string | null
  /** Its pin's number, where it is pinned to a part of a board. */
  readonly n?: number | null
}

export interface CanvasPanelProps {
  name: string
  title: string
  /** The version shown, and the latest there is. */
  version: number
  latest: number
  /** Shows another version; without it, the versions don't step. */
  onVersion?: (version: number) => void
  /**
   * A newer version came while this one shows: the bar says so, with Show.
   * Null where the one shown follows the latest, or is it.
   */
  newer?: number | null
  /**
   * Writes a comment on the version shown: on the words selected in it as Comment was pressed (`on`), else on the whole
   * canvas. The words are kept as it opens, so typing the comment, which moves the selection, doesn't change what it is on.
   */
  onComment?: (body: string, on: string | null) => void
  /** The words selected in the canvas, which a comment would be on; null for none. */
  selected?: string | null
  /** Comments already sent on the canvas, any version. */
  comments?: ReadonlyArray<CanvasPanelComment>
  /** Loads the page again, for a page canvas. */
  onReload?: () => void
  /** What else the artifact offers, before Comment: saving it to a repository, downloading it. */
  extra?: ReactNode
  /** A bar of its own under what is on it: a canvas of boards' pages, view, tools and zoom. */
  bar?: ReactNode
  /** Back to where it was opened from, such as every artifact of the project. */
  onBack?: () => void
  /**
   * Where its head is someone else's, as in an artifact's room, whose one top row is the artifact's: the panel draws no
   * head of its own, and its versions and actions go in this element (null while it is being laid out).
   */
  actionsIn?: Element | null
  /** With `actionsIn`, where the row isn't the artifact's own (a task's): its name before its actions, and its close after. */
  titled?: boolean
  /** With `titled`, its name opens the artifact itself. */
  onTitle?: () => void
  /** A comment in the list pressed: its pin shows on its part. */
  onCommentPick?: (id: string) => void
  onClose: () => void
  /** What is on it: the host draws it, as wide as the panel. */
  children?: ReactNode
  /** What is on it fills the panel, edge to edge, rather than scrolling at reading width: a page, a picture. */
  fill?: boolean
  loading?: boolean
  error?: string
  text?: Partial<CanvasPanelText>
}

export function CanvasPanel({
  name,
  title,
  version,
  latest,
  onVersion,
  newer = null,
  onComment,
  selected = null,
  comments = [],
  onReload,
  extra,
  bar,
  onBack,
  actionsIn,
  titled = false,
  onTitle,
  onCommentPick,
  onClose,
  children,
  fill = false,
  loading = false,
  error,
  text,
}: CanvasPanelProps) {
  const t = { ...canvasPanelText, ...text }
  const [writing, setWriting] = useState(false)
  // What the comment is on, as Comment was pressed.
  const [aimed, setAimed] = useState<string | null>(null)
  const older = version > 1
  const later = version < latest
  const actions = (
    <>
      {/* Its versions step only in its own room: beside a conversation, the artifact itself is a press away. */}
      {onVersion !== undefined && latest > 1 && actionsIn !== undefined && !titled && (
        <span className={s.versions}>
          <IconButton icon="chevronL" label={t.older} kbd="[" size="small" disabled={!older} onClick={() => onVersion(version - 1)} />
          <span className={s.versionWord}>{t.version(version, latest)}</span>
          <IconButton icon="chevron" label={t.newer} kbd="]" size="small" disabled={!later} onClick={() => onVersion(version + 1)} />
        </span>
      )}
      {onReload !== undefined && <IconButton icon="reload" label={t.reload} size="small" onClick={onReload} />}
      {extra}
      {onComment !== undefined && error === undefined && titled ? (
        <IconButton
          icon="comment"
          label={t.comment}
          tooltip="below"
          size="small"
          aria-pressed={writing}
          onClick={() => {
            setAimed(selected)
            setWriting((was) => !was)
          }}
        />
      ) : onComment !== undefined && error === undefined ? (
        <ActionButton
          icon="comment"
          aria-pressed={writing}
          onClick={() => {
            setAimed(selected)
            setWriting((was) => !was)
          }}
        >
          {t.comment}
        </ActionButton>
      ) : null}
    </>
  )
  const content = (
    <>
      {/* Only what the person can act on: a newer version than the one shown. */}
      {later && onVersion !== undefined && (
        <div className={s.facts}>
          <span className={s.behind}>
            {newer !== null ? t.newerOut(newer) : t.notLatest}
            <LinkButton onClick={() => onVersion(newer ?? latest)}>{newer !== null ? t.show : t.latest}</LinkButton>
          </span>
        </div>
      )}
      {/* what stands in for it, still being read or unreadable, sits at reading width even where it would fill */}
      <div className={cx(s.body, fill && !loading && error === undefined ? s.fill : s.reading)} data-canvas-body="">
        {loading ? (
          <div className={s.loading} aria-busy="true">
            <Skeleton width="54%" height={14} />
            <Skeleton width="96%" />
            <Skeleton width="81%" />
          </div>
        ) : error !== undefined ? (
          <Problem banner>
            {t.failed} {error}
          </Problem>
        ) : (
          children
        )}
      </div>
      {bar}
      {(writing || comments.length > 0) && (
        <div className={s.foot}>
          {writing && onComment !== undefined && error === undefined && (
            <NoteForm
              className={s.write}
              text={{ placeholder: aimed === null ? t.commentOn(version) : t.commentOnWords(aimed), submit: t.add }}
              onSubmit={(body) => {
                onComment(body, aimed)
                setWriting(false)
              }}
              onCancel={() => setWriting(false)}
            />
          )}
          {comments.length > 0 && (
            <ol className={s.comments} aria-label={t.sent(comments.length)}>
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  data-comment={comment.id}
                  className={cx(s.comment, comment.answered && s.answered, comment.n != null && s.pinned)}
                >
                  {comment.n != null &&
                    (onCommentPick === undefined ? (
                      <span className={s.pinMark} aria-label={t.pin(comment.n)}>
                        {comment.n}
                      </span>
                    ) : (
                      <button type="button" className={s.pinMark} aria-label={t.pin(comment.n)} onClick={() => onCommentPick(comment.id)}>
                        {comment.n}
                      </button>
                    ))}
                  <span className={s.commentBody}>{comment.body}</span>
                  <span className={s.commentFacts}>
                    {comment.place} · {t.onVersion(comment.version)}
                    {comment.answered ? ` · ${t.answered}` : ''}
                  </span>
                  {comment.answered && comment.answer !== undefined && comment.answer !== null && comment.answer !== '' && (
                    <span className={s.answer}>{comment.answer}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </>
  )
  // In a room whose top row is the artifact's: no head of its own, its versions and actions there.
  if (actionsIn !== undefined)
    return (
      <aside className={cx(s.panel, s.bare)} aria-label={title}>
        {actionsIn !== null &&
          createPortal(
            <span className={s.inRow}>
              {titled && (
                <>
                  <span className={s.rowRule} aria-hidden="true" />
                  <span className={s.panelTile} aria-hidden="true">
                    <Icon name="canvas" size={14} />
                  </span>
                  {onTitle === undefined ? (
                    <span className={s.rowTitle} title={title}>
                      {title}
                    </span>
                  ) : (
                    <button type="button" className={cx(s.rowTitle, s.rowLink)} title={title} onClick={onTitle}>
                      {title}
                    </button>
                  )}
                </>
              )}
              {actions}
              {titled && <IconButton icon="close" label={t.close} tooltip="below" tooltipAlign="end" size="small" onClick={onClose} />}
            </span>,
            actionsIn,
          )}
        {content}
      </aside>
    )
  return (
    <SidePanel
      label={title}
      onClose={onClose}
      {...(onBack === undefined ? {} : { onBack })}
      text={t}
      className={s.panel}
      head={
        <>
          <span className={s.panelTile} aria-hidden="true">
            <Icon name="canvas" size={14} />
          </span>
          <span className={s.panelHead}>
            <SidePanelTitle>{title}</SidePanelTitle>
            <span className={s.panelName}>{name}</span>
          </span>
        </>
      }
      actions={actions}
    >
      {content}
    </SidePanel>
  )
}

/** A picture on a canvas, an SVG's or a picture's: at its own size, or the panel's where that is smaller, on the page's ground. */
export function CanvasPicture({ src, alt }: { src: string; alt: string }) {
  return (
    <div className={s.picture}>
      <img src={src} alt={alt} />
    </div>
  )
}

/** Where a page canvas is drawn: a place the host lays the canvas's own view over, as wide and tall as the panel. */
export function CanvasPagePlace({
  ref,
  canvas,
  still = null,
  onStill,
  children,
}: {
  ref?: Ref<HTMLDivElement>
  canvas: string
  /** A picture of the canvas, drawn in its place while its view is aside for something over it. */
  still?: string | null
  onStill?: () => void
  /** What the host draws over it, such as a comment being written on a part of it. */
  children?: ReactNode
}) {
  return (
    <div ref={ref} className={s.page} data-canvas-page={canvas}>
      {still !== null && <img className={s.pageStill} src={still} alt="" draggable={false} onLoad={onStill} />}
      {children}
    </div>
  )
}
