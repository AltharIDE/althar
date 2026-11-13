import { Brand, CheckState, type ChangeCheck, type ModelInfo } from '@althar/ui'

/* Where a small change can stand, and the states every direction is drawn in. */

export type Phase =
  | 'started'
  | 'changing'
  | 'checks'
  | 'failed'
  | 'ready'
  | 'merging'
  | 'queued'
  | 'reviewing'
  | 'clean'
  | 'findings'
  | 'full'

const model = (id: string, name: string, short: string, mark: Brand): ModelInfo => ({
  id,
  name,
  short,
  mark,
  runtime: 'claude-code',
  context: 1000,
  efforts: ['Low', 'Medium', 'High'],
})

export const SONNET = model('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Sonnet 5.5', Brand.Anthropic)
export const SOL = { ...model('gpt-6.1-sol', 'GPT-6.1 Sol', 'GPT-6.1 Sol', Brand.OpenAI), runtime: 'codex' }

export interface SmallState {
  readonly key: Phase
  readonly label: string
  readonly title: string
  readonly pr: number
  /** Clock times, as the thread says them. */
  readonly started: string
  readonly changed?: string
  readonly checked?: string
  readonly merged?: string
  readonly reviewed?: string
  /** What it changed, once it has. */
  readonly files?: number
  readonly add?: number
  readonly del?: number
  readonly checks?: readonly ChangeCheck[]
  /** Minutes since it started, for the direction that leads with them. */
  readonly minutes: number
  readonly findings?: number
}

const check = (name: string, state: CheckState, detail?: string): ChangeCheck => ({
  id: name,
  name,
  state,
  ...(detail === undefined ? {} : { detail }),
})

const PASSED = [
  check('lint', CheckState.Passed),
  check('types', CheckState.Passed),
  check('unit (ui)', CheckState.Passed, '412 passed'),
  check('unit (desktop)', CheckState.Passed, '1,208 passed'),
  check('e2e', CheckState.Passed),
]
const RUNNING = [
  check('lint', CheckState.Passed),
  check('types', CheckState.Passed),
  check('unit (ui)', CheckState.Passed, '412 passed'),
  check('unit (desktop)', CheckState.Running, '3m'),
  check('e2e', CheckState.Queued),
]
const FAILED = [
  check('lint', CheckState.Passed),
  check('types', CheckState.Failed, 'Usage.tsx:88 Property “byTime” does not exist'),
  check('unit (ui)', CheckState.Passed, '412 passed'),
  check('unit (desktop)', CheckState.Passed, '1,208 passed'),
  check('e2e', CheckState.Passed),
]

const base = { title: 'Usage card drops the time breakdown', pr: 763, started: '17:22' }
const made = { ...base, changed: '17:28', files: 6, add: 41, del: 118 }

export const STATES: readonly SmallState[] = [
  { ...base, key: 'started', label: 'Just started', minutes: 0 },
  { ...base, key: 'changing', label: 'Changing', minutes: 3, files: 2, add: 9, del: 31 },
  { ...made, key: 'checks', label: 'Checks running', minutes: 14, checks: RUNNING },
  { ...made, key: 'failed', label: 'Checks failed', minutes: 19, checks: FAILED },
  { ...made, key: 'ready', label: 'Ready to merge', checked: '17:43', minutes: 21, checks: PASSED },
  { ...made, key: 'merging', label: 'Merging', checked: '17:43', minutes: 22, checks: PASSED },
  { ...made, key: 'queued', label: 'In the merge queue', checked: '17:43', minutes: 24, checks: PASSED },
  { ...made, key: 'reviewing', label: 'Merged, review running', checked: '17:43', merged: '17:46', minutes: 24, checks: PASSED },
  {
    ...made,
    key: 'clean',
    label: 'Reviewed, nothing found',
    checked: '17:43',
    merged: '17:46',
    reviewed: '17:58',
    minutes: 24,
    checks: PASSED,
  },
  {
    ...made,
    key: 'findings',
    label: 'Reviewed, 2 findings',
    checked: '17:43',
    merged: '17:46',
    reviewed: '18:01',
    minutes: 24,
    checks: PASSED,
    findings: 2,
  },
  { ...made, key: 'full', label: 'Made a full task', minutes: 16, checks: RUNNING },
]

/** Before Merge: it can still be made a full task. */
export const beforeMerge = (s: SmallState) => ['started', 'changing', 'checks', 'failed', 'ready'].includes(s.key)
export const merged = (s: SmallState) => ['reviewing', 'clean', 'findings'].includes(s.key)
