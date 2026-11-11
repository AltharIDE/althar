import { cx } from '../../lib/cx'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import s from './PaneToggles.module.css'

/*
 * The panes of a project's home, as toggles at the end of its header: the
 * conversation with its coordinator, the board of its work, and which side
 * each is on. Each toggle shows or hides its pane; one stays showing, so the
 * toggle of the only pane showing can't hide it. Sides change only while both
 * show. None of them ever comes or goes, and none changes width: what can't
 * act is faint, so the header never moves under the pointer.
 * Away from the home (its automations, its settings), neither pane shows here,
 * and a toggle goes back home with its pane showing.
 * The keys are the consumer's to bind; the toggles name them.
 */

/** A pane of the home. */
export type Pane = 'talk' | 'board'

export interface PaneTogglesText {
  label: string
  talk: string
  board: string
  swap: string
}

export const paneTogglesText: PaneTogglesText = {
  label: 'Panes',
  talk: 'Conversation',
  board: 'Board',
  swap: 'Swap sides',
}

export interface PaneTogglesProps {
  /** Which panes show now. */
  shown: Readonly<Record<Pane, boolean>>
  /** A toggle pressed: show its pane, or hide it. */
  onToggle: (pane: Pane) => void
  /** The conversation is on the right of the board. */
  swapped: boolean
  onSwap: () => void
  /** Each toggle's key, as its tooltip says it; the consumer binds them. */
  keys?: Partial<Record<Pane, string>>
  className?: string
  text?: Partial<PaneTogglesText>
}

export function PaneToggles({ shown, onToggle, swapped, onSwap, keys = {}, className, text }: PaneTogglesProps) {
  const t = { ...paneTogglesText, ...text }
  const both = shown.talk && shown.board
  /** The only pane showing can't be hidden: its toggle stays lit, and does nothing. */
  const toggle = (pane: Pane, icon: 'conversation' | 'work') => {
    const only = shown[pane] && !both
    return (
      <ChromeButton
        icon={icon}
        label={t[pane]}
        compact
        pressed={shown[pane]}
        aria-disabled={only || undefined}
        {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })}
        onClick={() => {
          if (!only) onToggle(pane)
        }}
      />
    )
  }
  // In the same order whichever side each pane is on, so each stays where the pointer learned it.
  return (
    <fieldset aria-label={t.label} className={cx(s.toggles, className)}>
      {toggle('talk', 'conversation')}
      {toggle('board', 'work')}
      <ChromeButton
        icon="swap"
        label={t.swap}
        pressed={both && swapped}
        compact
        aria-disabled={!both || undefined}
        onClick={() => {
          if (both) onSwap()
        }}
      />
    </fieldset>
  )
}
