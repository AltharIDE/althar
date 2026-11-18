import { useState } from 'react'

import type { AgentStatus, ChangeSummary, PlanStep, Product, TaskEnd as End, WorksIn as Where } from '@althar/contracts'
import {
  AsideCard,
  AsideState,
  type IssueRefProps,
  type LaunchStep,
  LinkButton,
  PresetOffer,
  TaskCard,
  TaskEnd,
  TaskLaunch,
  TaskStatus,
  WorksIn,
} from '@althar/ui'
import { useQueryClient } from '@tanstack/react-query'

import { useServices } from '../../data/services'
import { openBlockers, standsOf } from '../../shared/blockers'
import { externalWaitWords, holdersWords, queuedWords, reconnectsWords, waitsWords } from '../../shared/agents'
import { type NameEffort, type NameModel, useEffortNames, useModelNames } from '../../shared/modelNames'
import { Holders } from '../../shared/Holders'
import { localText } from '../../shared/local'
import { ModelChoice } from '../../shared/ModelChoice'
import { productBrand } from '../../shared/products'
import { stepIndex, stepNames, stepNow, stepText } from '../../shared/steps'
import { useTaskTitle } from '../../shared/taskTitle'
import { ago, clock } from '../../shared/time'
import type { TaskCardContent } from '../../shared/thread'
import s from './Card.module.css'

/*
 * A task's card in the Talk room. Before it starts, its plan: who does each
 * step, on which model and how hard it thinks, why the coordinator chose the
 * lead, and the time it starts on its own, which the runtime keeps. You can
 * change who does a step, skip the review, hold it, or start it now. Once it
 * starts, where it stands, and a way in.
 */

/** How long a plan waits before it starts on its own where its card doesn't say: the runtime's countdown unless the person changed it. */
export const COUNTDOWN = 25

export const text = {
  label: stepText.label,
  status: {
    [TaskStatus.Running]: 'Running',
    [TaskStatus.Yours]: 'Needs you',
    [TaskStatus.Done]: 'Ready',
    [TaskStatus.Paused]: 'Paused',
    [TaskStatus.Queued]: 'Waiting',
    [TaskStatus.Stopped]: 'Stopped',
  } satisfies Record<TaskStatus, string>,
  now: stepText.now,
  /** A small change's card, as Team's dialog entry elsewhere is named. */
  changeTeam: 'Change the team…',
}

const STATUS: Readonly<Record<TaskCardContent['phase'], TaskStatus>> = {
  drafting: TaskStatus.Running,
  planned: TaskStatus.Running,
  held: TaskStatus.Stopped,
  running: TaskStatus.Running,
  waiting: TaskStatus.Yours,
  ready: TaskStatus.Done,
  kept: TaskStatus.Paused,
  stopped: TaskStatus.Stopped,
  settled: TaskStatus.Done,
}

export interface CardActions {
  readonly project: string
  /** The project's id, for each model's room in a step's picker; absent outside a project. */
  readonly projectId?: string
  readonly agents: ReadonlyArray<AgentStatus>
  readonly agentName: (id: string | null) => string
  readonly onStart: (planId: string) => void
  readonly onHold: (planId: string) => void
  /** Stops a task waiting for another (tasks wait for their blockers); done once it has gone through or failed. */
  readonly onStopWaiting?: (taskId: string, on: string) => Promise<void>
  /** Reopens a task a plan waits for, once abandoned. */
  readonly onReopen?: (taskId: string) => void
  readonly onChange: (
    planId: string,
    steps: ReadonlyArray<PlanStep>,
    end?: End | null,
    worksIn?: Where,
    /** The branch it works toward (ADR-093); null for the default branch. */
    toward?: string | null,
  ) => void
  /** Makes a branch its list doesn't have, in the plan's repository, and points the plan at it (ADR-093). */
  readonly onCreateBranch: (planId: string, steps: ReadonlyArray<PlanStep>, end: End | null, repositoryId: string, branch: string) => void
  readonly onOpen: (threadId: string) => void
  /** Opens an aside beside the coordinator, as its pill does; absent where there is no room for one, and it opens as a task does. */
  readonly onOpenAside?: (taskId: string, threadId: string) => void
  /** Opens a task's team dialog: a small change's card, which starts at once, offers it from the start. */
  readonly onChangeTeam?: (taskId: string) => void
  /** Stops a command a task's lead left running, from the task that waits for the place it keeps. */
  readonly onStopBackground: (threadId: string, id: string) => void
  /** The one waiting task that shows who holds the places, the newest: the others only wait. */
  readonly holdersOn?: string | null
  /** The presets a plan can start from instead, each with what it holds; a review's only with the others that review. */
  readonly presets?: ReadonlyArray<{ readonly name: string; readonly about: string; readonly reviews: boolean }>
  /** Picks another preset for a plan: its parts change to match. */
  readonly onPreset?: (planId: string, preset: string) => void
}

