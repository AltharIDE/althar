import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { AutomationRunState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field, FieldError } from '../../primitives/Field/Field'
import { Heading, type HeadingLevel, below } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { Select, type SelectOption } from '../../primitives/Select/Select'
import { Switch } from '../../primitives/Switch/Switch'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { AutomationChip, type AutomationRunMark, type AutomationTone, RunMark } from './marks'
import p from './AutomationPage.module.css'

/*
 * An automation's own page, in the Automations tab: a bar that stays at the
 * top as the page scrolls, with the way back to the list and what can be
 * done to it (Run now, an on/off switch, Rename and Delete), drawing a line
 * under itself once the page scrolls beneath it; its name and where it
 * stands, with a dot; a violet band when it paused itself, saying why and
 * what to do; then what it does (its card, the same as in the conversation,
 * which is how it is changed), its limits, and its runs, each opening its
 * task where it has one. A new one is this page blank: its name a field,
 * its prompt ready to type, and Save, which keeps it off, or Turn on; once
 * saved it can be tried once. What a new one is missing is said under its
 * field, and the first such field takes focus.
 */

export interface AutomationPageText {
  back: string
  name: string
  namePlaceholder: string
  nameMissing: string
  runNow: string
  tryOnce: string
  /** Keeps a new one, off. */
  save: string
  turnOn: string
  /** The on/off switch's name. */
  on: string
  more: string
  rename: string
  delete: string
  deleteTitle: (name: string) => string
  deleteNote: string
  deleteConfirm: string
  cancel: string
  /** The band, when it paused itself: the reason follows. */
  pausedItself: string
  runItNow: string
  turnBackOn: string
  does: string
  doesNote: string
  doesNoteNew: string
  limits: string
  runs: string
  noRuns: string
  /** What came of a run, said with its row to a screen reader. */
  said: Readonly<Record<AutomationRunState, string>>
}

export const automationPageText: AutomationPageText = {
  back: 'Automations',
  name: 'Name',
  namePlaceholder: 'Name it',
  nameMissing: 'Give it a name first',
  runNow: 'Run now',
  tryOnce: 'Try it once now',
  save: 'Save',
  turnOn: 'Turn on',
  on: 'On',
  more: 'More',
  rename: 'Rename',
  delete: 'Delete…',
  deleteTitle: (name) => `Delete ${name}?`,
  deleteNote: 'Nothing of it starts again. The tasks its runs made stay.',
  deleteConfirm: 'Delete',
  cancel: 'Cancel',
  pausedItself: 'It paused itself.',
  runItNow: 'Run it now',
  turnBackOn: 'Turn it back on',
  does: 'What it does',
  doesNote: 'Change any of it here; it holds from its next run.',
  doesNoteNew: 'Say it as you would to the coordinator.',
  limits: 'Limits',
  runs: 'Runs',
  noRuns: 'No runs yet.',
  said: {
    [AutomationRunState.Starting]: 'Starting',
    [AutomationRunState.Running]: 'Running',
    [AutomationRunState.Made]: 'Made something',
    [AutomationRunState.Nothing]: 'Nothing to do',
    [AutomationRunState.Failed]: 'Failed',
    [AutomationRunState.Missed]: 'Missed',
    [AutomationRunState.Skipped]: 'Skipped',
  },
}

/** One of its limits: a switch, a choice, or what holds, in words. */
export type AutomationLimit = { id: string; title: string; note?: string } & (
  | { kind: 'switch'; on: boolean; onChange: (on: boolean) => void }
  | { kind: 'select'; value: string; options: readonly SelectOption<string>[]; onChange: (value: string) => void }
  | { kind: 'words'; words: string }
)

/** One run, as its row shows it: where it has a task, it opens it. */
export interface AutomationRunRow extends AutomationRunMark {
  opens: boolean
}

