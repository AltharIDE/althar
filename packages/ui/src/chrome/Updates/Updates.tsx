import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { Logo } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Heading } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import s from './Updates.module.css'

/*
 * Every update in one place in the window's bar, left of CPU and MEM, in
 * place of a line each: a download glyph, a dot on it while something can
 * update, turning while something does, the problem mark where something
 * didn't; nothing at all while everything is on its newest. It opens to a
 * row each: Althar on this computer, the home the window is on where that's
 * another computer, and the home's workers, the most urgent first. Each row
 * can be put aside until its next release, with its × on hover; with none
 * left, the glyph goes, and says for a moment where they still are.
 *
 * The consumer says each row: where it stands, what it says, and what's at
 * its end. It only draws.
 */

/** What a row is of: Althar on this computer, the window's home, the home's workers. */
export type UpdateKind = 'app' | 'home' | 'workers'

/** Where a row stands: what can update, what waits or needs nothing (quiet), what runs, what's asked first, what stopped, what's done. */
export type UpdateTone = 'offer' | 'quiet' | 'running' | 'asking' | 'failed' | 'done'

/** What's at a row's end. */
export type UpdateEnd =
  | { readonly kind: 'press'; readonly label: string; readonly onPress: () => void }
  /** Asked first, in the row: its Cancel, and the press that goes anyway, in the danger colour. */
  | { readonly kind: 'ask'; readonly label: string; readonly onPress: () => void; readonly onCancel: () => void }
  | { readonly kind: 'cancel'; readonly onPress: () => void }
  | { readonly kind: 'steps'; readonly steps: readonly string[]; readonly at: number }
  | { readonly kind: 'count'; readonly done: number; readonly of: number }
  | { readonly kind: 'spinner' }
  /** The command to run by hand, to copy: where the window can't run it. */
  | { readonly kind: 'copy'; readonly command: string }

export interface UpdateRow {
  readonly kind: UpdateKind
  readonly tone: UpdateTone
  readonly title: string
  readonly line?: string | undefined
  readonly end?: UpdateEnd | undefined
  /** It can be put aside until its next release: what can update, waits or failed; not what runs, nor what's just done. */
  readonly hides: boolean
  /** Who it's of, in the glyph's name: Althar 0.10.1, runner-1, 3 workers. */
  readonly who: string
}

export interface UpdatesText {
  heading: string
  check: string
  checking: string
  hide: string
  cancel: string
  /** The glyph's name: what's under it. */
  label: (who: readonly string[]) => string
  /** With none left: where they still are. */
  still: (where: string) => string
}

