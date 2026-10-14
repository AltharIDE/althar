// Scrappy: what a path puts inside three kit components, through the slots the server patches into them (vite.config.mjs).
import { type ReactNode, useState } from 'react'

import { LinkButton, MenuCheckboxItem, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Select } from '@althar/ui'

// The card's own styles, for a line in it as the card writes its own.
import card from '../../../../packages/ui/src/thread/Permission/Permission.module.css'
import { promptOf } from './data'
import { nav } from './nav'
import { RulesFor, RulesModes, RulesSwitch } from './parts'
import { allowFor, endNow, setChipOpen, setMenuOpen, setTaskMode, stopAsking, type Until, useProto } from './store'
import { words } from './words'

/** What a card adds: a line under its answers, and an answer of its own after the card's. */
export interface CardSlot {
  readonly note?: ReactNode
  readonly extra?: {
    readonly label: string
    /** Beside its words, as the scope of an "always" is. */
    readonly beside?: ReactNode
    /** Under it, once it is picked. */
    readonly under?: ReactNode
    /** The card's button, while it is picked. */
    readonly button: string
    readonly onChoose: () => void
  }
}

const toRules = () => <LinkButton onClick={() => nav.go('/projects/p1/rules')}>{words.rules}</LinkButton>

/** In the permission card: why it has no "always allow", where its kind always asks, with a way out; and C's and D's answer. */
export function useCardSlot(request: { id: string; pos?: number | undefined; total?: number | undefined }): CardSlot | null {
  const st = useProto()
  const [until, setUntil] = useState<Until>('hour')
  const prompt = promptOf(request.id)
  if (st.path === 'T' || prompt === undefined) return null
  const kind = prompt.kind !== null && st.rules.alwaysAsk.includes(prompt.kind) ? prompt.kind : null
  const waiting = (request.total ?? 1) - (request.pos ?? 1) + 1
  const why = (after: ReactNode) =>
    kind === null ? undefined : (
      <p className={card.why}>
        {words.noAlways(kind, 'meridian')} {after}
      </p>
    )
  const under = (text: string) => <span className={`${card.why} ${card.note}`}>{text}</span>
  switch (st.path) {
    case 'A':
      return {
        note: why(
          <>
            <LinkButton onClick={() => setMenuOpen(true)}>{words.A.wayOut}</LinkButton> · {toRules()}
          </>,
        ),
      }
    case 'B':
      return {
        note: why(
          <>
            <LinkButton onClick={() => setChipOpen(true)}>{words.B.wayOut}</LinkButton> · {toRules()}
          </>,
        ),
      }
    case 'C':
      return {
        note: why(
          <>
            {words.C.alsoHere} {toRules()}
          </>,
        ),
        extra: {
          label: words.C.option,
          under: under(words.C.under(waiting)),
          button: words.C.button,
          onChoose: () => stopAsking(request.id),
        },
      }
    case 'BC':
      return {
        note: why(
          <>
            {words.BC.alsoHere} {toRules()}
          </>,
        ),
        extra: {
          label: words.BC.option,
          under: under(words.BC.under(waiting)),
          button: words.BC.button,
          onChoose: () => stopAsking(request.id),
        },
      }
    case 'D':
      return {
        note: why(
          <>
            {words.D.alsoHere} {toRules()}
          </>,
        ),
        extra: {
          label: words.D.option,
          beside: (
            <Select<Until>
              variant="filled"
              label="For how long"
              value={until}
              onChange={setUntil}
              options={(['hour', 'task', 'off'] as const).map((one) => ({ value: one, label: words.D.until[one] }))}
            />
          ),
          under: under(words.holds),
          button: words.D.button,
          onChoose: () => allowFor(until, request.id),
        },
      }
  }
}

/** In the task's menu: A's switch, C's way back, D's for how long; and the menu's open, so a card's way out can open it. */
export function useMenuSlot(): { readonly items: ReactNode; readonly open: boolean; readonly onOpenChange: (open: boolean) => void } {
  const st = useProto()
  const base = { open: st.menuOpen, onOpenChange: setMenuOpen }
  switch (st.path) {
    case 'A':
      return {
        ...base,
        items: (
          <>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={st.taskMode === 'allow'}
              onCheckedChange={(on) => setTaskMode(on ? 'allow' : null)}
              description={words.A.taskNote}
            >
              {words.A.task}
            </MenuCheckboxItem>
          </>
        ),
      }
    case 'C':
      return {
        ...base,
        items:
          st.taskMode === 'allow' ? (
            <>
              <MenuSeparator />
              <MenuItem icon="lock" description={words.C.askAgainNote} onSelect={() => setTaskMode(null)}>
                {words.C.askAgain}
              </MenuItem>
            </>
          ) : null,
      }
    case 'D':
      return {
        ...base,
        items: (
          <>
            <MenuSeparator />
            <MenuRadioGroup
              label={words.D.menu}
              value={st.taskUntil?.until ?? 'none'}
              onChange={(value) => {
                if (value !== 'none') allowFor(value as Until)
                else if (st.taskUntil !== null) endNow()
              }}
            >
              <MenuRadioItem value="none" description={words.D.menuOffNote}>
                {words.D.menuOff}
              </MenuRadioItem>
              {(['hour', 'task', 'off'] as const).map((one) => (
                <MenuRadioItem key={one} value={one} description={words.D.menuNote[one]}>
                  {words.D.menuItem[one]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        ),
      }
    default:
      return { ...base, items: null }
  }
}

/** At the top of the Rules page: A's switch, B's modes, D's for how long. */
export function useRulesSlot(): ReactNode {
  const st = useProto()
  switch (st.path) {
    case 'A':
      return <RulesSwitch />
    case 'B':
    case 'BC':
      return <RulesModes />
    case 'D':
      return <RulesFor />
    default:
      return null
  }
}