export type AutomationPageProps = RootProps<
  'div',
  {
    name: string
    /** A new one, not made yet: its name is a field, and Save and Turn on make it. */
    making?: boolean
    onNameChange?: (name: string) => void
    /** Where it stands, in words, after a dot: Runs next tomorrow at 9:00, Paused, Off until you turn it on. */
    status: string
    /** The dot: filled while it is on, hollow while it isn't, violet once it paused itself. */
    statusTone: 'on' | 'off' | 'yours'
    tone: AutomationTone
    paused: boolean
    /** Not turned on yet: Try it once now (once it is made) and Turn on, in place of Run now and the switch. */
    proposed: boolean
    on: boolean
    onSwitch?: (on: boolean) => void
    onRunNow?: () => void
    onTryOnce?: () => void
    /** Makes a new one, off: it can be tried once from its page, and turned on. */
    onSave?: () => void
    onTurnOn?: () => void
    /**
     * Whether the rest of a new one is ready to be made, beside its name: where
     * it isn't, the consumer marks what is missing under its own field, and the
     * page takes focus to the first field marked invalid.
     */
    check?: () => boolean
    onRename?: (name: string) => void
    onDelete?: () => void
    onBack: () => void
    /** Why it paused itself, in a sentence: a violet band under its head, with what to do. */
    pausedItself?: string
    /** What it does: its card, kept. */
    card: ReactNode
    limits: readonly AutomationLimit[]
    /** Its runs, newest first; none for a new one. */
    runs?: readonly AutomationRunRow[]
    onOpenRun?: (id: string) => void
    /** What went wrong with the last thing asked of it. */
    error?: string
    /** Something asked of it is on its way. */
    busy?: boolean
    headingLevel?: HeadingLevel
    text?: Partial<AutomationPageText>
  }
>

function Section({ title, note, level, children }: { title: string; note?: string; level: HeadingLevel; children: ReactNode }) {
  const id = useId()
  return (
    <section className={p.section} aria-labelledby={id}>
      <header className={p.sectionHead}>
        <Heading level={level} id={id} className={p.sectionTitle}>
          {title}
        </Heading>
        {note !== undefined && <p className={p.sectionNote}>{note}</p>}
      </header>
      {children}
    </section>
  )
}

/** A limit: its name and line on the left, its control or its words beside them. */
function Limit({ limit }: { limit: AutomationLimit }) {
  const id = useId()
  const titleId = `${id}-t`
  const noteId = limit.note === undefined ? undefined : `${id}-n`
  return (
    <div className={p.limit}>
      <div className={p.limitWords}>
        <span id={titleId} className={p.limitTitle}>
          {limit.title}
        </span>
        {limit.note !== undefined && (
          <span id={noteId} className={p.limitNote}>
            {limit.note}
          </span>
        )}
      </div>
      <div className={p.limitControl}>
        {limit.kind === 'switch' ? (
          <Switch
            checked={limit.on}
            onChange={limit.onChange}
            labelledBy={titleId}
            {...(noteId === undefined ? {} : { describedBy: noteId })}
          />
        ) : limit.kind === 'select' ? (
          <Select variant="filled" width={300} label={limit.title} value={limit.value} options={limit.options} onChange={limit.onChange} />
        ) : (
          <span className={p.plain}>{limit.words}</span>
        )}
      </div>
    </div>
  )
}

/** Its name being changed: Enter keeps it, Escape leaves it, and leaving the field keeps it too; it ends once. */
function Rename({ name, onRenamed, t }: { name: string; onRenamed: (name: string | null) => void; t: AutomationPageText }) {
  const [draft, setDraft] = useState(name)
  const field = useRef<HTMLInputElement>(null)
  const ended = useRef(false)
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  const end = (renamed: string | null) => {
    if (ended.current) return
    ended.current = true
    onRenamed(renamed)
  }
  const kept = () => (draft.trim() === '' || draft.trim() === name ? null : draft.trim())
  return (
    <form
      className={p.rename}
      data-own-escape=""
      onSubmit={(event) => {
        event.preventDefault()
        end(kept())
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        end(null)
      }}
    >
      <Field
        ref={field}
        size="large"
        aria-label={t.name}
        value={draft}
        maxLength={60}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => end(kept())}
        className={p.nameField}
      />
    </form>
  )
}

