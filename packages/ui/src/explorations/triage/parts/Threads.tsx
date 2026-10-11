import type { ReactNode } from 'react'

import { StepState, ToolKind } from '../../../foundations/vocabulary'
import { Question, type QuestionAnswer } from '../../../thread/Question/Question'
import { Step } from '../../../thread/Step/Step'
import { Tool, ToolGroup } from '../../../thread/Tool/Tool'
import { Prose, Turn } from '../../../thread/Turn/Turn'
import { Stakes } from '../model'
import { ASKED, OVER_LIMIT, TASK } from '../world'
import s from './Threads.module.css'

/*
 * What every direction's thread shares: the first step's row (triage is the
 * start of Implement, not a step of its own), the groundwork before the
 * checkpoint, and the real question when there is one.
 */

/** The first step's row: the triage moment happens inside it. */
export function FirstStep() {
  return <Step n={1} of={TASK.steps.length} label={TASK.steps[0] ?? ''} model={TASK.lead} state={StepState.Running} />
}

/** The lead looking around, before it says anything. */
export function Groundwork({ children, busy = false }: { children?: ReactNode; busy?: boolean }) {
  return (
    <Turn model={TASK.lead} at="11:02" aria-busy={busy || undefined}>
      <ToolGroup summary="Explored 4 files and ran a search" took="38s">
        <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" meta="88 lines" />
        <Tool kind={ToolKind.Read} verb="Read" target="src/refunds/router.ts" meta="142 lines" />
        <Tool kind={ToolKind.Search} verb="Searched" target="withPartnerLimit  src/" meta="6 results" />
        <Tool kind={ToolKind.Read} verb="Read" target="src/admin/refunds.ts" meta="61 lines" />
        <Tool kind={ToolKind.Read} verb="Read" target="notes/refunds.md" meta="24 lines" />
      </ToolGroup>
      {children}
    </Turn>
  )
}

export interface AskedText {
  /** Why it asks rather than assumes: what a wrong guess would cost. */
  stakesLead: string
  stakes: Record<Stakes, string>
  /** After you answered. */
  carriesOn: string
}

export const askedText: AskedText = {
  stakesLead: 'Asked, not assumed:',
  stakes: {
    [Stakes.Redo]: 'a wrong guess redoes most of the task',
    [Stakes.Outward]: 'partners would see it',
    [Stakes.Irreversible]: 'it can’t be undone',
  },
  carriesOn: 'Refusing, then, as charges do. Carrying on with the rest as I assumed.',
}

/** The work going on after the checkpoint: the step, as usual. */
export function CarriesOn() {
  return (
    <>
      <Prose>Starting with the router.</Prose>
      <Tool kind={ToolKind.Edit} verb="Edited" target="src/refunds/router.ts" meta="+18 −4" />
    </>
  )
}

const SAID: QuestionAnswer = { [OVER_LIMIT.id]: { optionIds: ['refuse'] } }

export interface AskedProps {
  answered?: boolean
  onAnswer?: () => void
  /** What it is still assuming beside the question, the direction's own way. */
  also?: ReactNode
  text?: Partial<AskedText>
}

/**
 * The one question that blocks, in the thread: what the lead says first, why
 * this isn't a guess (one of three reasons, nothing else), then the kit's
 * Question. What else it assumes rides along and carries on with the answer.
 */
export function Asked({ answered = false, onAnswer, also, text }: AskedProps) {
  const t = { ...askedText, ...text }
  return (
    <>
      <Prose>{ASKED.said}</Prose>
      <p className={s.stakes}>
        <span className={s.lead}>{t.stakesLead}</span> {ASKED.stakes.map((x) => t.stakes[x]).join('; ')}.
      </p>
      <Question parts={[OVER_LIMIT]} defaultAnswer={answered ? SAID : null} onAnswer={onAnswer} />
      {also}
      {answered && <Prose>{t.carriesOn}</Prose>}
    </>
  )
}