type Plan = NonNullable<TaskCardContent['plan']>

/** The kit's ending, from the plan's. */
export const ENDS: Readonly<Record<End, TaskEnd>> = { draft: TaskEnd.DraftPr, ready: TaskEnd.ReadyPr, none: TaskEnd.PushOnly }
export const endOf = (end: TaskEnd): End => (end === TaskEnd.DraftPr ? 'draft' : end === TaskEnd.ReadyPr ? 'ready' : 'none')

/** The kit's place, from the plan's, and back (ADR-091). */
const placeOf = (where: Where): WorksIn => (where === 'checkout' ? WorksIn.Local : WorksIn.Worktree)
const whereOf = (place: WorksIn): Where => (place === WorksIn.Local ? 'checkout' : 'worktree')

/** The issues a task came from, as the kit marks them: its first, and any others after it. */
const fromOf = (card: TaskCardContent): IssueRefProps | undefined => {
  if (card.issue === null) return undefined
  const refOf = (issue: { readonly product: Product; readonly key: string }) => ({
    mark: productBrand(issue.product),
    id: issue.key,
    linear: issue.product === 'linear',
  })
  const also = (card.fromIssues ?? []).slice(1).map(refOf)
  return { ...refOf(card.issue), ...(also.length === 0 ? {} : { also }) }
}

/**
 * The plan's steps as the kit shows them, by model; the agent's id rides on
 * the model's runtime. A review of someone else's pull request has one, its
 * lead, which reviews.
 */
const launchSteps = (plan: Plan, named: NameModel, effortOf: NameEffort, reviews: boolean): ReadonlyArray<LaunchStep> =>
  plan.steps.map((step) => ({
    id: step.key,
    label: text.label[reviews ? 'review' : step.key],
    agents: [named(step.agentId, step.model)],
    optional: step.key === 'review',
    skipped: step.skipped,
    effort: effortOf(step.agentId, step.model, step.effort ?? null),
  }))

/**
 * Its parts, offered to keep as a preset, quiet in its card's foot: Keep
 * saves them from the task as a new preset by the name given (a name another
 * preset has is refused, and the form says so), Undo removes what was kept, and
 * the person can say not to offer them again. The card says what came of it
 * once the runtime reads it again.
 */
function Offer({ card }: { card: TaskCardContent }) {
  const { client } = useServices()
  const cache = useQueryClient()
  const offer = card.presetOffer
  if (offer === undefined) return null
  // Settings lists the person's presets: it reads them again.
  const listed = () => void cache.invalidateQueries({ queryKey: ['presets'] })
  return (
    <PresetOffer
      name={offer.name}
      {...(offer.near === undefined ? {} : { near: offer.near })}
      {...(offer.kept === undefined
        ? {}
        : { kept: offer.kept.name, onUndo: () => void client.removePreset(offer.kept?.id ?? '').then(listed) })}
      // oxlint-disable-next-line althar/press-at-once -- A form the runtime checks (a name another preset has): it stays, busy, until kept, so a refusal lands at its field.
      onKeep={(name) => client.savePreset({ name, parts: offer.parts, taskId: card.taskId, asNew: true }).then(listed)}
      onDecline={() => void client.declinePresetOffer(card.taskId)}
    />
  )
}

