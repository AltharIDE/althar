import type { AgentStatus, AutomationDefinition, AutomationStep } from '@althar/contracts'
import { AutomationCard, type AutomationCardProps, type AutomationPick } from '@althar/ui'

import { ModelChoice } from '../../shared/ModelChoice'
import { useModelNames } from '../../shared/modelNames'
import {
  ENDS,
  endsValueOf,
  endsWords,
  limitWords,
  nextSlot,
  nextWords,
  sameSchedule,
  sameStep,
  scheduleOf,
  timeOf,
  weeklyOf,
  whenChoices,
  whenValueOf,
  whenWords,
  workOf,
} from './words'

/*
 * An automation's definition as the kit's card draws it: its schedule in
 * the When menu, its lead and reviewer in the window's model picker, what it
 * ends in, and its limits in words. Each change the person makes is the
 * whole definition again, as ChangeAutomation takes it. Where it can't be
 * changed, each row says its value; where the coordinator changed it, what
 * it was, struck through.
 */

/** The reviewer a run gets once one is added: another agent than its lead's, else its lead's, each on its own model. */
export const reviewerFor = (lead: AutomationStep, agents: ReadonlyArray<AgentStatus>): AutomationStep => ({
  agentId: agents.find((agent) => agent.id !== lead.agentId)?.id ?? lead.agentId,
  model: null,
  effort: null,
})

export interface AutomationCardOfProps extends Pick<
  AutomationCardProps,
  'stage' | 'holds' | 'writing' | 'onTryOnce' | 'onTurnOn' | 'onUndo' | 'onOpen' | 'busy' | 'className'
> {
  definition: AutomationDefinition
  /** What the coordinator changed it from. */
  was?: AutomationDefinition | null
  project: string
  /** When it runs next, as the runtime says. */
  nextAt?: string | null
  /** Where the runtime hasn't said when it runs next, work it out from its schedule: for one not turned on yet. */
  fromSchedule?: boolean
  /** The agents its pickers offer. */
  agents: ReadonlyArray<AgentStatus>
  /** The whole definition, changed. Without it, nothing on the card can be changed. */
  onChange?: (definition: AutomationDefinition) => void
  /** Its prompt can be edited, with Edit and Done, or as it is written. */
  editsPrompt?: boolean
}

export function AutomationCardOf({
  definition,
  was = null,
  project,
  nextAt = null,
  fromSchedule = false,
  agents,
  onChange,
  editsPrompt = false,
  stage,
  ...rest
}: AutomationCardOfProps) {
  const named = useModelNames()
  const work = definition.work
  const change = onChange
  const nameOf = (step: AutomationStep) => named(step.agentId, step.model).name
  const picker = ({ role, owner }: AutomationPick) => {
    const step = role === 'lead' ? definition.lead : work.kind === 'task' ? work.review : null
    if (step === null) return null
    if (change === undefined) return nameOf(step)
    return (
      <ModelChoice
        owner={owner}
        agents={agents}
        value={{ agentId: step.agentId, model: step.model, effort: step.effort ?? null }}
        onChange={(choice) =>
          change(
            role === 'lead'
              ? { ...definition, lead: choice }
              : { ...definition, work: work.kind === 'task' ? { ...work, review: choice } : work },
          )
        }
        variant="field"
        placement="below"
      />
    )
  }
  const reviewWas =
    was === null || work.kind !== 'task' || was.work.kind !== 'task' || sameStep(was.work.review, work.review)
      ? undefined
      : was.work.review === null
        ? 'None'
        : nameOf(was.work.review)
  const next = nextAt ?? (fromSchedule ? nextSlot(definition.schedule).toISOString() : null)
  return (
    <AutomationCard
      {...rest}
      stage={stage}
      name={definition.name}
      project={project}
      prompt={definition.prompt}
      when={whenChoices(definition.schedule)}
      whenValue={whenValueOf(definition.schedule)}
      {...(next === null ? {} : { next: nextWords(next) })}
      {...(was === null || sameSchedule(was.schedule, definition.schedule) ? {} : { whenWas: whenWords(was.schedule) })}
      picker={picker}
      {...(was === null || sameStep(was.lead, definition.lead) ? {} : { leadWas: nameOf(was.lead) })}
      {...(work.kind === 'task'
        ? {
            review: {
              on: work.review !== null,
              ...(reviewWas === undefined ? {} : { was: reviewWas }),
              ...(change === undefined
                ? {}
                : {
                    onAdd: () => change({ ...definition, work: { ...work, review: reviewerFor(definition.lead, agents) } }),
                    onSkip: () => change({ ...definition, work: { ...work, review: null } }),
                  }),
            },
          }
        : {})}
      ends={ENDS}
      endsValue={endsValueOf(work)}
      {...(was === null || endsValueOf(was.work) === endsValueOf(work) ? {} : { endsWas: endsWords(was.work) })}
      limits={limitWords(definition)}
      {...(change === undefined
        ? {}
        : {
            onWhenChange: (value: string) => change({ ...definition, schedule: scheduleOf(value, definition.schedule) }),
            time: timeOf(definition.schedule),
            onTimeChange: (time: { readonly days: ReadonlyArray<number>; readonly at: string }) =>
              change({ ...definition, schedule: weeklyOf(time) }),
            onEndsChange: (value: string) => change({ ...definition, work: workOf(value, work) }),
            ...(editsPrompt ? { onPromptChange: (prompt: string) => change({ ...definition, prompt }) } : {}),
          })}
    />
  )
}