/** Its name: the title, a field while a new one is named, or while it is renamed, after which focus comes back to it. */
function Name({
  name,
  making,
  renaming,
  missing,
  onNameChange,
  onRenamed,
  level,
  t,
}: {
  name: string
  making: boolean
  renaming: boolean
  missing: boolean
  onNameChange?: (name: string) => void
  onRenamed: (name: string | null) => void
  level: HeadingLevel
  t: AutomationPageText
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const errorId = useId()
  const was = useRef(renaming)
  useEffect(() => {
    if (!renaming && was.current) title.current?.focus()
    was.current = renaming
  }, [renaming])
  if (making)
    return (
      <>
        <Field
          size="large"
          aria-label={t.name}
          placeholder={t.namePlaceholder}
          value={name}
          maxLength={60}
          invalid={missing}
          aria-describedby={missing ? errorId : undefined}
          onChange={(event) => onNameChange?.(event.target.value)}
          className={p.nameField}
        />
        {missing && <FieldError id={errorId}>{t.nameMissing}</FieldError>}
      </>
    )
  if (renaming) return <Rename name={name} onRenamed={onRenamed} t={t} />
  return (
    <Heading level={level} className={p.title} ref={title} tabIndex={-1}>
      {name}
    </Heading>
  )
}

export function AutomationPage({
  name,
  making = false,
  onNameChange,
  status,
  statusTone,
  tone,
  paused,
  proposed,
  on,
  onSwitch,
  onRunNow,
  onTryOnce,
  onSave,
  onTurnOn,
  check,
  onRename,
  onDelete,
  onBack,
  pausedItself,
  card,
  limits,
  runs,
  onOpenRun,
  error,
  busy = false,
  headingLevel = 2,
  text,
  className,
  ...rest
}: AutomationPageProps) {
  const t = { ...automationPageText, ...text }
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [missing, setMissing] = useState(false)
  // Which of a new one's actions was asked, so only it shows it is on its way.
  const [asked, setAsked] = useState<'save' | 'on' | null>(null)
  // Each time making it was refused, focus goes to the first field that says why.
  const [refused, setRefused] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const view = useRef<HTMLDivElement>(null)
  // Rename takes focus on to the field, not back to the menu's button.
  const away = useRef(false)
  const inner = below(headingLevel)
  if (missing && name.trim() !== '') setMissing(false)
  useEffect(() => {
    if (refused === 0) return
    const first = view.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (first === null || first === undefined) return
    first.focus({ preventScroll: true })
    first.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [refused])
  /** A new one is made only once it has its name and what else it needs; what it lacks is said under each field. */
  const ready = (action: 'save' | 'on', then: () => void) => () => {
    const named = !making || name.trim() !== ''
    if (!named) setMissing(true)
    const rest = check?.() ?? true
    if (!named || !rest) {
      setRefused((n) => n + 1)
      return
    }
    setAsked(action)
    then()
  }
  const actions = making ? (
    <>
      {onSave !== undefined && (
        <Button variant="quiet" onClick={ready('save', onSave)} disabled={busy && asked !== 'save'} busy={busy && asked === 'save'}>
          {t.save}
        </Button>
      )}
      {onTurnOn !== undefined && (
        <Button onClick={ready('on', onTurnOn)} disabled={busy && asked === 'save'} busy={busy && asked !== 'save'}>
          {t.turnOn}
        </Button>
      )}
    </>
  ) : proposed ? (
    <>
      {onTryOnce !== undefined && (
        <Button variant="quiet" icon="play" onClick={onTryOnce} disabled={busy}>
          {t.tryOnce}
        </Button>
      )}
      {onTurnOn !== undefined && (
        <Button onClick={onTurnOn} busy={busy}>
          {t.turnOn}
        </Button>
      )}
    </>
  ) : (
    <>
      {onRunNow !== undefined && (
        <Button variant="quiet" icon="play" onClick={onRunNow} disabled={busy}>
          {t.runNow}
        </Button>
      )}
      {onSwitch !== undefined && (
        <span className={p.switch}>
          <Switch checked={on} onChange={onSwitch} label={t.on} />
        </span>
      )}
    </>
  )
  return (
    <div className={cx(p.view, className)} ref={view} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)} {...rest}>
      <div className={p.bar} data-scrolled={scrolled || undefined}>
        <div className={p.barInner}>
          <Button variant="quiet" size="small" icon="chevronL" className={p.crumb} onClick={onBack}>
            {t.back}
          </Button>
          <div className={p.actions}>
            {actions}
            {!making && (onRename !== undefined || onDelete !== undefined) && (
              <Menu
                label={t.more}
                align="end"
                width={200}
                returnFocus={() => {
                  const back = !away.current
                  away.current = false
                  return back
                }}
                trigger={<IconButton icon="more" label={t.more} />}
              >
                {onRename !== undefined && (
                  <MenuItem
                    icon="pencil"
                    onSelect={() => {
                      away.current = true
                      setRenaming(true)
                    }}
                  >
                    {t.rename}
                  </MenuItem>
                )}
                {onDelete !== undefined && (
                  <MenuItem icon="close" tone="danger" onSelect={() => setDeleting(true)}>
                    {t.delete}
                  </MenuItem>
                )}
              </Menu>
            )}
          </div>
        </div>
      </div>
      <div className={p.column}>
        <header className={p.head}>
          <AutomationChip tone={tone} paused={paused} size={44} />
          <div className={p.headWords}>
            <Name
              name={name}
              making={making}
              renaming={renaming}
              missing={missing}
              level={headingLevel}
              t={t}
              {...(onNameChange === undefined ? {} : { onNameChange })}
              onRenamed={(renamed) => {
                setRenaming(false)
                if (renamed !== null) onRename?.(renamed)
              }}
            />
            <p className={p.status}>
              <span className={cx(p.dot, statusTone === 'off' && p.dotOff, statusTone === 'yours' && p.dotYours)} aria-hidden="true" />
              {status}
            </p>
          </div>
        </header>
        {error !== undefined && (
          <p className={p.error} role="alert">
            {error}
          </p>
        )}
        {pausedItself !== undefined && (
          <div className={p.needs}>
            <div className={p.needsWords}>
              <span className={p.needsTitle}>{t.pausedItself}</span>
              <span className={p.needsNote}>{pausedItself}</span>
            </div>
            {onRunNow !== undefined && (
              <Button variant="quiet" onClick={onRunNow} disabled={busy}>
                {t.runItNow}
              </Button>
            )}
            {onSwitch !== undefined && (
              <Button variant="signal" onClick={() => onSwitch(true)} disabled={busy}>
                {t.turnBackOn}
              </Button>
            )}
          </div>
        )}
        <Section title={t.does} note={making ? t.doesNoteNew : t.doesNote} level={inner}>
          {card}
        </Section>
        <Section title={t.limits} level={inner}>
          <div className={p.sheet}>
            {limits.map((limit) => (
              <Limit key={limit.id} limit={limit} />
            ))}
          </div>
        </Section>
        {runs !== undefined && (
          <Section title={t.runs} level={inner}>
            <div className={p.sheet}>
              {runs.length === 0 && <p className={p.noRuns}>{t.noRuns}</p>}
              {runs.map((run) => {
                const words = (
                  <>
                    <RunMark state={run.state} />
                    <span className={p.runAt}>{run.at}</span>
                    <span className={cx(p.runWords, run.state === AutomationRunState.Nothing && p.runQuiet)}>
                      <VisuallyHidden>{t.said[run.state]}: </VisuallyHidden>
                      {run.words}
                    </span>
                  </>
                )
                return run.opens && onOpenRun !== undefined ? (
                  <button key={run.id} type="button" className={p.run} onClick={() => onOpenRun(run.id)}>
                    {words}
                    <Icon name="chevron" size={12} className={p.runChevron} />
                  </button>
                ) : (
                  <div key={run.id} className={p.run}>
                    {words}
                    <span />
                  </div>
                )
              })}
            </div>
          </Section>
        )}
      </div>
      {deleting && onDelete !== undefined && (
        <Dialog
          title={t.deleteTitle(name)}
          description={t.deleteNote}
          onClose={() => setDeleting(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setDeleting(false)}>
                {t.cancel}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDeleting(false)
                  onDelete()
                }}
              >
                {t.deleteConfirm}
              </Button>
            </>
          }
        />
      )}
    </div>
  )
}