function PlanCard({
  card,
  plan,
  actions,
  queued,
  queuedTitle,
}: {
  card: TaskCardContent
  plan: Plan
  actions: CardActions
  /** Started, waiting for a free agent: what for. */
  queued?: string
  queuedTitle?: string
}) {
  const title = useTaskTitle(card.taskId, card.title)
  const named = useModelNames()
  const effortOf = useEffortNames()
  // What it waits for (tasks wait for their blockers), a row each before its lead: one the person stops waiting for goes at once.
  const [letGo, setLetGo] = useState<ReadonlySet<string>>(new Set())
  const waitsFor = openBlockers(card)
    .filter((one) => !letGo.has(one.taskId))
    .map((one) => ({
      id: one.taskId,
      name: one.title,
      stands: standsOf(one.stands),
      onOpen: () => actions.onOpen(one.threadId),
      ...(actions.onReopen === undefined ? {} : { onReopen: () => actions.onReopen?.(one.taskId) }),
      ...(actions.onStopWaiting === undefined
        ? {}
        : {
            onStopWaiting: () => {
              setLetGo((was) => new Set([...was, one.taskId]))
              // Read again by then: gone where it went through, back with a line where it didn't.
              void actions
                .onStopWaiting?.(card.taskId, one.taskId)
                .finally(() => setLetGo((was) => new Set([...was].filter((id) => id !== one.taskId))))
            },
          }),
    }))
  // What the person changed shows at once; the runtime's copy replaces it when it comes back.
  const [shown, setShown] = useState<{
    readonly from: Plan
    readonly steps: ReadonlyArray<PlanStep>
    readonly end: End | null
    readonly worksIn: Where | undefined
    readonly toward: string | null
  }>({
    from: plan,
    steps: plan.steps,
    end: plan.end,
    worksIn: plan.worksIn,
    toward: plan.toward ?? null,
  })
  const steps = shown.from === plan ? shown.steps : plan.steps
  const end = shown.from === plan ? shown.end : plan.end
  const worksIn = shown.from === plan ? shown.worksIn : plan.worksIn
  const toward = shown.from === plan ? shown.toward : (plan.toward ?? null)
  const change = (next: ReadonlyArray<PlanStep>, nextEnd: End | null = end, nextWhere?: Where, nextToward?: string | null) => {
    setShown({
      from: plan,
      steps: next,
      end: nextEnd,
      worksIn: nextWhere ?? worksIn,
      toward: nextToward === undefined ? toward : nextToward,
    })
    if (nextToward === undefined) actions.onChange(plan.id, next, nextEnd, nextWhere)
    else actions.onChange(plan.id, next, nextEnd, nextWhere, nextToward)
  }
  const from = fromOf(card)
  return (
    <TaskLaunch
      task={card.slug}
      {...(plan.preset === undefined ? {} : { preset: plan.preset })}
      // A press on the preset lists the others it can start from: a review only reviews, and work never becomes one.
      {...(actions.presets === undefined || actions.onPreset === undefined
        ? {}
        : {
            presets: actions.presets.filter((one) => one.reviews === (card.reviewing != null)),
            onPresetChange: (name: string) => actions.onPreset?.(plan.id, name),
          })}
      title={title}
      {...(from === undefined ? {} : { from })}
      project={actions.project}
      steps={launchSteps({ ...plan, steps }, named, effortOf, card.reviewing != null)}
      onStepsChange={(next) =>
        change(steps.map((step) => ({ ...step, skipped: next.find((launch) => launch.id === step.key)?.skipped ?? step.skipped })))
      }
      picker={({ step, owner, onOpenChange, skip }) => {
        const planned = steps.find((candidate) => candidate.key === step.id)
        return (
          planned !== undefined && (
            <ModelChoice
              owner={owner}
              onOpenChange={onOpenChange}
              {...(skip === undefined ? {} : { onRemove: skip.onSkip, text: { remove: skip.label } })}
              agents={actions.agents}
              value={{ agentId: planned.agentId, model: planned.model, effort: planned.effort ?? null }}
              {...(actions.projectId === undefined ? {} : { projectId: actions.projectId })}
              onChange={(choice) => change(steps.map((candidate) => (candidate.key === step.id ? { ...candidate, ...choice } : candidate)))}
              variant="field"
              placement="below"
            />
          )
        )
      }}
      wait={Math.max(1, plan.startsAfter ?? COUNTDOWN)}
      {...(queued === undefined ? {} : { queued })}
      {...(queuedTitle === undefined ? {} : { queuedTitle })}
      {...(waitsFor.length === 0 ? {} : { waitsFor })}
      {...(plan.startsAt === null ? {} : { startsAt: Date.parse(plan.startsAt) })}
      held={card.phase === 'held'}
      onHeldChange={(held) => {
        if (held) actions.onHold(plan.id)
      }}
      // Where the repository's host isn't connected, the task ends on its branch, and there is no ending to pick.
      {...(end === null ? { hideEnd: true } : { end: ENDS[end], onEndChange: (next: TaskEnd) => change(steps, endOf(next)) })}
      // A draft pull request is where tasks end until projects have rules for it, so no rule is named.
      text={{ ruleNote: (_project, note) => note }}
      // Where it works, until it starts: the coordinator's choice, the person's to change (ADR-091).
      {...(worksIn === undefined
        ? {}
        : {
            worksIn: placeOf(worksIn),
            onWorksInChange: (next: WorksIn) => change(steps, end, whereOf(next)),
            ...(plan.worksInWhy == null || worksIn !== plan.worksIn ? {} : { worksInWhy: plan.worksInWhy }),
            ...(plan.localTaken == null ? {} : { localTaken: plan.localTaken.title }),
          })}
      // What it works toward, until it starts: the project's Work toward or the coordinator's, the person's to change (ADR-093).
      {...(plan.branches === undefined || plan.defaultBranch === undefined
        ? {}
        : {
            defaultBranch: plan.defaultBranch,
            branches: plan.branches,
            toward: toward ?? plan.defaultBranch,
            onTowardChange: (next: string) => change(steps, end, undefined, next === plan.defaultBranch ? null : next),
            ...(plan.repositoryId == null
              ? {}
              : {
                  onCreateBranch: (branch: string) => {
                    // Shown at once, as a branch picked is; the plan moves to it once the remote has it.
                    setShown({ from: plan, steps, end, worksIn, toward: branch })
                    actions.onCreateBranch(plan.id, steps, end, plan.repositoryId ?? '', branch)
                  },
                }),
          })}
      {...(card.presetOffer === undefined ? {} : { footNote: <Offer card={card} /> })}
      onStart={() => actions.onStart(plan.id)}
    />
  )
}

