// Scrappy, direction B: the project's composer starts a task itself, or talks to the coordinator, by a switch on its edge; what a task needs sits in its lower row.
import { Menu, MenuCheckboxItem, MenuGroup, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { Segmented } from '../../../../src/primitives/Segmented/Segmented'
import { LINEAR } from '../../data'
import { proto, useProto } from '../../state'
import { BRANCHES, type Draft, LeadPick, LinearMark, SOL, tasksOf } from './pieces'
import s from './composer.module.css'

export const composerText = {
  to: 'Send to',
  coordinator: 'Coordinator',
  task: 'New task',
  placeholder: 'What should the task do?',
  smallPlaceholder: 'What should the small change do?',
  small: 'Small change',
  smallNote: 'No review, starts now',
  review: 'Review',
  reviewNote: (model: string) => `By ${model}`,
  noReview: 'No review',
  into: 'Into',
  where: 'Where it goes',
  worksIn: 'Works in',
  worktree: 'Worktree',
  checkout: 'Your checkout',
  linear: 'From Linear',
  issues: (n: number) => (n === 1 ? '1 issue' : `${n} issues`),
}

export const useComposerDraft = () => {
  const p = useProto()
  const draft = p.composer
  const set = (next: Partial<Draft>) => proto.set({ composer: { ...proto.get().composer, ...next } })
  const start = () => {
    const now = proto.get().composer
    if (now.from === 'linear' ? now.issues.length === 0 : now.words.trim() === '') return
    proto.start(tasksOf(now).map((one) => ({ ...one, words: now.from === 'linear' ? null : now.words })))
  }
  return { draft, set, start }
}

type Task = ReturnType<typeof useComposerDraft>

/** A chip in the composer's lower row: a word that opens its choice. */
const Chip = ({ children, on = false, ...rest }: { children: React.ReactNode; on?: boolean } & React.ComponentProps<'button'>) => (
  <button type="button" className={on ? s.chipOn : s.chip} {...rest}>
    {children}
  </button>
)

/** The lower row in task mode: the lead's model, then what the task is set up with, each a word that opens its choice. */
export function ComposerStart({ task }: { task: Task }) {
  const { draft, set } = task
  const words =
    draft.from === 'linear'
      ? LINEAR.filter((one) => draft.issues.includes(one.key))
          .map((one) => one.title)
          .join(' ')
      : draft.words
  return (
    <span className={s.row}>
      <LeadPick value={draft.lead} onChange={(lead) => set({ lead })} words={words} small={draft.small} variant="quiet" placement="above" />
      <Chip on={draft.small} aria-pressed={draft.small} onClick={() => set({ small: !draft.small })} title={composerText.smallNote}>
        {composerText.small}
      </Chip>
      {!draft.small && (
        <Menu
          label={composerText.review}
          placement="above"
          width={240}
          trigger={<Chip>{draft.review ? composerText.review : composerText.noReview}</Chip>}
        >
          <MenuRadioGroup
            label={composerText.review}
            value={draft.review ? 'on' : 'off'}
            onChange={(value) => set({ review: value === 'on' })}
          >
            <MenuRadioItem value="on" description={composerText.reviewNote(SOL.short)}>
              {composerText.review}
            </MenuRadioItem>
            <MenuRadioItem value="off">{composerText.noReview}</MenuRadioItem>
          </MenuRadioGroup>
        </Menu>
      )}
      <Menu
        label={composerText.where}
        placement="above"
        width={260}
        trigger={<Chip>{`${draft.toward}${draft.worksIn === 'checkout' ? ` · ${composerText.checkout}` : ''}`}</Chip>}
      >
        <MenuRadioGroup label={composerText.into} value={draft.toward} onChange={(toward) => set({ toward })}>
          {BRANCHES.map((branch) => (
            <MenuRadioItem key={branch} value={branch}>
              {branch}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuRadioGroup
          label={composerText.worksIn}
          value={draft.worksIn}
          onChange={(worksIn) => set({ worksIn: worksIn as Draft['worksIn'] })}
        >
          <MenuRadioItem value="worktree">{composerText.worktree}</MenuRadioItem>
          <MenuRadioItem value="checkout">{composerText.checkout}</MenuRadioItem>
        </MenuRadioGroup>
      </Menu>
      <Menu
        label={composerText.linear}
        placement="above"
        width={380}
        trigger={
          <Chip on={draft.issues.length > 0}>
            <LinearMark />
            {draft.issues.length > 0 ? composerText.issues(draft.issues.length) : composerText.linear}
          </Chip>
        }
      >
        <MenuGroup label="Althar · not in a task">
          {LINEAR.map((one) => (
            <MenuCheckboxItem
              key={one.key}
              keepOpen
              checked={draft.issues.includes(one.key)}
              onCheckedChange={(on) => {
                const issues = on ? [...draft.issues, one.key] : draft.issues.filter((key) => key !== one.key)
                set({ issues, from: issues.length > 0 ? 'linear' : 'words' })
              }}
            >
              {one.key} {one.title}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
      </Menu>
    </span>
  )
}

/** On the composer's edge: whom what is written goes to. */
ComposerStart.To = function To() {
  const p = useProto()
  if (p.surface !== 'start' || p.direction !== 'B') return null
  return (
    <span className={s.to}>
      <Segmented<'coordinator' | 'task'>
        label={composerText.to}
        value={p.to}
        onChange={(to) => proto.set({ to })}
        options={[
          { value: 'task', label: composerText.task },
          { value: 'coordinator', label: composerText.coordinator },
        ]}
      />
    </span>
  )
}
