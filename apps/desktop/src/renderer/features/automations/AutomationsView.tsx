import { useEffect, useState } from 'react'

import type { AgentStatus, AutomationDefinition, AutomationStep, AutomationSummary } from '@althar/contracts'
import { type AutomationLimit, AutomationPage, Automations, type AutomationTile } from '@althar/ui/screens'

import { platform } from '../../shared/device'
import { PartPending } from '../../shared/Pending'
import { usePreferences } from '../../shared/usePreferences'
import { useNow } from '../../shared/time'
import { AutomationCardOf } from './AutomationCardOf'
import { type AutomationModel, useAutomation, useAutomations, useNewAutomation } from './useAutomations'
import {
  endsInPullRequest,
  inOrder,
  LATE,
  markOf,
  minuteChoices,
  type Starter,
  STARTERS,
  standingOf,
  text as words,
  whenWords,
} from './words'
import s from './Automations.module.css'

/*
 * A project's Automations room: the tab, with its automations as cards,
 * or, opened from it, one automation as its own page, which is how it is
 * changed; or a new one, blank or from one of the starters the tab offers
 * while there are none, which saving it or turning it on makes.
 * Which one is open is the address's, so it is open again after a reload.
 * Where they run is said while Althar doesn't open at login, with the way
 * to have it so, where the system can.
 */

export const text = {
  reading: 'Reading the automations',
  readingOne: 'Reading the automation',
  where: 'Only while Althar is open.',
  /** Paused itself, where the runtime didn't say why. */
  why: 'Its last runs failed.',
}

/** The system lets Althar open at login: a Mac, and Windows. */
const opensAtLogin = platform === 'darwin' || platform === 'win32'

/** One automation as its card on the tab. */
const tileOf = (one: AutomationSummary, allPaused: boolean, now: Date): AutomationTile => {
  const standing = standingOf(one, allPaused, now)
  return {
    id: one.id,
    name: one.name,
    when: whenWords(one.schedule),
    standing: standing.words,
    tone: standing.tone,
    paused: standing.paused,
    prompt: one.prompt,
    ...(standing.tone === 'yours' ? { why: one.pauseReason ?? text.why } : {}),
    runs: one.latest.map((run) => markOf(run, now)),
  }
}

/** Its limits, as its page shows them: each change is the whole definition again; its reviews posting themselves only once it is made. */
const limitsOf = (
  definition: AutomationDefinition,
  change: (definition: AutomationDefinition) => void,
  posts?: { readonly on: boolean; readonly set: (on: boolean) => void },
): ReadonlyArray<AutomationLimit> => [
  {
    id: 'allow',
    kind: 'switch',
    title: words.allowEverything,
    note: words.allowEverythingNote,
    on: definition.allowEverything,
    onChange: (on) => change({ ...definition, allowEverything: on }),
  },
  ...(definition.work.kind === 'review' && posts !== undefined
    ? [
        {
          id: 'posts',
          kind: 'switch' as const,
          title: words.postsReviews,
          note: words.postsReviewsNote,
          on: posts.on,
          onChange: posts.set,
        },
      ]
    : []),
  {
    id: 'minutes',
    kind: 'select',
    title: words.stopsAfter,
    value: String(definition.minutes),
    options: minuteChoices(definition.minutes),
    onChange: (value) => change({ ...definition, minutes: Number(value) }),
  },
  {
    id: 'late',
    kind: 'select',
    title: words.asleep,
    note: words.asleepNote,
    value: definition.late,
    options: LATE,
    onChange: (value) => change({ ...definition, late: value === 'skip' ? 'skip' : 'once' }),
  },
  { id: 'places', kind: 'words', title: words.places, words: words.placesWords },
  { id: 'fails', kind: 'words', title: words.fails, words: words.failsWords },
  ...(endsInPullRequest(definition.work)
    ? [{ id: 'pullRequests', kind: 'words' as const, title: words.pullRequests, words: words.pullRequestsWords }]
    : []),
]

/** The tab: its automations as cards, the one that paused itself first; pausing them all; where they run. */
function Tab({ projectId, onOpen, onNew }: { projectId: string; onOpen: (id: string) => void; onNew: (starter?: string) => void }) {
  const model = useAutomations(projectId)
  const { preferences, read, set } = usePreferences()
  // What it says of when each runs next moves on with the clock, a minute at a time.
  const now = new Date(useNow(true, 60_000))
  const snapshot = model.snapshot
  if (snapshot === null)
    return model.error === null ? (
      <div className={s.pending}>
        <PartPending label={text.reading} />
      </div>
    ) : (
      <p className={s.failure} role="alert">
        {model.error}
      </p>
    )
  return (
    <Automations
      automations={inOrder(snapshot.automations).map((one) => tileOf(one, snapshot.allPaused, now))}
      onOpen={onOpen}
      onNew={onNew}
      starters={STARTERS.map(({ id, name, prompt, schedule }) => ({ id, name, prompt, when: whenWords(schedule) }))}
      allPaused={snapshot.allPaused}
      onPauseAll={model.setAllPaused}
      where={read && !preferences.openAtLogin}
      {...(opensAtLogin ? { onOpenAtLogin: () => set('openAtLogin', true) } : {})}
      {...(model.error === null ? {} : { error: model.error })}
      text={{ where: text.where }}
    />
  )
}

