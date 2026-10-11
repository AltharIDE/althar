import { useEffect, useId, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { IssueDraftState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { useRefocus } from '../../lib/refocus'
import { Rhythm } from '../../lib/rhythm'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { Field, FieldArea, FieldError } from '../../primitives/Field/Field'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './IssueDraft.module.css'

/*
 * An issue the coordinator drafted on one of your trackers, as a card in its
 * thread. Nothing reaches the tracker until you file it: you can change it
 * first, or throw it away. If filing fails the card says why and can be filed
 * again. Filed or discarded, it folds to a line: the issue's key and link, or
 * that it was thrown away.
 */

export interface IssueDraftText {
  /** What it is and where it goes: Issue draft · Linear · Meridian. */
  kicker: (source: string, container: string) => string
  /** The labels, as quiet text. */
  labelled: (labels: readonly string[]) => string
  showAll: string
  showLess: string
  /** Beside the buttons, until it is filed. */
  note: string
  /** Beside the buttons, while it is being filed. */
  filing: (source: string) => string
  /** Before why it wasn't filed. */
  failed: (source: string) => string
  discard: string
  edit: string
  file: string
  fileAgain: string
  /** The edit form's name. */
  editing: string
  titleLabel: string
  bodyLabel: string
  labelsLabel: string
  /** Under the labels field: how to write several. */
  labelsHint: string
  /** Said when it is saved without a title. */
  titleMissing: string
  save: string
  cancel: string
  /** Before the issue's key, once filed. */
  filed: (source: string) => string
  /** Read after a link that opens a new tab. */
  newTab: string
  discarded: string
}

export const issueDraftText: IssueDraftText = {
  kicker: (source, container) => `Issue draft · ${source} · ${container}`,
  labelled: (labels) => `Labels: ${labels.join(', ')}`,
  showAll: 'Show all',
  showLess: 'Show less',
  note: 'Nothing is filed until you file it.',
  filing: (source) => `Filing on ${source}…`,
  failed: (source) => `Couldn’t file it on ${source}.`,
  discard: 'Discard',
  edit: 'Edit',
  file: 'File issue',
  fileAgain: 'File again',
  editing: 'Edit the issue draft',
  titleLabel: 'Title',
  bodyLabel: 'Description',
  labelsLabel: 'Labels',
  labelsHint: 'Separate labels with commas.',
  titleMissing: 'Give it a title first',
  save: 'Save',
  cancel: 'Cancel',
  filed: (source) => `Filed on ${source} as`,
  newTab: '(opens in a new tab)',
  discarded: 'Issue draft discarded',
}

export interface IssueDraftEdit {
  title: string
  body: string
  labels: readonly string[]
}

export type IssueDraftProps = RootProps<
  'article',
  {
    /** The tracker's mark and name: Brand.Linear, 'Linear'. */
    mark: Brand
    source: string
    /** Where on the tracker it goes: a team, a project, a list on a board, a repository. */
    container: string
    title: string
    /** Markdown, as text. */
    body: string
    /** The body drawn, where the consumer draws Markdown; the plain text otherwise. */
    bodyView?: ReactNode
    labels: readonly string[]
    state: IssueDraftState
    /** Why it wasn't filed, while it stands failed. */
    error?: string
    /** The issue, once filed: its key, and its link. */
    issue?: { key: string; href: string }
    /** File it, or file it again after it failed. */
    onFile?: () => void
    /** Save what the person changed in the edit form. */
    onChange?: (edit: IssueDraftEdit) => void
    onDiscard?: () => void
    /** A save is under way: the form's save button shows it. */
    saving?: boolean
    headingLevel?: HeadingLevel
    text?: Partial<IssueDraftText>
  }
>

/* A body this long, in characters or lines, is folded to a few lines until asked for. */
const LONG_CHARS = 360
const LONG_LINES = 6

/* The labels field holds them as one line; commas part them. */
const parseLabels = (line: string) =>
  line
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

export function IssueDraft({
  mark,
  source,
  container,
  title,
  body,
  bodyView,
  labels,
  state,
  error,
  issue,
  onFile,
  onChange,
  onDiscard,
  saving = false,
  headingLevel = 3,
  text,
  ref,
  className,
  ...rest
}: IssueDraftProps) {
  const t = { ...issueDraftText, ...text }
  /* when it folds under the button you pressed, focus goes to the line it folds to */
  const line = useRef<HTMLElement>(null)
  useRefocus(!folds(state), line)
  const setLine = (node: HTMLElement | null) => {
    line.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  switch (state) {
    case IssueDraftState.Filed: {
      const href = safeHref(issue?.href)
      return (
        <article ref={setLine} tabIndex={-1} className={cx(s.line, className)} data-rhythm={Rhythm.Fold} {...rest}>
          <BrandMark brand={mark} size={12} className={s.lineMark} />
          <span className={s.said}>
            {t.filed(source)}{' '}
            {href ? (
              <a className={s.key} href={href} target="_blank" rel="noreferrer">
                {issue?.key}
                <VisuallyHidden> {t.newTab}</VisuallyHidden>
              </a>
            ) : (
              <span className={s.key}>{issue?.key}</span>
            )}
          </span>
          <span className={s.lineTitle}>{title}</span>
        </article>
      )
    }
    case IssueDraftState.Discarded:
      return (
        <article ref={setLine} tabIndex={-1} className={cx(s.line, className)} data-rhythm={Rhythm.Fold} {...rest}>
          <BrandMark brand={mark} size={12} className={s.lineMark} />
          <span className={s.said}>{t.discarded}</span>
          <span className={cx(s.lineTitle, s.struck)}>{title}</span>
        </article>
      )
    case IssueDraftState.Pending:
    case IssueDraftState.Filing:
    case IssueDraftState.Failed:
      return (
        <DraftCard
          root={{ ...rest, ref, className }}
          draft={{ mark, source, container, title, body, bodyView, labels, error }}
          state={state}
          onFile={onFile}
          onChange={onChange}
          onDiscard={onDiscard}
          saving={saving}
          headingLevel={headingLevel}
          t={t}
        />
      )
    default:
      return unreachable(state)
  }
}

function folds(state: IssueDraftState) {
  switch (state) {
    case IssueDraftState.Filed:
    case IssueDraftState.Discarded:
      return true
    case IssueDraftState.Pending:
    case IssueDraftState.Filing:
    case IssueDraftState.Failed:
      return false
    default:
      return unreachable(state)
  }
}

interface CardProps {
  root: ComponentPropsWithRef<'article'>
  draft: Pick<IssueDraftProps, 'mark' | 'source' | 'container' | 'title' | 'body' | 'bodyView' | 'labels' | 'error'>
  state: IssueDraftState
  onFile?: () => void
  onChange?: (edit: IssueDraftEdit) => void
  onDiscard?: () => void
  saving: boolean
  headingLevel: HeadingLevel
  t: IssueDraftText
}

/** The draft before it is filed: what it says, and the buttons that file it, change it, or throw it away. */
function DraftCard({ root, draft, state, onFile, onChange, onDiscard, saving, headingLevel, t }: CardProps) {
  const { mark, source, container, title, body, bodyView, labels, error } = draft
  const { className, ...rest } = root
  const kickerId = useId()
  const titleId = useId()
  const bodyId = useId()
  const [editing, setEditing] = useState(false)
  const [sent, setSent] = useState(false)
  const [all, setAll] = useState(false)
  const filing = state === IssueDraftState.Filing
  const failed = state === IssueDraftState.Failed
  const open = editing && !filing
  /* saved: the form stays while the save is under way, and closes once it isn't */
  if (sent && !saving) {
    setSent(false)
    setEditing(false)
  }
  const edit = useRefocus<HTMLButtonElement>(open)
  const long = body.length > LONG_CHARS || body.split('\n').length > LONG_LINES

  return (
    <article
      aria-labelledby={open ? kickerId : `${kickerId} ${titleId}`}
      className={cx(s.card, className)}
      data-rhythm={Rhythm.Card}
      {...rest}
    >
      <div className={s.head}>
        <span className={s.kicker} id={kickerId}>
          <BrandMark brand={mark} size={11} className={s.mark} />
          {t.kicker(source, container)}
        </span>
        {!open && (
          <Heading level={headingLevel} id={titleId} className={s.title}>
            {title}
          </Heading>
        )}
      </div>
      {open && onChange ? (
        <EditForm
          title={title}
          body={body}
          labels={labels}
          saving={saving}
          t={t}
          onSave={(next) => {
            onChange(next)
            setSent(true)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {body !== '' && (
            <div className={s.bodyWrap}>
              <div id={bodyId} className={cx(s.body, long && !all && s.clamped)}>
                {bodyView ?? <p className={s.plain}>{body}</p>}
              </div>
              {long && (
                <LinkButton className={s.more} aria-expanded={all} aria-controls={bodyId} onClick={() => setAll(!all)}>
                  {all ? t.showLess : t.showAll}
                </LinkButton>
              )}
            </div>
          )}
          {labels.length > 0 && <p className={s.labels}>{t.labelled(labels)}</p>}
          <div aria-live="polite">
            {failed && (
              <p className={s.error}>
                {t.failed(source)}
                {error && <> {error}</>}
              </p>
            )}
          </div>
          <div className={s.foot}>
            <span className={s.note}>{filing ? t.filing(source) : t.note}</span>
            {onDiscard && !filing && (
              <Button variant="quiet" onClick={onDiscard}>
                {t.discard}
              </Button>
            )}
            {onChange && !filing && (
              <Button ref={edit} onClick={() => setEditing(true)}>
                {t.edit}
              </Button>
            )}
            {onFile && (
              <Button variant="signal" busy={filing} onClick={onFile}>
                {failed ? t.fileAgain : t.file}
              </Button>
            )}
          </div>
        </>
      )}
    </article>
  )
}

interface EditFormProps {
  title: string
  body: string
  labels: readonly string[]
  saving: boolean
  onSave: (edit: IssueDraftEdit) => void
  onCancel: () => void
  t: IssueDraftText
}

/** The draft as a form: its title, its body, and its labels in a line. */
function EditForm({ title: initialTitle, body: initialBody, labels: initialLabels, saving, onSave, onCancel, t }: EditFormProps) {
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const [labels, setLabels] = useState(initialLabels.join(', '))
  const [missing, setMissing] = useState(false)
  const titleField = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const labelsId = useId()
  const errorId = useId()
  const hintId = useId()
  useEffect(() => {
    titleField.current?.focus()
  }, [])
  return (
    <form
      aria-label={t.editing}
      className={s.form}
      /* its Escape, not a panel's round it */
      data-own-escape=""
      onSubmit={(e) => {
        e.preventDefault()
        const named = title.trim()
        if (!named) {
          setMissing(true)
          titleField.current?.focus()
          return
        }
        onSave({ title: named, body, labels: parseLabels(labels) })
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }}
    >
      <div className={s.fields}>
        <div className={s.row}>
          <label htmlFor={titleId} className={s.label}>
            {t.titleLabel}
          </label>
          <Field
            ref={titleField}
            id={titleId}
            value={title}
            invalid={missing}
            aria-describedby={missing ? errorId : undefined}
            onChange={(e) => {
              setTitle(e.target.value)
              if (e.target.value.trim()) setMissing(false)
            }}
          />
          {missing && <FieldError id={errorId}>{t.titleMissing}</FieldError>}
        </div>
        <div className={s.row}>
          <label htmlFor={bodyId} className={s.label}>
            {t.bodyLabel}
          </label>
          <FieldArea id={bodyId} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className={s.row}>
          <label htmlFor={labelsId} className={s.label}>
            {t.labelsLabel}
          </label>
          <Field id={labelsId} value={labels} aria-describedby={hintId} onChange={(e) => setLabels(e.target.value)} />
          <span id={hintId} className={s.hint}>
            {t.labelsHint}
          </span>
        </div>
      </div>
      <div className={s.foot}>
        <span className={s.note} />
        <Button variant="quiet" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" busy={saving}>
          {t.save}
        </Button>
      </div>
    </form>
  )
}