const list = (all: readonly string[]) =>
  all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1] ?? ''}`

export const updatesText: UpdatesText = {
  heading: 'Updates',
  check: 'Check for updates',
  checking: 'Checking…',
  hide: 'Hide until its next release',
  cancel: 'Cancel',
  label: (who) => `Updates: ${list(who)}`,
  still: (where) => `Still in ${where}`,
}

const urgency: Record<UpdateTone, number> = { asking: 0, failed: 1, running: 2, offer: 3, quiet: 4, done: 5 }

/** The rows, most urgent first: asked first, what failed, what runs, what can update; Althar, then its home, then its workers. */
const kinds: Record<UpdateKind, number> = { app: 0, home: 1, workers: 2 }
export const orderUpdates = (rows: readonly UpdateRow[]): UpdateRow[] =>
  [...rows].sort((a, b) => urgency[a.tone] - urgency[b.tone] || kinds[a.kind] - kinds[b.kind])

const tiles: Record<Exclude<UpdateKind, 'app'>, IconName> = { home: 'house', workers: 'worker' }

function End({ end, t }: { end: UpdateEnd; t: UpdatesText }) {
  switch (end.kind) {
    case 'press':
      return (
        <Button size="small" onClick={end.onPress}>
          {end.label}
        </Button>
      )
    case 'ask':
      return (
        <span className={s.ask}>
          <LinkButton onClick={end.onCancel}>{t.cancel}</LinkButton>
          <Button size="small" variant="danger" onClick={end.onPress}>
            {end.label}
          </Button>
        </span>
      )
    case 'cancel':
      return <LinkButton onClick={end.onPress}>{t.cancel}</LinkButton>
    case 'steps':
      return <StepTrack steps={trackOf(end.steps, end.at)} className={s.track} />
    case 'count':
      return (
        <span className={s.count}>
          {end.done} of {end.of}
        </span>
      )
    case 'spinner':
      return <Spinner size="small" />
    case 'copy':
      return <CopyButton value={end.command} ghost />
  }
}

/** What's most urgent under the glyph, drawn on it. */
function Glyph({ tone }: { tone: UpdateTone }) {
  if (tone === 'failed' || tone === 'asking') return <Icon name="problem" size={13} />
  if (tone === 'running') return <Spinner size="small" />
  if (tone === 'done') return <Icon name="check" size={13} />
  return <Icon name="download" size={13} />
}

export type UpdatesProps = RootProps<
  'span',
  {
    /** The updates, each as it stands: none, and there's no glyph. */
    rows: readonly UpdateRow[]
    /** Puts one aside until its next release. Without it, no ×. */
    onHide?: ((kind: UpdateKind) => void) | undefined
    /** With none left: where they still are, said for a moment as a way there. */
    still?: { readonly where: string; readonly onShow: () => void } | null | undefined
    /** Checks for a newer Althar now, as the app's menu does. */
    onCheck?: (() => void) | undefined
    checking?: boolean | undefined
    open?: boolean | undefined
    onOpenChange?: ((open: boolean) => void) | undefined
    text?: Partial<UpdatesText> | undefined
  }
>

export function Updates({ rows, onHide, still, onCheck, checking = false, open, onOpenChange, text, className, ...rest }: UpdatesProps) {
  const t = { ...updatesText, ...text }
  if (rows.length === 0)
    return still == null ? null : (
      // An output is a live status: read out as it appears.
      <output className={cx(s.still, className)}>
        <LinkButton onClick={still.onShow}>{t.still(still.where)}</LinkButton>
      </output>
    )
  const ordered = orderUpdates(rows)
  const tone = ordered[0]?.tone ?? 'done'
  const label = t.label(ordered.map((row) => row.who))
  // The dot says something can update; what runs or stopped draws its own glyph instead.
  const marked = tone === 'offer' || tone === 'quiet'
  return (
    <span className={cx(s.updates, className)} {...rest}>
      <Popover
        label={t.heading}
        placement="below"
        align="end"
        width={380}
        initialFocus="panel"
        {...(open === undefined ? {} : { open })}
        {...(onOpenChange === undefined ? {} : { onOpenChange })}
        trigger={
          <button type="button" className={cx(s.glyph, marked && s.marked)} data-tone={tone} aria-label={label} title={label}>
            <Glyph tone={tone} />
          </button>
        }
      >
        <div className={s.peek}>
          <div className={s.head}>
            <Heading level={2} className={s.heading}>
              {t.heading}
            </Heading>
            {onCheck !== undefined && (
              <LinkButton className={s.check} disabled={checking} onClick={onCheck}>
                {checking ? t.checking : t.check}
              </LinkButton>
            )}
          </div>
          <ul className={s.rows}>
            {ordered.map((row) => (
              <li key={row.kind} className={s.row} data-tone={row.tone}>
                <span className={s.tile} aria-hidden="true">
                  {row.kind === 'app' ? <Logo size={15} /> : <Icon name={tiles[row.kind]} size={14} />}
                </span>
                <span className={s.words} aria-live="polite">
                  <span className={s.title}>{row.title}</span>
                  {row.line !== undefined && row.line !== '' && (
                    <span className={s.line} title={row.line}>
                      {row.line}
                    </span>
                  )}
                </span>
                <span className={s.end}>{row.end !== undefined && <End end={row.end} t={t} />}</span>
                <span className={s.hide}>
                  {row.hides && onHide !== undefined && (
                    <IconButton icon="close" label={t.hide} size="small" tooltip="below" onClick={() => onHide(row.kind)} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Popover>
    </span>
  )
}
