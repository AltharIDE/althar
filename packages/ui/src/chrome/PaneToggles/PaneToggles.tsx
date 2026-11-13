import { createContext, type ReactNode, useContext } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { MenuCheckboxItem, MenuGroup } from '../../primitives/Menu/Menu'
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
  /** In the ⋯ menu: its group, and swap as a choice. */
  layout: string
  talkRight: string
}

export const paneTogglesText: PaneTogglesText = {
  label: 'Panes',
  talk: 'Conversation',
  board: 'Board',
  swap: 'Swap sides',
  layout: 'Layout',
  talkRight: 'Conversation on the right',
}

/** How the toggles are drawn, for the home lab to compare: today's glyph buttons, or the layout map one of five ways. */
export type PaneTogglesDesign = 'today' | MapLook

/** How the layout map is drawn, and how much of the layout goes in the header's ⋯ menu instead. */
type MapLook = 'soft' | 'loose' | 'menu'

export const paneTogglesDesigns: ReadonlyArray<{ readonly key: MapLook; readonly label: string }> = [
  { key: 'soft', label: 'Framed, swap beside (now)' },
  { key: 'loose', label: 'Loose, swap in ⋯' },
  { key: 'menu', label: 'All in ⋯' },
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
  if (design === 'menu') return null
  return design === 'today' ? <GlyphButtons {...props} /> : <LayoutMap {...props} look={design} />
}

/** Whether the header's ⋯ menu holds some of the layout. */
export function useLayoutInMenu(): boolean {
  const design = useContext(Design)
  return design === 'loose' || design === 'menu'
}

/**
 * What of the layout the header's ⋯ menu holds, under its own group: swap, where the map leaves it out; the panes and swap,
 * where the header has no map. Null where the header holds it all.
 */
export function PaneLayoutItems({ panes }: { panes: PaneTogglesProps | undefined }): ReactNode {
  const design = useContext(Design)
  const all = usePanes(panes ?? NO_PANES)
  if (panes === undefined || (design !== 'loose' && design !== 'menu')) return null
  const { shown, swapped, keys = {} } = panes
  const { t, both, only, toggle, swap } = all
  return (
    <MenuGroup label={t.layout}>
      {design === 'menu' &&
        (['talk', 'board'] as const).map((pane) => (
          <MenuCheckboxItem
            key={pane}
            checked={shown[pane]}
            disabled={only(pane)}
            {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })}
            onCheckedChange={() => toggle(pane)}
          >
            {t[pane]}
          </MenuCheckboxItem>
        ))}
      <MenuCheckboxItem checked={swapped} disabled={!both} onCheckedChange={swap}>
        {t.talkRight}
      </MenuCheckboxItem>
    </MenuGroup>
  )
}

const NO_PANES: PaneTogglesProps = { shown: { talk: true, board: true }, onToggle: () => {}, swapped: false, onSwap: () => {} }

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

const LOOK: Record<Exclude<MapLook, 'menu'>, string | undefined> = {
  soft: s.soft,
  loose: s.loose,
}

/**
 * The layout map: one small drawing of the window, its two panes as they sit, the conversation the narrower; each half
 * shows or hides its pane.
 *
 * - soft: framed as tall as the views' switch, a pane that shows tinted in ink; swap beside it.
 * - loose: no frame, its two glyphs loose in the header like the rest; swap in the ⋯ menu.
 */
function LayoutMap(props: PaneTogglesProps & { look: Exclude<MapLook, 'menu'> }) {
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
              <Icon name={ICON[pane]} size={12} />
            </button>
          </Tooltip>
        ))}
      </span>
      {look === 'soft' && <SwapButton label={t.swap} pressed={both && swapped} can={both} onSwap={swap} />}
    </fieldset>
  )
}

function SwapButton({ label, pressed, can, onSwap }: { label: string; pressed: boolean; can: boolean; onSwap: () => void }) {
  return <ChromeButton icon="swap" label={label} pressed={pressed} compact aria-disabled={!can || undefined} onClick={onSwap} />
}
