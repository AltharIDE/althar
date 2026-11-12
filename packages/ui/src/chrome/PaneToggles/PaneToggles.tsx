import { createContext, useContext } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
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
 *
 * Prototype: the layout map, the toggles as one small drawing of the window,
 * drawn five ways (PaneTogglesDesign), picked by the home lab
 * (apps/desktop/lab/home) through PaneTogglesDesignProvider; the app keeps
 * today's glyph buttons until one is chosen.
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

/** How the toggles are drawn, for the home lab to compare: today's glyph buttons, or the layout map one of five ways. */
export type PaneTogglesDesign = 'today' | MapLook

/** How the layout map is drawn and coloured. */
type MapLook = 'tiles' | 'raised' | 'window' | 'ink' | 'mini'

export const paneTogglesDesigns: ReadonlyArray<{ readonly key: MapLook; readonly label: string }> = [
  { key: 'tiles', label: 'Grey tiles (first)' },
  { key: 'raised', label: 'Raised paper' },
  { key: 'window', label: 'Paper window' },
  { key: 'ink', label: 'Ink drawing' },
  { key: 'mini', label: 'Miniature' },
]

const Design = createContext<PaneTogglesDesign>('today')
export const PaneTogglesDesignProvider = Design.Provider

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

export function PaneToggles(props: PaneTogglesProps) {
  const design = useContext(Design)
  return design === 'today' ? <GlyphButtons {...props} /> : <LayoutMap {...props} look={design} />
}

/** What every design shares: its words, whether both show, and a toggle that never hides the only pane showing. */
function usePanes({ shown, onToggle, swapped, onSwap, text }: PaneTogglesProps) {
  const t = { ...paneTogglesText, ...text }
  const both = shown.talk && shown.board
  return {
    t,
    both,
    /** The only pane showing can't be hidden: its toggle stays lit, and does nothing. */
    only: (pane: Pane) => shown[pane] && !both,
    toggle: (pane: Pane) => {
      if (!(shown[pane] && !both)) onToggle(pane)
    },
    swap: () => {
      if (both) onSwap()
    },
    /** The panes as they sit, left to right. */
    sides: (swapped ? ['board', 'talk'] : ['talk', 'board']) as ReadonlyArray<Pane>,
  }
}

const ICON = { talk: 'conversation', board: 'work' } as const

/** Today's: three glyphs washed while on, in the same order whichever side each pane is on. */
function GlyphButtons(props: PaneTogglesProps) {
  const { shown, swapped, keys = {}, className } = props
  const { t, both, only, toggle, swap } = usePanes(props)
  const button = (pane: Pane) => (
    <ChromeButton
      icon={ICON[pane]}
      label={t[pane]}
      compact
      pressed={shown[pane]}
      aria-disabled={only(pane) || undefined}
      {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })}
      onClick={() => toggle(pane)}
    />
  )
  return (
    <fieldset aria-label={t.label} data-pane-toggles className={cx(s.toggles, className)}>
      {button('talk')}
      {button('board')}
      <SwapButton label={t.swap} pressed={both && swapped} can={both} onSwap={swap} />
    </fieldset>
  )
}

const LOOK: Record<MapLook, string | undefined> = {
  tiles: s.tiles,
  raised: s.raised,
  window: s.window,
  ink: s.ink,
  mini: s.mini,
}

/**
 * The layout map: one small drawing of the window, its two panes as they sit, the conversation the narrower; each half
 * shows or hides its pane. Swap beside it.
 *
 * - tiles: the first, a grey tile on each half that shows, in a frame.
 * - raised: on a segmented control's track, as the views beside it; a half that shows is raised paper.
 * - window: one framed window split by a hairline; a half that shows is paper, one hidden empty.
 * - ink: drawn in lines like an icon, nothing filled; a half that shows has its glyph in ink, one hidden faint.
 * - mini: a miniature of what each pane holds, lines of talk and lanes of cards, drawn while it shows.
 */
function LayoutMap(props: PaneTogglesProps & { look: MapLook }) {
  const { shown, swapped, keys = {}, className, look } = props
  const { t, both, only, toggle, swap, sides } = usePanes(props)
  return (
    <fieldset aria-label={t.label} data-pane-toggles className={cx(s.toggles, className)}>
      <span className={cx(s.map, LOOK[look])}>
        {sides.map((pane) => (
          <Tooltip key={pane} label={t[pane]} {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })} placement="below">
            <button
              type="button"
              className={cx(s.half, pane === 'talk' ? s.talkHalf : s.boardHalf)}
              aria-label={t[pane]}
              aria-pressed={shown[pane]}
              aria-disabled={only(pane) || undefined}
              onClick={() => toggle(pane)}
            >
              {look === 'mini' ? <Miniature pane={pane} /> : <Icon name={ICON[pane]} size={12} />}
            </button>
          </Tooltip>
        ))}
      </span>
      <SwapButton label={t.swap} pressed={both && swapped} can={both} onSwap={swap} />
    </fieldset>
  )
}

function SwapButton({ label, pressed, can, onSwap }: { label: string; pressed: boolean; can: boolean; onSwap: () => void }) {
  return <ChromeButton icon="swap" label={label} pressed={pressed} compact aria-disabled={!can || undefined} onClick={onSwap} />
}

/** What a pane holds, drawn small: the conversation's lines, one of them the person's on the right; the board's lanes of cards. */
function Miniature({ pane }: { pane: Pane }) {
  if (pane === 'talk')
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true" className={s.miniature}>
        <path d="M5 2.5h6M1 5.5h10M1 8h7.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      </svg>
    )
  return (
    <svg viewBox="0 0 22 12" width={22} height={12} aria-hidden="true" className={s.miniature}>
      <rect x={1} y={1.5} width={5.5} height={3.5} rx={1} fill="currentColor" />
      <rect x={1} y={6.5} width={5.5} height={3.5} rx={1} fill="currentColor" />
      <rect x={8.25} y={1.5} width={5.5} height={3.5} rx={1} fill="currentColor" />
      <rect x={15.5} y={1.5} width={5.5} height={3.5} rx={1} fill="currentColor" />
      <rect x={15.5} y={6.5} width={5.5} height={3.5} rx={1} fill="currentColor" />
    </svg>
  )
}
