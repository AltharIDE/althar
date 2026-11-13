import type { ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Select } from '../../primitives/Select/Select'
import { SettingList, SettingRow, SettingSwitch } from '../Preferences/Preferences'

/*
 * What the rules of a project start with when it is made, as rows of the
 * Settings tab: how a task ends, what it pushes, posts, resolves and moves
 * along, what an explicitly requested review after merge brings back, what an account running out does and whether work tries an agent's
 * next account first. Only a project made from now on starts with them; every
 * project changes its own in its Tasks, and one made earlier keeps what it
 * has. Allowing everything is the default of every project, so no request is
 * asked about here. Where a project's own value is another, the row says so
 * under its line (`differs`).
 */

/** What happens to the work when an agent's account runs out. */
export type NewUsageLimit = 'move' | 'wait' | 'ask'
/** How a task ends when its plan doesn't say. */
export type NewTaskEnd = 'draft' | 'ready' | 'none'
/** What an explicitly requested review after merge brings back: only major findings, every one, or no review. */
export type AfterMergeReview = 'major' | 'all' | 'none'

export interface NewProjectDefaultsValue {
  end: NewTaskEnd
  pushCommits: boolean
  postScreenshots: boolean
  resolveConflicts: boolean
  moveIssues: boolean
  usageLimit: NewUsageLimit
  rotateAccounts: boolean
  afterMergeReview: AfterMergeReview
}

/** What a project starts with where nothing was chosen, which a row goes back to. */
export const newProjectDefault: NewProjectDefaultsValue = {
  end: 'draft',
  pushCommits: true,
  postScreenshots: false,
  resolveConflicts: true,
  moveIssues: true,
  usageLimit: 'move',
  rotateAccounts: false,
  afterMergeReview: 'major',
}

interface Worded {
  readonly label: string
  readonly note: string
}

export interface NewProjectDefaultsText {
  end: { title: string; options: Record<NewTaskEnd, Worded> }
  pushCommits: { title: string; note: string }
  postScreenshots: { title: string; note: string }
  resolveConflicts: { title: string; note: string }
  moveIssues: { title: string; note: string }
  usageLimit: { title: string; options: Record<NewUsageLimit, Worded> }
  rotate: { title: string; note: string }
  afterMergeReview: { title: string; options: Record<AfterMergeReview, Worded> }
  /** Goes back to what a project starts with, named. */
  reset: (label: string) => string
}

export const newProjectDefaultsText: NewProjectDefaultsText = {
  end: {
    title: 'When a task is done',
    options: {
      draft: { label: 'Open a draft pull request', note: 'Checks run on it; you mark it ready.' },
      ready: { label: 'Open a pull request for review', note: 'Ready for review as soon as its last step passes.' },
      none: { label: 'Push the branch only', note: 'You open the pull request when you want one.' },
    },
  },
  pushCommits: { title: 'Push the lead’s commits automatically', note: 'If someone else pushed there, it waits for you.' },
  postScreenshots: { title: 'Post screenshots to pull requests automatically', note: '' },
  resolveConflicts: { title: 'Resolve merge conflicts automatically', note: '' },
  moveIssues: { title: 'Move issues along with their tasks', note: 'To In Progress, In Review, then Done.' },
  usageLimit: {
    title: 'When an account runs out',
    options: {
      move: { label: 'Move to the strongest model with usage left', note: 'With none left, the work waits for the reset.' },
      wait: { label: 'Wait for the reset', note: 'The work runs again at the reset.' },
      ask: { label: 'Ask me', note: 'Move it to a model with usage left, or wait for the reset.' },
    },
  },
  rotate: { title: 'Try an agent’s other accounts first', note: '' },
  afterMergeReview: {
    title: 'When a review is set after merge',
    options: {
      major: { label: 'Bring back major findings', note: 'Minor findings and nits stay in the task’s thread.' },
      all: { label: 'Bring back every finding', note: 'Any finding puts the task back in Needs you.' },
      none: { label: 'Don’t review it', note: 'A review configured before Ship is unaffected.' },
    },
  },
  reset: (label) => `Use ${label}`,
}

/** Each row's glyph. */
const GLYPHS: Readonly<Record<keyof NewProjectDefaultsValue, IconName>> = {
  end: 'pr',
  pushCommits: 'up',
  postScreenshots: 'image',
  resolveConflicts: 'conflict',
  moveIssues: 'issues',
  usageLimit: 'load',
  rotateAccounts: 'reload',
  afterMergeReview: 'after',
}

export interface NewProjectDefaultsProps {
  value: NewProjectDefaultsValue
  /** What changed; the rest stays. */
  onChange: (change: Partial<NewProjectDefaultsValue>) => void
  /** Under a row's line, where projects have another value: who has what, and the way to bring them in line (`DifferingProjects`). */
  differs?: Partial<Record<keyof NewProjectDefaultsValue, ReactNode>>
  text?: Partial<NewProjectDefaultsText>
}

/** The rows a new project's rules start from. */
export function NewProjectDefaults({ value, onChange, differs = {}, text }: NewProjectDefaultsProps) {
  const t = { ...newProjectDefaultsText, ...text }
  const glyph = (key: keyof NewProjectDefaultsValue) => <Icon name={GLYPHS[key]} size={15} />
  /** A line: what the choice does, and, away from the start, the way back; then what projects have instead. */
  const note = (key: keyof NewProjectDefaultsValue, line: ReactNode) => {
    const other = differs[key]
    return line === '' && other === undefined ? undefined : (
      <>
        {line}
        {line !== '' && other !== undefined && <br />}
        {other}
      </>
    )
  }
  /** A row with a choice of words at the end. */
  const row = <V extends string>(key: 'end' | 'usageLimit' | 'afterMergeReview', title: string, options: Record<V, Worded>) => {
    const chosen = value[key] as string as V
    const start = newProjectDefault[key] as string as V
    return (
      <SettingRow
        title={title}
        glyph={glyph(key)}
        note={note(
          key,
          <>
            {options[chosen].note}
            {chosen !== start && (
              <>
                {' '}
                <LinkButton onClick={() => onChange({ [key]: start })}>{t.reset(options[start].label)}</LinkButton>
              </>
            )}
          </>,
        )}
      >
        {() => (
          <Select<V>
            label={title}
            value={chosen}
            onChange={(next) => onChange({ [key]: next })}
            options={(Object.keys(options) as V[]).map((option) => ({ value: option, label: options[option].label }))}
            width={250}
          />
        )}
      </SettingRow>
    )
  }
  const toggle = (
    key: 'pushCommits' | 'postScreenshots' | 'resolveConflicts' | 'moveIssues' | 'rotateAccounts',
    words: { title: string; note: string },
  ) => (
    <SettingSwitch
      title={words.title}
      glyph={glyph(key)}
      {...(note(key, words.note) === undefined ? {} : { note: note(key, words.note) })}
      checked={value[key]}
      onChange={(next) => onChange({ [key]: next })}
    />
  )
  return (
    <SettingList>
      {row('end', t.end.title, t.end.options)}
      {toggle('pushCommits', t.pushCommits)}
      {toggle('postScreenshots', t.postScreenshots)}
      {toggle('resolveConflicts', t.resolveConflicts)}
      {toggle('moveIssues', t.moveIssues)}
      {row('afterMergeReview', t.afterMergeReview.title, t.afterMergeReview.options)}
      {row('usageLimit', t.usageLimit.title, t.usageLimit.options)}
      {toggle('rotateAccounts', t.rotate)}
    </SettingList>
  )
}
