// Scrappy: what a new task is set up with, as each direction lays it out: the model (Auto first, with usage), review, the branch and where it works, Linear's issues.
import { useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { ModelPick } from '../../../../src/composer/ModelPick/ModelPick'
import type { ModelInfo } from '../../../../src/primitives/Model/Model'
import { LINEAR, type LinearIssue, usage } from '../../data'
import type { Started } from '../../state'

/** The models a task can start on: Auto first, which plans as the coordinator would. */
export const OPUS: ModelInfo = {
  id: 'claude-opus-5-5',
  name: 'Claude Opus 5.5',
  short: 'Opus 5.5',
  mark: Brand.Anthropic,
  runtime: 'claude-code',
  efforts: ['Low', 'Medium', 'High', 'Xhigh'],
}
export const SONNET: ModelInfo = {
  id: 'claude-sonnet-5-5',
  name: 'Claude Sonnet 5.5',
  short: 'Sonnet 5.5',
  mark: Brand.Anthropic,
  runtime: 'claude-code',
  efforts: ['Low', 'Medium', 'High'],
}
export const SOL: ModelInfo = {
  id: 'gpt-6.1-sol',
  name: 'GPT-6.1 Sol',
  short: 'GPT-6.1 Sol',
  mark: Brand.OpenAI,
  runtime: 'codex',
  efforts: ['Minimal', 'Low', 'Medium', 'High'],
}
const MODELS = [OPUS, SONNET, SOL]

/** What Auto picks for these words: the coordinator's routing, read the same way. */
export const routed = (words: string, small: boolean): { model: ModelInfo; effort: string; why: string } => {
  if (small) return { model: SONNET, effort: 'Low', why: 'Sonnet 5.5 at low: a small change, no review' }
  if (/design|prototype|screen|ui\b|layout|copy|look/i.test(words))
    return { model: OPUS, effort: 'Xhigh', why: 'Opus 5.5 at xhigh: design work goes to Claude' }
  if (words.trim().split(/\s+/).length < 14 && words.trim() !== '')
    return { model: SONNET, effort: 'Medium', why: 'Sonnet 5.5 at medium: a contained change' }
  return { model: OPUS, effort: 'High', why: 'Opus 5.5 at high' }
}

export const autoOf = (words: string, small: boolean): ModelInfo => ({
  id: 'auto',
  name: 'Auto',
  short: 'Auto',
  route: routed(words, small).model.short,
  runtime: 'althar',
  efforts: [],
})

/** How much room each model's plan has this week, as the composer's picker says it. */
const roomOf = (model: ModelInfo, words: string, small: boolean) => {
  const runtime = model.id === 'auto' ? routed(words, small).model.runtime : model.runtime
  const left = runtime === 'codex' ? usage.codex : usage.claude
  return { left: left.left, until: left.resets, account: null }
}

export interface Lead {
  readonly id: string
  readonly effort: string | null
}

/** The lead's model, Auto by default, with what each has left this week. */
export function LeadPick({
  value,
  onChange,
  words,
  small,
  variant = 'field',
  placement = 'below',
}: {
  value: Lead
  onChange: (lead: Lead) => void
  words: string
  small: boolean
  variant?: 'quiet' | 'field'
  placement?: 'above' | 'below'
}) {
  const auto = autoOf(words, small)
  const model = value.id === 'auto' ? auto : (MODELS.find((one) => one.id === value.id) ?? auto)
  return (
    <ModelPick
      owner="Lead"
      model={model}
      pinned={[auto, ...MODELS]}
      effort={value.effort}
      defaultEffort={model.efforts.includes('High') ? 'High' : null}
      onChange={(id) => onChange({ id, effort: id === 'auto' ? null : 'High' })}
      onEffort={(effort) => onChange({ ...value, effort })}
      room={(one) => roomOf(one, words, small)}
      variant={variant}
      placement={placement}
    />
  )
}

/** The model a task actually starts on, from the pick. */
export const startedOn = (lead: Lead, words: string, small: boolean) => {
  if (lead.id !== 'auto') {
    const model = MODELS.find((one) => one.id === lead.id) ?? OPUS
    return { model: model.short, modelId: model.id }
  }
  const auto = routed(words, small)
  return { model: auto.model.short, modelId: auto.model.id }
}

/** What a new task is set up with, while it is being written. */
export interface Draft {
  /** Written in words, or picked from Linear's issues. */
  readonly from: 'words' | 'linear'
  readonly words: string
  readonly issues: ReadonlyArray<string>
  readonly lead: Lead
  readonly review: boolean
  readonly small: boolean
  readonly toward: string
  readonly worksIn: 'worktree' | 'checkout'
}

export const BRANCHES = ['main', 'release/0.8.0', 'althar/adr-agents-work-as-the-person-s-own']

export const freshDraft = (): Draft => ({
  from: 'words',
  words: '',
  issues: [],
  lead: { id: 'auto', effort: null },
  review: true,
  small: false,
  toward: 'main',
  worksIn: 'worktree',
})

export const useDraft = () => useState<Draft>(freshDraft)

/** A title from the words: the first line, cut short, as the coordinator would name it. */
export const titleOf = (words: string) => {
  const line = words.trim().split('\n')[0] ?? ''
  const cut = line.length > 64 ? `${line.slice(0, 61).replace(/\s+\S*$/, '')}…` : line
  return cut.charAt(0).toUpperCase() + cut.slice(1).replace(/\.$/, '')
}

/** The tasks a draft starts: one from its words, or one per issue picked. */
export const tasksOf = (draft: Draft): ReadonlyArray<Omit<Started, 'id' | 'at'>> => {
  const on = (words: string) => startedOn(draft.lead, words, draft.small)
  const shared = {
    review: draft.review && !draft.small,
    small: draft.small,
    toward: draft.toward === 'main' ? null : draft.toward,
    worksIn: draft.worksIn,
  }
  if (draft.from === 'linear')
    return draft.issues.map((key) => {
      const issue = LINEAR.find((one) => one.key === key)!
      return { ...shared, ...on(issue.title), title: issue.title, issue: key }
    })
  return [{ ...shared, ...on(draft.words), title: titleOf(draft.words), issue: null }]
}

/** Linear's mark, beside an issue's key. */
export const LinearMark = () => <BrandMark brand={Brand.Linear} size={12} />

export type { LinearIssue }
