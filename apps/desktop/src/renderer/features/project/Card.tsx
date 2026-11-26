import { useState } from 'react'

import type { AgentStatus, ChangeSummary, PlanStep, Product, ProjectWorker, TaskEnd as End, WorksIn as Where } from '@althar/contracts'
import {
  AsideCard,
  AsideState,
  device,
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
import { factsOf, readyText, readyWordOf } from '../../shared/standing'
import { externalWaitWords, holdersWords, queuedWords, reconnectsWords, waitsWords } from '../../shared/agents'
import { type NameEffort, type NameModel, useEffortNames, useModelNames } from '../../shared/modelNames'
import { Holders } from '../../shared/Holders'
import { localText } from '../../shared/local'
import { ModelChoice } from '../../shared/ModelChoice'
import { productBrand } from '../../shared/products'
import { stepIndex, stepNames, stepNow, stepText, stoppedWords } from '../../shared/steps'
import { useTaskTitle } from '../../shared/taskTitle'
import { ago, clock } from '../../shared/time'
import type { TaskCardContent } from '../../shared/thread'
import { useHomeState } from '../homes/useHomes'
import { ANY, HOME, placementOf, runsOnText } from './runsOn'
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
  /** A task discarded once it had begun: its card's word. */
  discarded: 'Discarded',
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
  readonly workers?: ReadonlyArray<ProjectWorker>
  readonly onStart: (planId: string, workerId?: string) => void | Promise<boolean>
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
  /** Asks the coordinator for the plan of a draft whose plan didn't come. */
  readonly onPlanDraft?: (task: { readonly taskId: string; readonly title: string; readonly slug: string }) => void
  /** Whether a draft's plan was asked for and is still on its way: Plan it isn't offered again until it isn't. */
  readonly planAsked?: (taskId: string) => boolean
  /** Discards a task from its card; done once the runtime has it, rejected where it didn't. */
  readonly onDiscard?: (taskId: string) => Promise<void>
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
  // Where it runs, while it is held: the home, or one of its workers (ADR-103). The runtime checks the choice again as it starts.
  const homes = useServices().host.homes
  const here = useHomeState(homes)
  // The home by the window's name for it: This Mac, or the remote home's own; until the window has read which, neither.
  const homeName = homes === undefined || here?.current.kind === 'local' ? device.This : here === null ? null : here.current.home.name
  const [place, setPlace] = useState<{ planId: string; workerId: string }>({ planId: plan.id, workerId: HOME })
  const selected = card.phase === 'held' && place.planId === plan.id ? place.workerId : HOME
  const placement =
    card.phase === 'held'
      ? placementOf({
          workers: actions.workers ?? [],
          selected,
          steps,
          requirements: plan.workerRequirements,
          worksIn,
          home: homeName,
          agentName: (id) => actions.agentName(id),
          modelName: (agentId, model) => named(agentId, model).name,
        })
      : null
  // On a worker, the picker offers what its agents offer there.
  const onWorker = selected === HOME || selected === ANY ? undefined : actions.workers?.find((one) => one.workerId === selected)
  const startProblem = placement?.problem
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
              // The review runs on the home, whatever runs the lead.
              {...(onWorker === undefined || step.id !== 'implement' ? {} : { worker: onWorker })}
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
      text={{ ruleNote: (_project, note) => note, ...(homeName === null ? { useHome: () => runsOnText.useHome } : {}) }}
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
      {...(placement === null || !placement.shown
        ? {}
        : {
            runsOn: {
              value: selected,
              places: placement.places,
              note: placement.note,
              ...(startProblem === undefined ? {} : { problem: startProblem }),
              onChange: (workerId: string) => setPlace({ planId: plan.id, workerId }),
            },
          })}
      {...(card.presetOffer === undefined ? {} : { footNote: <Offer card={card} /> })}
      onStart={() => actions.onStart(plan.id, selected === HOME ? undefined : selected)}
      startDisabled={startProblem !== undefined}
    />
  )
}

