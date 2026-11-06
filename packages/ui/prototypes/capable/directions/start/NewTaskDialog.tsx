// Scrappy, direction A: New task opens a dialog over whatever the project shows: the words or Linear's issues, then who leads, review, where it goes; Start starts it at once.
import { useRef } from 'react'

import { BranchSelect } from '../../../../src/primitives/BranchSelect/BranchSelect'
import { Button } from '../../../../src/primitives/Button/Button'
import { CheckList } from '../../../../src/primitives/CheckList/CheckList'
import { Dialog } from '../../../../src/primitives/Dialog/Dialog'
import { FieldArea } from '../../../../src/primitives/Field/Field'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { Segmented } from '../../../../src/primitives/Segmented/Segmented'
import { Switch } from '../../../../src/primitives/Switch/Switch'
import { modKey } from '../../../../src/foundations/keys'
import { LINEAR } from '../../data'
import { proto } from '../../state'
import { BRANCHES, type Draft, LeadPick, routed, SOL, tasksOf, useDraft } from './pieces'
import s from './start.module.css'

export const text = {
  title: 'New task',
  kind: { task: 'Task', small: 'Small change' },
  words: 'What should it do?',
  from: { words: 'Describe it', linear: 'From Linear' },
  issues: 'Open issues in Althar, not in a task',
  lead: 'Lead',
  review: 'Review',
  reviewBy: (model: string) => `By ${model}`,
  noReview: 'No review',
  into: 'Into',
  worksIn: 'Works in',
  worktree: 'Worktree',
  checkout: 'Your checkout',
  small: 'Starts now beside the work under way, with no review, and opens its pull request when done.',
  coordinator: 'Ask the coordinator instead',
  cancel: 'Cancel',
  start: (n: number, small: boolean) => (small ? 'Start small change' : n > 1 ? `Start ${n} tasks` : 'Start'),
}

/** The draft as rows: who leads it, review, where it goes. Shared by the dialog and the board's card. */
export function Rows({ draft, set, compact = false }: { draft: Draft; set: (next: Partial<Draft>) => void; compact?: boolean }) {
  const words =
    draft.from === 'linear'
      ? LINEAR.filter((one) => draft.issues.includes(one.key))
          .map((one) => one.title)
          .join(' ')
      : draft.words
  return (
    <dl className={compact ? s.rowsCompact : s.rows}>
      <div className={s.row}>
        <dt>{text.lead}</dt>
        <dd>
          <LeadPick value={draft.lead} onChange={(lead) => set({ lead })} words={words} small={draft.small} />
          {draft.lead.id === 'auto' && <span className={s.note}>{routed(words, draft.small).why}</span>}
        </dd>
      </div>
      {!draft.small && (
        <div className={s.row}>
          <dt>{text.review}</dt>
          <dd>
            <Switch checked={draft.review} onChange={(review) => set({ review })} label={text.review} />
            <span className={s.note}>{draft.review ? text.reviewBy(SOL.short) : text.noReview}</span>
          </dd>
        </div>
      )}
      <div className={s.row}>
        <dt>{text.into}</dt>
        <dd>
          <BranchSelect
            label={text.into}
            value={draft.toward}
            branches={BRANCHES}
            defaultBranch="main"
            onChange={(toward) => set({ toward })}
            variant="filled"
          />
        </dd>
      </div>
      <div className={s.row}>
        <dt>{text.worksIn}</dt>
        <dd>
          <Segmented<Draft['worksIn']>
            label={text.worksIn}
            value={draft.worksIn}
            onChange={(worksIn) => set({ worksIn })}
            options={[
              { value: 'worktree', label: text.worktree },
              { value: 'checkout', label: text.checkout },
            ]}
          />
        </dd>
      </div>
    </dl>
  )
}

/** Linear's open issues to pick from, several for a batch. */
export function Issues({ draft, set }: { draft: Draft; set: (next: Partial<Draft>) => void }) {
  return (
    <CheckList
      label={text.issues}
      className={s.issues}
      items={LINEAR.map((one) => ({ id: one.key, label: `${one.key}  ${one.title}` }))}
      value={draft.issues}
      onChange={(issues) => set({ issues })}
    />
  )
}

export function NewTaskDialog({ onCoordinator }: { onCoordinator: (words: string) => void }) {
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
    <Dialog
      title={text.title}
      width={600}
      tall
      onClose={() => proto.set({ composing: false })}
      onSubmit={start}
      actions={
        <>
          {!linear && (
            <LinkButton className={s.aside} onClick={() => onCoordinator(draft.words)}>
              {text.coordinator}
            </LinkButton>
          )}
          <Button variant="quiet" onClick={() => proto.set({ composing: false })}>
            {text.cancel}
          </Button>
          <Button variant="ink" type="submit" disabled={!ready} kbd={modKey('↵')}>
            {text.start(count, draft.small)}
          </Button>
        </>
      }
    >
      <div className={s.top}>
        <Segmented<'task' | 'small'>
          label="Kind"
          value={draft.small ? 'small' : 'task'}
          onChange={(kind) => set({ small: kind === 'small', issues: kind === 'small' ? draft.issues.slice(0, 1) : draft.issues })}
          options={[
            { value: 'task', label: text.kind.task },
            { value: 'small', label: text.kind.small },
          ]}
        />
        <Segmented<'words' | 'linear'>
          label="From"
          value={linear ? 'linear' : 'words'}
          onChange={(from) => {
            set({ from, issues: from === 'linear' && draft.issues.length === 0 ? [LINEAR[0].key] : draft.issues })
            if (from === 'words') window.setTimeout(() => field.current?.focus(), 0)
          }}
          options={[
            { value: 'words', label: text.from.words },
            { value: 'linear', label: text.from.linear },
          ]}
        />
      </div>
      {linear ? (
        <Issues draft={draft} set={(next) => set(draft.small && next.issues ? { issues: next.issues.slice(-1) } : next)} />
      ) : (
        <FieldArea
          ref={(element) => {
            field.current = element
            if (element !== null && document.activeElement === document.body) element.focus()
          }}
          rows={4}
          className={s.words}
          aria-label={text.words}
          placeholder={text.words}
          value={draft.words}
          onChange={(event) => set({ words: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              start()
            }
          }}
        />
      )}
      {draft.small && <p className={s.fast}>{text.small}</p>}
      <Rows draft={draft} set={set} />
    </Dialog>
  )
}
