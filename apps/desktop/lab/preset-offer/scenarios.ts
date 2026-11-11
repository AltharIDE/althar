import type { PresetParts } from './runtime'
import type { Setup } from './rules'

/* The setups each scenario's rules read, newest last. */

const OPUS = 'claude-code/claude-opus-5-5'
const SONNET = 'claude-code/claude-sonnet-5-5'
const part = (p: Partial<PresetParts>): PresetParts => ({
  workspace: 'worktree',
  checked: 'before',
  end: 'draft',
  shelf: 'board',
  lead: OPUS,
  reviewer: null,
  brief: '',
  ...p,
})

/** What the coordinator proposed for a prototype, as a Change, with the reviewer the person skipped. */
const skipped = part({ checked: 'none', end: 'ready', reviewer: 'codex/gpt-6.1-sol' })
const local = part({ workspace: 'local', checked: 'none', end: 'ready', lead: SONNET })
const unreviewed = part({ checked: 'none', end: 'none' })

export interface Scenario {
  readonly key: string
  readonly label: string
  /** What the person asked last, and the plan it became, for the thread. */
  readonly asked: string
  readonly title: string
  readonly setups: ReadonlyArray<Setup>
}

export const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    key: 'skipped',
    label: 'Skipped the reviewer twice',
    asked: 'Prototype a few designs for the preset offer.',
    title: 'Prototype: the “keep as a preset?” offer',
    setups: [
      { title: 'Fix the launch screen’s status text', parts: part({ lead: SONNET }), by: 'coordinator' },
      { title: 'Prototype: small change card', parts: skipped, by: 'corrected', changed: 'skipped the reviewer' },
      { title: 'Prototype: the “keep as a preset?” offer', parts: skipped, by: 'corrected', changed: 'skipped the reviewer' },
    ],
  },
  {
    key: 'twice',
    label: 'Set up by hand twice',
    asked: 'Bump the docs site’s dependencies, locally, no review.',
    title: 'Bump the docs site’s dependencies',
    setups: [
      { title: 'Rename the board’s “Kept” column', parts: local, by: 'person' },
      { title: 'Bump the docs site’s dependencies', parts: local, by: 'person' },
    ],
  },
  {
    key: 'thrice',
    label: 'Set up by hand three times',
    asked: 'Fix the typo in the onboarding copy, locally, no review.',
    title: 'Fix the typo in the onboarding copy',
    setups: [
      { title: 'Rename the board’s “Kept” column', parts: local, by: 'person' },
      { title: 'Prototype: settings search', parts: skipped, by: 'corrected', changed: 'skipped the reviewer' },
      { title: 'Bump the docs site’s dependencies', parts: local, by: 'person' },
      { title: 'Fix the typo in the onboarding copy', parts: local, by: 'person' },
    ],
  },
  {
    key: 'near',
    label: 'Nearly Prototype',
    asked: 'Try a denser board card, nothing to review.',
    title: 'Try a denser board card',
    setups: [
      { title: 'Try a calmer dock', parts: unreviewed, by: 'person' },
      { title: 'Try two lines for task titles', parts: unreviewed, by: 'person' },
      { title: 'Try a denser board card', parts: unreviewed, by: 'person' },
    ],
  },
]
