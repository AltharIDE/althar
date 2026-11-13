import { MenuCheckboxItem, MenuGroup } from '../../primitives/Menu/Menu'

/*
 * The panes of a project's home: the conversation with its coordinator and the
 * board of its work, either or both, and which side the conversation is on.
 * They are laid out from the Layout group of the header's ⋯ menu
 * (ProjectHeader), not from controls of their own, so the header holds only
 * where you are and what runs. Each pane is a check; one stays showing, so the
 * only one showing can't be unchecked, and sides change only while both show.
 * Away from the home (its automations, its settings), neither is checked, and
 * checking one goes back home with it showing.
 * The keys are the consumer's to bind; the menu names them.
 */

/** A pane of the home. */
export type Pane = 'talk' | 'board'

export interface PaneLayoutText {
  /** The menu's group. */
  layout: string
  talk: string
  board: string
  /** Swap, as a choice. */
  talkRight: string
}

export const paneLayoutText: PaneLayoutText = {
  layout: 'Layout',
  talk: 'Conversation',
  board: 'Board',
  talkRight: 'Conversation on the right',
}

export interface PaneLayoutProps {
  /** Which panes show now. */
  shown: Readonly<Record<Pane, boolean>>
  /** A pane checked or unchecked: show it, or hide it. */
  onToggle: (pane: Pane) => void
  /** The conversation is on the right of the board. */
  swapped: boolean
  onSwap: () => void
  /** Each pane's key, as the menu says it; the consumer binds them. */
  keys?: Partial<Record<Pane, string>>
  text?: Partial<PaneLayoutText>
}

const PANES = ['talk', 'board'] as const

/** The Layout group of a menu: each pane as a check, with its key, then which side the conversation is on. */
export function PaneLayoutGroup({ shown, onToggle, swapped, onSwap, keys = {}, text }: PaneLayoutProps) {
  const t = { ...paneLayoutText, ...text }
  const both = shown.talk && shown.board
  return (
    <MenuGroup label={t.layout}>
      {PANES.map((pane) => (
        <MenuCheckboxItem
          key={pane}
          checked={shown[pane]}
          // The only pane showing stays.
          disabled={shown[pane] && !both}
          {...(keys[pane] === undefined ? {} : { kbd: keys[pane] })}
          onCheckedChange={() => onToggle(pane)}
        >
          {t[pane]}
        </MenuCheckboxItem>
      ))}
      <MenuCheckboxItem checked={swapped} disabled={!both} onCheckedChange={onSwap}>
        {t.talkRight}
      </MenuCheckboxItem>
    </MenuGroup>
  )
}
