// Scrappy, direction C: a card at the top of Running you write into; Start leaves it there as the task's own card, at work.
import { useRef } from 'react'

import b from '../../../../src/board/Board/Board.module.css'
import { modKey } from '../../../../src/foundations/keys'
import { Kbd } from '../../../../src/primitives/Kbd/Kbd'
import { FieldArea } from '../../../../src/primitives/Field/Field'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { NextStep, NextSteps } from '../../../../src/primitives/NextStep/NextStep'
import { Segmented } from '../../../../src/primitives/Segmented/Segmented'
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { proto, useProto } from '../../state'
import { Issues, Rows } from './NewTaskDialog'
import { type Draft, tasksOf, useDraft } from './pieces'
import s from './board.module.css'

export const boardText = {
  add: 'New task',
  key: 'N',
  words: 'What should it do?',
  linear: 'From Linear',
  words2: 'Describe it',
  task: 'Task',
  small: 'Small change',
  coordinator: 'Ask the coordinator',
  cancel: 'Cancel',
  start: (n: number, small: boolean) => (small ? 'Start small change' : n > 1 ? `Start ${n} tasks` : 'Start'),
}

export function BoardStart() {
  const p = useProto()
  if (!p.composing)
    return (
      <button type="button" className={s.add} onClick={() => proto.set({ composing: true })}>
        <Icon name="plus" size={12} />
        <span>{boardText.add}</span>
        <Kbd className={s.key}>{boardText.key}</Kbd>
      </button>
    )
  return <Writing />
}

function Writing() {
  const [draft, setDraft] = useDraft()
  const set = (next: Partial<Draft>) => setDraft((was) => ({ ...was, ...next }))
  const field = useRef<HTMLTextAreaElement>(null)
  const linear = draft.from === 'linear'
  const ready = linear ? draft.issues.length > 0 : draft.words.trim() !== ''
  const count = linear ? draft.issues.length : 1
  const start = () => {
    if (ready) proto.start(tasksOf(draft))
  }
  return (
    <article className={`${b.card} ${s.writing}`}>
      <div className={s.head}>
        <Segmented<'task' | 'small'>
          label="Kind"
          value={draft.small ? 'small' : 'task'}
          onChange={(kind) => set({ small: kind === 'small' })}
          options={[
            { value: 'task', label: boardText.task },
            { value: 'small', label: boardText.small },
          ]}
        />
        <LinkButton
          onClick={() => {
            set({ from: linear ? 'words' : 'linear' })
            if (linear) window.setTimeout(() => field.current?.focus(), 0)
          }}
        >
          {linear ? boardText.words2 : boardText.linear}
        </LinkButton>
      </div>
      {linear ? (
        <Issues draft={draft} set={set} />
      ) : (
        <FieldArea
          ref={(element) => {
            field.current = element
            if (element !== null && document.activeElement === document.body) element.focus()
          }}
          rows={3}
          className={s.words}
          aria-label={boardText.words}
          placeholder={boardText.words}
          value={draft.words}
          onChange={(event) => set({ words: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape') proto.set({ composing: false })
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              start()
            }
          }}
        />
      )}
      <Rows draft={draft} set={set} compact />
      <NextSteps className={b.strip}>
        <NextStep onPress={() => proto.set({ composing: false })}>{boardText.cancel}</NextStep>
        <NextStep signal onPress={start} label={`${boardText.start(count, draft.small)}, ${modKey('↵')}`}>
          {boardText.start(count, draft.small)}
        </NextStep>
      </NextSteps>
    </article>
  )
}