/** A draft's steps before anyone is chosen for them: a lead's and a reviewer's seat, open. */
const OPEN_SEATS: ReadonlyArray<LaunchStep> = [
  { id: 'implement', label: text.label.implement, agents: [] },
  { id: 'review', label: text.label.review, agents: [] },
]

/**
 * A task that never began, as its card stays: drafted with no plan, which it says plainly, offering to plan it (the
 * coordinator is asked) or discard it; or discarded before it began, from a draft or a plan, planned or held, which it
 * says where its foot said when it starts. Discard shows at once, and as it was again where the runtime turns it down.
 */
function NotBegun({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  const title = useTaskTitle(card.taskId, card.title)
  const named = useModelNames()
  const effortOf = useEffortNames()
  const [discarding, setDiscarding] = useState(false)
  const plan = card.plan
  const discarded = card.discarded === true || discarding
  const { onPlanDraft, onDiscard } = actions
  const asked = actions.planAsked?.(card.taskId) ?? false
  return (
    <TaskLaunch
      task={card.slug}
      title={title}
      {...(plan?.preset === undefined ? {} : { preset: plan.preset })}
      project={actions.project}
      steps={plan === null ? OPEN_SEATS : launchSteps(plan, named, effortOf, card.reviewing != null)}
      picker={() => null}
      onStart={() => undefined}
      {...(plan === null ? {} : plan.end === null ? { hideEnd: true } : { end: ENDS[plan.end] })}
      drafting={{ phase: 'end', ended: discarded ? 'discarded' : 'unplanned' }}
      {...(discarded || onPlanDraft === undefined || asked
        ? {}
        : {
            onPlan: () => onPlanDraft({ taskId: card.taskId, title, slug: card.slug }),
          })}
      {...(discarded || onDiscard === undefined
        ? {}
        : {
            onDiscard: () => {
              setDiscarding(true)
              void onDiscard(card.taskId).catch(() => setDiscarding(false))
            },
          })}
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
  // Never begun: drafted with no plan, or discarded before it started, wherever it was then, on Scratch too: an aside's card
  // would show it running or ready.
  if (card.unplanned === true || (card.discarded === true && card.startedAt === null)) return <NotBegun card={card} actions={actions} />
  // An aside (a quick job on Scratch, off the board) has no steps to show or plan to change: its own card, lighter, says so,
  // whatever it waits for. Only one counting down to its start keeps the plan's card, which can hold it.
  if (card.scratch === true && !(card.phase === 'planned' && card.plan?.startsAt != null))
    return <Aside card={card} actions={actions} title={title} />
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
  // A review has no steps to go through: its lead reads and drafts.
  const steps = stepNames(card.reviewing == null ? (card.plan?.steps ?? []) : [], card.followUp === true)
  const at = stepIndex(steps, card.step)
  // Ready, in the word the board, its header and Needs you say it in (`readyWordOf`), read from where its pull request stands
  // now, whatever its lead handed back or didn't.
  const word = card.phase === 'ready' ? readyWordOf(card) : null
  // Its lead couldn't resolve a conflict, or wasn't asked to, or brought its failing checks to the person: why, in its lead's line.
  const why = card.phase === 'ready' ? (card.handedBack ?? card.checksBack ?? card.conflictUnsent ?? null) : null
  // Something in its way is the person's, as the board has it in Needs you: a reason handed back, or its open pull request not
  // ready to accept, or ready once they push. Its checks still running, it is under way. Nothing asks a question, so its way in
  // opens it, rather than offering to answer one that was never asked.
  const inTheWay = why !== null || word === readyText.blocked || word === readyText.readyOnPush
  const checking = !inTheWay && word === readyText.checksRunning
  // Waiting for a free agent, it says so, rather than that it runs.
  // Held for a usage limit, it is paused until the reset, as on the board, unless the person moves it on.
  // Discarded once it had begun: it stopped there, and says it was discarded.
  const discarded = card.discarded === true
  const status = discarded
    ? TaskStatus.Stopped
    : card.queued !== null
      ? TaskStatus.Queued
      : inTheWay
        ? TaskStatus.Yours
        : checking
          ? TaskStatus.Running
          : (card.waits !== null || card.reconnects != null) && card.phase === 'running'
            ? TaskStatus.Paused
            : STATUS[card.phase]
  // Said as the board says it, where its standing is what it says.
  const said = (status === TaskStatus.Yours && inTheWay) || (status === TaskStatus.Running && checking) ? word : null
  // Beside it, why, or what of its pull request stands first, as the board's card says it: a failed check, checks running.
  const standing = said === null ? undefined : (why ?? (card.change === null ? undefined : factsOf(card.change)[0]?.words))
  // A step held for a usage limit, or waiting for a free agent, says what it waits for, rather than what it does.
  // Stopped: who stopped it and why, or the task its work went on in, under its title, rather than the step it was cut short in.
  const stoppedWhy = status === TaskStatus.Stopped && card.phase === 'stopped' ? stoppedWords(card.stopped) : undefined
  const now =
    discarded || (status === TaskStatus.Stopped && card.phase === 'stopped')
      ? undefined
      : standing !== undefined
        ? standing
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
      at={status === TaskStatus.Done || said !== null ? steps.length - 1 : at}
      {...(now === undefined ? {} : { now })}
      {...(stoppedWhy === undefined ? {} : { why: stoppedWhy })}
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
      {...(said === null ? {} : { asks: false })}
      onOpen={() => actions.onOpen(card.threadId)}
      text={{
        status: discarded
          ? { ...text.status, [TaskStatus.Stopped]: text.discarded }
          : said === null
            ? text.status
            : { ...text.status, [status]: said },
      }}
    />
  )
}

/** Where an aside stands, as its card says it: one its lead ended unasked failed; one the person stopped is stopped. */
const asideStateOf = (card: TaskCardContent): AsideState => {
  if (card.phase === 'ready' || card.phase === 'settled')
    return (card.handedBack ?? card.checksBack ?? null) === null ? AsideState.Ready : AsideState.Yours
  // Kept for later by the person: done, its result standing.
  if (card.phase === 'kept') return AsideState.Kept
  if (card.phase === 'waiting') return AsideState.Yours
  if (card.phase === 'stopped')
    return card.stopped?.by === 'declined' || card.stopped?.by === 'interrupted' ? AsideState.Stopped : AsideState.Failed
  if (card.phase === 'held') return AsideState.Stopped
  if (card.queued !== null || (card.planWaits === true && card.waitsForCheckout != null)) return AsideState.Waiting
  if (card.waits !== null || card.reconnects != null || card.externalWait !== undefined) return AsideState.Paused
  return AsideState.Running
}

/** An aside's card: where it stands, its result or what it is at, and a way in beside the coordinator. */
function Aside({ card, actions, title }: { card: TaskCardContent; actions: CardActions; title: string }) {
  const state = asideStateOf(card)
  const said = card.latest?.by === 'lead' ? card.latest.said : undefined
  // Its answer, by the thread's order: its lead's report, or what it said after the person last asked it more. Its lead's
  // latest words may only acknowledge the report, so they stand only where there is neither.
  const answer = card.answer ?? said
  const result = (() => {
    switch (state) {
      case AsideState.Ready:
      case AsideState.Kept:
      case AsideState.Failed:
        return answer
      case AsideState.Stopped:
        return stoppedWords(card.stopped)
      case AsideState.Waiting:
        return card.queued !== null
          ? queuedWords(card.queued)
          : card.waitsForCheckout == null
            ? undefined
            : localText.waits(card.waitsForCheckout)
      case AsideState.Paused:
        return card.externalWait !== undefined
          ? externalWaitWords(card.externalWait, clock)
          : card.waits !== null
            ? waitsWords(actions.agentName(card.waits.agentId), clock(card.waits.until), undefined, card.waits.left)
            : card.reconnects != null
              ? reconnectsWords(card.reconnects, clock)
              : said
      default:
        return said
    }
  })()
  return (
    <AsideCard
      task={card.slug}
      title={title}
      state={state}
      result={result}
      onOpen={() => (actions.onOpenAside === undefined ? actions.onOpen(card.threadId) : actions.onOpenAside(card.taskId, card.threadId))}
    />
  )
}
