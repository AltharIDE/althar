import { createContext, useContext } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Menu, MenuCheckboxItem, MenuGroup } from '../../primitives/Menu/Menu'
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
 * Prototype: the toggles are drawn five ways (PaneTogglesDesign), picked by
 * the home lab (apps/desktop/lab/home) through PaneTogglesDesignProvider; the
 * app keeps A, today's.
 */

/** A pane of the home. */
export type Pane = 'talk' | 'board'

export interface PaneTogglesText {
  label: string
  talk: string
  board: string
  swap: string
  /** E: the one button, and its swap as a choice. */
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

/** How the toggles are drawn, for the home lab to compare: A is today's. */
export type PaneTogglesDesign = 'a' | 'b' | 'c' | 'd' | 'e'

export const paneTogglesDesigns: ReadonlyArray<{ readonly key: PaneTogglesDesign; readonly label: string }> = [
  { key: 'a', label: 'Glyph buttons (today)' },
  { key: 'b', label: 'Panel glyphs' },
  { key: 'c', label: 'Word toggles' },
  { key: 'd', label: 'Layout map' },
  { key: 'e', label: 'One layout menu' },
]

const Design = createContext<PaneTogglesDesign>('a')
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
  if (design === 'b') return <PanelGlyphs {...props} />
  if (design === 'c') return <WordToggles {...props} />
  if (design === 'd') return <LayoutMap {...props} />
  if (design === 'e') return <LayoutMenu {...props} />
  return <GlyphButtons {...props} />
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

/** A: today's, three glyphs washed while on, in the same order whichever side each pane is on. */
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

/**
 * B: each toggle a little window with its pane drawn in where it sits, filled while it shows; in the panes' own order, so the
 * left one is the left pane. No wash: the drawing says it.
 */
function PanelGlyphs(props: PaneTogglesProps) {
  const { shown, swapped, keys = {}, className } = props
  const { t, both, only, toggle, swap, sides } = usePanes(props)
  return (
    <fieldset aria-label={t.label} data-pane-toggles className={cx(s.toggles, s.drawn, className)}>
      {sides.map((pane) => (
        <ChromeButton
          key={pane}
          glyph={<Window talk={pane === 'talk' && shown.talk} board={pane === 'board' && shown.board} swapped={swapped} mark={pane} />}
          label={t[pane]}
          compact
          pressed={shown[pane]}
          aria-disabled={only(pane) || undefined}
          {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })}
          onClick={() => toggle(pane)}
        />
      ))}
      <SwapButton label={t.swap} pressed={both && swapped} can={both} onSwap={swap} />
    </fieldset>
  )
}

/** C: the panes' names on a track, each raised while it shows, both at once if they do; between them, swap, and they change places with their panes. */
function WordToggles(props: PaneTogglesProps) {
  const { shown, swapped, keys = {}, className } = props
  const { t, both, only, toggle, swap, sides } = usePanes(props)
  const word = (pane: Pane) => (
    <Tooltip key={pane} label={t[pane]} {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })} placement="below">
      <button
        type="button"
        className={s.word}
        aria-pressed={shown[pane]}
        aria-disabled={only(pane) || undefined}
        onClick={() => toggle(pane)}
      >
        {t[pane]}
      </button>
    </Tooltip>
  )
  return (
    <fieldset aria-label={t.label} data-pane-toggles className={cx(s.track, className)}>
      {word(sides[0]!)}
      <Tooltip label={t.swap} placement="below">
        <button
          type="button"
          className={s.between}
          aria-label={t.swap}
          aria-pressed={both && swapped}
          aria-disabled={!both || undefined}
          onClick={swap}
        >
          <Icon name="swap" size={11} />
        </button>
      </Tooltip>
      {word(sides[1]!)}
    </fieldset>
  )
}

/** D: one small drawing of the window, its two panes as they sit; each half shows or hides its pane, filled while it shows. */
function LayoutMap(props: PaneTogglesProps) {
  const { shown, swapped, keys = {}, className } = props
  const { t, both, only, toggle, swap, sides } = usePanes(props)
  return (
    <fieldset aria-label={t.label} data-pane-toggles className={cx(s.toggles, className)}>
      <span className={s.map}>
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
      <SwapButton label={t.swap} pressed={both && swapped} can={both} onSwap={swap} />
    </fieldset>
  )
}

/** E: one button, drawn as the layout it is on; its menu has each pane as a check, and the conversation's side. */
function LayoutMenu(props: PaneTogglesProps) {
  const { shown, swapped, keys = {}, className } = props
  const { t, both, only, toggle, swap } = usePanes(props)
  const check = (pane: Pane) => (
    <MenuCheckboxItem
      checked={shown[pane]}
      disabled={only(pane)}
      keepOpen
      {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })}
      onCheckedChange={() => toggle(pane)}
    >
      {t[pane]}
    </MenuCheckboxItem>
  )
  return (
    <span data-pane-toggles className={cx(s.toggles, className)}>
      <Menu
        label={t.layout}
        align="end"
        width={240}
        trigger={
          <ChromeButton
            glyph={<Window talk={shown.talk} board={shown.board} swapped={swapped} />}
            label={t.layout}
            compact
            className={s.drawnButton}
          />
        }
      >
        <MenuGroup label={t.label}>
          {check('talk')}
          {check('board')}
          <MenuCheckboxItem checked={both && swapped} disabled={!both} keepOpen onCheckedChange={swap}>
            {t.talkRight}
          </MenuCheckboxItem>
        </MenuGroup>
      </Menu>
    </span>
  )
}

function SwapButton({ label, pressed, can, onSwap }: { label: string; pressed: boolean; can: boolean; onSwap: () => void }) {
  return <ChromeButton icon="swap" label={label} pressed={pressed} compact aria-disabled={!can || undefined} onClick={onSwap} />
}

/**
 * A little window, the conversation the narrower side: what shows is filled. `mark` draws that pane's outline a little
 * heavier, so a toggle's own pane reads where it sits even while hidden.
 */
function Window({ talk, board, swapped, mark }: { talk: boolean; board: boolean; swapped: boolean; mark?: Pane }) {
  // The frame's inside runs from 2.5 to 13.5; the conversation takes 4.5 of it, on its side.
  const split = swapped ? 9 : 7
  const left = { x: 3.5, width: split - 4.5 }
  const right = { x: split + 1, width: 12.5 - (split + 1) }
  const talkAt = swapped ? right : left
  const boardAt = swapped ? left : right
  const region = (at: { x: number; width: number }, on: boolean, own: boolean) => (
    <rect
      x={at.x}
      y={4.75}
      width={at.width}
      height={6.5}
      rx={0.75}
      fill={on ? 'currentColor' : 'none'}
      fillOpacity={0.55}
      stroke={own && !on ? 'currentColor' : 'none'}
      strokeWidth={0.75}
      strokeDasharray={own && !on ? '1.25 1.25' : undefined}
      strokeOpacity={0.7}
    />
  )
  return (
    <svg viewBox="0 0 16 16" width={15} height={15} fill="none" aria-hidden="true" className={s.window}>
      <rect x={1.75} y={3} width={12.5} height={10} rx={2} stroke="currentColor" strokeWidth={1.25} />
      <path d={`M${split} 3.5v9`} stroke="currentColor" strokeWidth={1} strokeOpacity={0.6} />
      {region(talkAt, talk, mark === 'talk')}
      {region(boardAt, board, mark === 'board')}
    </svg>
  )
}