/** Its latest pull request; those of its earlier rounds of work (ADR-034) are on its own view. */
const pullRequestOf = (latest: ChangeSummary) => `${latest.short} ${latest.prefix}${latest.number}`

/** A task's card, with, while it waits for a free agent and is the newest to, the servers that keep a place. */
export function Card({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  const holders = card.queued?.holders
  if (holders === undefined || holders.length === 0 || (actions.holdersOn !== undefined && actions.holdersOn !== card.threadId))
    return <Shown card={card} actions={actions} />
  return (
    <div className={s.stack}>
      <Shown card={card} actions={actions} />
      <Holders holders={holders} onStop={actions.onStopBackground} />
    </div>
  )
}

function Shown({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  const title = useTaskTitle(card.taskId, card.title)
  const named = useModelNames()
  const effortOf = useEffortNames()
  if ((card.phase === 'planned' || card.phase === 'held') && card.plan !== null)
    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} />
  // Started, its first step waiting for a free agent, the plan can still be changed: it says what it waits for where the clock was.
  if (card.planWaits === true && card.queued !== null && card.plan !== null)
    return (
      <PlanCard
        key={card.plan.id}
        card={card}
        plan={card.plan}
        actions={actions}
        queued={queuedWords(card.queued)}
        queuedTitle={holdersWords(card.queued)}
      />
    )
  // So does one started Local that waits for its checkout (ADR-091).
  if (card.planWaits === true && card.waitsForCheckout != null && card.plan !== null)
    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} queued={localText.waits(card.waitsForCheckout)} />
  // An aside (a quick job on Scratch, off the board) has no steps to show: its own card, lighter, says so.
  if (card.scratch === true) return <Aside card={card} actions={actions} title={title} />
  // A review has no steps to go through: its lead reads and drafts.
  const steps = stepNames(card.reviewing == null ? (card.plan?.steps ?? []) : [], card.followUp === true)
  const at = stepIndex(steps, card.step)
  // Ready, but its lead couldn't resolve a conflict, or brought its failing checks to the person: it needs them, and says why.
  const handedBack = card.phase === 'ready' ? (card.handedBack ?? card.checksBack ?? null) : null
  // Waiting for a free agent, it says so, rather than that it runs.
  // Held for a usage limit, it is paused until the reset, as on the board, unless the person moves it on.
  const status =
    card.queued !== null
      ? TaskStatus.Queued
      : handedBack !== null
        ? TaskStatus.Yours
        : (card.waits !== null || card.reconnects != null) && card.phase === 'running'
          ? TaskStatus.Paused
          : STATUS[card.phase]
  // A step held for a usage limit, or waiting for a free agent, says what it waits for, rather than what it does.
  const now =
    handedBack !== null
      ? handedBack
      : status === TaskStatus.Done
        ? card.summary?.split('\n')[0]
        : card.externalWait !== undefined
          ? externalWaitWords(card.externalWait, clock)
          : card.queued !== null
            ? queuedWords(card.queued)
            : card.waits !== null
              ? waitsWords(actions.agentName(card.waits.agentId), clock(card.waits.until), undefined, card.waits.left)
              : card.reconnects != null
                ? reconnectsWords(card.reconnects, clock)
                : stepNow(card.step, card.shipAt)
  const from = fromOf(card)
  // How hard its lead thinks, whoever chose it: what its session is on, or the plan's until it has started.
  // A small change's card names who leads from its next turn, which its plan's lead is as the runtime reads it, so a team just changed shows.
  const small = card.plan?.preset === 'Small change' && card.reviewing == null
  const next = small ? card.plan?.steps.find((step) => step.key === 'implement') : undefined
  const effort =
    next === undefined ? effortOf(card.lead, card.leadModel, card.leadEffort) : effortOf(next.agentId, next.model, next.effort ?? null)
  // A small change has no countdown to change its team in: once it is at work its card still offers it, until it is settled.
  const changeTeam =
    actions.onChangeTeam !== undefined && small && card.phase !== 'drafting' && card.phase !== 'settled' ? actions.onChangeTeam : undefined
  return (
    <TaskCard
      errands={card.errands}
      task={card.slug}
      title={title}
      status={status}
      steps={steps}
      at={status === TaskStatus.Done || handedBack !== null ? steps.length - 1 : at}
      {...(now === undefined ? {} : { now })}
      started={card.startedAt === null || card.externalWait !== undefined ? '' : ago(card.startedAt)}
      lead={next === undefined ? named(card.lead, card.leadModel) : named(next.agentId, next.model)}
      {...(effort === null ? {} : { effort })}
      {...(from === undefined ? {} : { from })}
      {...(card.change === null ? {} : { pr: pullRequestOf(card.change) })}
      {...(card.presetOffer === undefined && changeTeam === undefined
        ? {}
        : {
            footNote: (
              <>
                {changeTeam !== undefined && <LinkButton onClick={() => changeTeam(card.taskId)}>{text.changeTeam}</LinkButton>}
                {card.presetOffer === undefined ? null : <Offer card={card} />}
              </>
            ),
          })}
      onOpen={() => actions.onOpen(card.threadId)}
      text={{ status: text.status }}
    />
  )
}

