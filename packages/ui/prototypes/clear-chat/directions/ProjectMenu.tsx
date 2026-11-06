// Scrappy: the project's ⋯ in its header, as each direction has it: what it is made of, as built, and the direction's clear.
import { useState } from 'react'

import { ChromeButton } from '../../../src/chrome/ChromeButton/ChromeButton'
import type { ProjectPart } from '../../../src/chrome/ProjectHeader/ProjectHeader'
import { BrandMark } from '../../../src/foundations/Marks/Marks'
import { Button } from '../../../src/primitives/Button/Button'
import { Choices } from '../../../src/primitives/Choices/Choices'
import { Dialog } from '../../../src/primitives/Dialog/Dialog'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../../src/primitives/Menu/Menu'
import { conversationsOf, type Direction, proto, type Talk } from '../state'
import s from './directions.module.css'

export const menuText = {
  trigger: 'More for this project',
  madeOf: 'Made of',
  clearAsk: 'Clear the conversation…',
  clear: 'Clear the conversation',
  newConversation: 'New conversation',
  earlier: 'Earlier conversations',
  dialogTitle: 'Clear the conversation?',
  dialogAbout: 'Tasks at work, and cards waiting on you, stay.',
  keep: 'Keep what the coordinator knows',
  keepNote: 'It still remembers this conversation, and you can read it again from the top of the thread.',
  wipe: 'Forget it too',
  wipeNote: 'The coordinator starts fresh, with the project’s notes and its records of tasks.',
  cancel: 'Cancel',
  doClear: 'Clear',
  doWipe: 'Clear and forget',
}
const t = menuText

const clock = (iso: string | null) =>
  iso === null ? '' : new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** A line no longer than a menu row holds; the rest on hover, as the row's title. */
const short = (text: string | null, length = 34) =>
  text === null ? '' : text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`

export function ProjectMenu({ direction, talk, parts }: { direction: Direction; talk: Talk; parts: ReadonlyArray<ProjectPart> }) {
  const [asking, setAsking] = useState(false)
  const said = talk.items.some((item) => item.kind === 'user_message')
  // C: a conversation with nothing said in it yet has nothing to begin again from.
  const begun = talk.items.some((item) => item.kind === 'user_message' && item.sequence >= talk.starts.at(-1)!)
  const conversations = conversationsOf(talk).filter((one) => !one.current)
  const ours =
    direction === 'A'
      ? [
          <MenuItem key="clear" icon="remove" disabled={!said} onSelect={() => setAsking(true)}>
            {t.clearAsk}
          </MenuItem>,
        ]
      : direction === 'B'
        ? [
            <MenuItem
              key="clear"
              icon="remove"
              disabled={!said || (talk.cleared !== null && !talk.saidSince)}
              onSelect={() => proto.clearView(false)}
            >
              {t.clear}
            </MenuItem>,
          ]
        : direction === 'C'
          ? [
              <MenuItem key="new" icon="plus" disabled={!begun} onSelect={proto.newConversation}>
                {t.newConversation}
              </MenuItem>,
              ...(conversations.length === 0
                ? []
                : [
                    <MenuSeparator key="rule-earlier" />,
                    <MenuGroup key="earlier" label={t.earlier}>
                      {conversations.toReversed().map((one) => (
                        <MenuItem key={one.index} icon="clock" hint={clock(one.began)} onSelect={() => proto.view(one.index)}>
                          <span title={one.first ?? undefined}>{short(one.first)}</span>
                        </MenuItem>
                      ))}
                    </MenuGroup>,
                  ]),
            ]
          : []
  return (
    <>
      <Menu label={t.trigger} align="end" width={300} trigger={<ChromeButton icon="more" label={t.trigger} compact />}>
        {ours}
        {ours.length > 0 && parts.length > 0 && <MenuSeparator />}
        {parts.length > 0 && (
          <MenuGroup label={t.madeOf}>
            {parts.map((part) => (
              <MenuItem
                key={part.id}
                lead={
                  part.brand === undefined ? <span className={s.noMark} aria-hidden="true" /> : <BrandMark brand={part.brand} size={14} />
                }
                {...(part.openLabel === undefined ? {} : { hint: part.openLabel })}
                disabled={part.onOpen === undefined}
                onSelect={() => part.onOpen?.()}
              >
                {part.name}
              </MenuItem>
            ))}
          </MenuGroup>
        )}
      </Menu>
      {asking && <ClearDialog onClose={() => setAsking(false)} />}
    </>
  )
}

/** A: the one confirm, both kinds in it; keeping is chosen as it opens, forgetting is the danger. */
function ClearDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'view' | 'wipe'>('view')
  return (
    <Dialog
      title={t.dialogTitle}
      description={t.dialogAbout}
      onClose={onClose}
      width={440}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant={kind === 'wipe' ? 'danger' : 'default'}
            onClick={() => {
              onClose()
              if (kind === 'wipe') proto.forget(true)
              else proto.clearView(true)
            }}
          >
            {kind === 'wipe' ? t.doWipe : t.doClear}
          </Button>
        </>
      }
    >
      <Choices<'view' | 'wipe'>
        label={t.dialogTitle}
        className={s.choices}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'view', title: t.keep, note: t.keepNote },
          { value: 'wipe', title: t.wipe, note: t.wipeNote },
        ]}
      />
    </Dialog>
  )
}