/** One automation's own page: its card, its limits and its runs, each opening its task. */
function Page({
  model,
  project,
  agents,
  onBack,
  onTask,
}: {
  model: AutomationModel
  project: string
  agents: ReadonlyArray<AgentStatus>
  onBack: () => void
  onTask: (threadId: string) => void
}) {
  const view = model.view
  const now = new Date(useNow(true, 60_000))
  // Deleted, here or by the coordinator, it is gone from the tab too.
  const gone = view?.state === 'deleted'
  useEffect(() => {
    if (gone) onBack()
  }, [gone, onBack])
  if (view === null)
    return model.error === null ? (
      <div className={s.pending}>
        <PartPending label={text.readingOne} />
      </div>
    ) : (
      <p className={s.failure} role="alert">
        {model.error}
      </p>
    )
  const standing = standingOf(view, view.allPaused, now)
  const definition = view.definition
  return (
    <AutomationPage
      name={view.name}
      status={standing.status}
      statusTone={standing.dot}
      tone={standing.tone}
      paused={standing.paused}
      proposed={view.state === 'proposed'}
      on={view.state === 'on'}
      onSwitch={(on) => (on ? model.turnOn() : model.pause())}
      onRunNow={model.runNow}
      onTryOnce={model.runNow}
      onTurnOn={model.turnOn}
      onRename={(name) => model.change({ ...definition, name })}
      onDelete={() => void model.remove().then((removed) => removed && onBack())}
      onBack={onBack}
      {...(standing.tone === 'yours' ? { pausedItself: view.pauseReason ?? text.why } : {})}
      card={
        <AutomationCardOf
          definition={definition}
          project={project}
          nextAt={view.nextAt}
          fromSchedule={view.state === 'proposed'}
          agents={agents}
          stage="kept"
          onChange={model.change}
          editsPrompt
        />
      }
      limits={limitsOf(definition, model.change, { on: view.postsReviews, set: model.setPostsReviews })}
      runs={view.runs.map((run) => ({ ...markOf(run, now), opens: run.task !== null }))}
      onOpenRun={(id) => {
        const task = view.runs.find((run) => run.id === id)?.task
        if (task != null) onTask(task.threadId)
      }}
      {...(model.error === null ? {} : { error: model.error })}
      busy={model.pending}
    />
  )
}

function Existing(props: { automationId: string } & Omit<Parameters<typeof Page>[0], 'model'>) {
  const { automationId, ...rest } = props
  return <Page model={useAutomation(automationId)} {...rest} />
}

/**
 * A new one, blank or from a starter: its name and prompt to write, every
 * other choice at its default; saving it, off, or turning it on makes it,
 * and opens its page. What it is missing is said under its field.
 */
function New({
  projectId,
  project,
  agents,
  lead,
  starter,
  onBack,
  onMade,
}: {
  projectId: string
  project: string
  agents: ReadonlyArray<AgentStatus>
  lead: AutomationStep
  starter?: Starter
  onBack: () => void
  onMade: (id: string) => void
}) {
  const draft = useNewAutomation(projectId, lead, starter)
  const [missing, setMissing] = useState(false)
  const definition = draft.definition
  const change = (next: AutomationDefinition) => {
    if (next.prompt.trim() !== '') setMissing(false)
    draft.change(next)
  }
  const check = () => {
    const said = definition.prompt.trim() !== ''
    setMissing(!said)
    return said
  }
  const make = (how: () => Promise<string | null>) => {
    void how().then((id) => {
      if (id !== null) onMade(id)
    })
  }
  const error = draft.error
  return (
    <AutomationPage
      making
      name={definition.name}
      onNameChange={(name) => change({ ...definition, name })}
      status={words.proposed}
      statusTone="off"
      tone="quiet"
      paused={false}
      proposed
      on={false}
      onSave={() => make(draft.save)}
      onTurnOn={() => make(draft.turnOn)}
      check={check}
      onBack={onBack}
      card={
        <AutomationCardOf
          definition={definition}
          project={project}
          agents={agents}
          fromSchedule
          stage="kept"
          writing
          promptMissing={missing}
          onChange={change}
          editsPrompt
        />
      }
      limits={limitsOf(definition, change)}
      {...(error === null ? {} : { error })}
      busy={draft.pending}
    />
  )
}

export function AutomationsView({
  projectId,
  project,
  agents,
  lead,
  open,
  onOpen,
  onTask,
}: {
  projectId: string
  /** The project's name, as the cards say it. */
  project: string
  /** The agents a lead or reviewer can be. */
  agents: ReadonlyArray<AgentStatus>
  /** Who leads a new one's runs, to begin with: the person's usual lead. */
  lead: AutomationStep
  /** The automation open as its page, `new` for a new one, or null for the tab. */
  open: string | null
  onOpen: (id: string | null) => void
  /** Opens a run's task. */
  onTask: (threadId: string) => void
}) {
  const back = () => onOpen(null)
  // The starter a new one opened from on the tab: the window's, not the address's.
  const [starter, setStarter] = useState<Starter | undefined>(undefined)
  const fresh = (id?: string) => {
    setStarter(STARTERS.find((one) => one.id === id))
    onOpen('new')
  }
  return (
    <div className={s.room}>
      {open === null ? (
        <Tab projectId={projectId} onOpen={onOpen} onNew={fresh} />
      ) : open === 'new' ? (
        <New
          key={starter?.id ?? 'blank'}
          projectId={projectId}
          project={project}
          agents={agents}
          lead={lead}
          {...(starter === undefined ? {} : { starter })}
          onBack={back}
          onMade={onOpen}
        />
      ) : (
        <Existing key={open} automationId={open} project={project} agents={agents} onBack={back} onTask={onTask} />
      )}
    </div>
  )
}