/** Where an aside stands, as its card says it: one its lead ended unasked failed; one the person stopped is stopped. */
const asideStateOf = (card: TaskCardContent): AsideState => {
  if (card.phase === 'ready' || card.phase === 'settled')
    return (card.handedBack ?? card.checksBack ?? null) === null ? AsideState.Ready : AsideState.Yours
  if (card.phase === 'waiting') return AsideState.Yours
  if (card.phase === 'stopped')
    return card.stopped?.by === 'declined' || card.stopped?.by === 'interrupted' ? AsideState.Stopped : AsideState.Failed
  if (card.phase === 'held' || card.phase === 'kept') return AsideState.Stopped
  return AsideState.Running
}

/** An aside's card: where it stands, its result or what it is at, and a way in beside the coordinator. */
function Aside({ card, actions, title }: { card: TaskCardContent; actions: CardActions; title: string }) {
  const state = asideStateOf(card)
  const said = card.latest?.by === 'lead' ? card.latest.said : undefined
  const result =
    state === AsideState.Ready
      ? (card.summary ?? said)
      : state === AsideState.Stopped
        ? card.stopped?.by == null
          ? undefined
          : stepText.stoppedBy[card.stopped.by]
        : state === AsideState.Running && card.queued !== null
          ? queuedWords(card.queued)
          : state === AsideState.Running && card.waits !== null
            ? waitsWords(actions.agentName(card.waits.agentId), clock(card.waits.until), undefined, card.waits.left)
            : said
  return (
    <AsideCard
      task={card.slug}
      title={title}
      state={state}
      result={result ?? undefined}
      onOpen={() => (actions.onOpenAside === undefined ? actions.onOpen(card.threadId) : actions.onOpenAside(card.taskId, card.threadId))}
    />
  )
}
