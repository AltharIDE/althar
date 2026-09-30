import { useState } from 'react'

import {
  BackCrumb,
  Button,
  Composer,
  Heading,
  LinkButton,
  Select,
  Spinner,
  TaskFace,
  Thread,
  ThreadDivider,
  ThreadMeasure,
  TitleBar,
} from '@charrette/ui'

import { ago } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { Card, type CardActions } from './Card'
import { NewTask } from './NewTask'
import s from './Project.module.css'
import type { ProjectModel } from './useProject'

/*
 * A project's Talk room: the conversation with its coordinator, and each
 * task's card in it. The coordinator answers questions itself and turns
 * changes into tasks; a task you plan yourself opens beside it.
 */

export const text = {
  back: 'Projects',
  project: 'Project',
  conversation: 'Conversation',
  newTask: 'New task',
  coordinator: 'Coordinator',
  empty: 'Ask the coordinator about the project, or say what should change.',
  placeholder: 'Tell the coordinator something',
  queued: 'Queued · the coordinator reads it next',
  placeholderBusy: 'Add to the queue, or interrupt the coordinator',
  signedOut: (agent: string, instead: string) => `${agent} isn't signed in, so the coordinator starts on ${instead}.`,
  needsAgent: 'No agent is signed in. Sign one in with its own tool, then come back.',
  earlier: 'Earlier',
  showEarlier: 'Show',
  loadingEarlier: 'Showing…',
  dismiss: 'Dismiss',
}

export function ProjectView({ model, onBack, onTask }: { model: ProjectModel; onBack: () => void; onTask: (threadId: string) => void }) {
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const coordinator = model.coordinator
  const session = coordinator?.session ?? null
  const suggested = coordinator?.suggested ?? null
  const busy = session?.turnRunning ?? false
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  // Whatever it ran on last, while that agent can; otherwise the first that can.
  const chosen = session?.agentId ?? pick ?? (suggested?.available === true ? suggested.agentId : null) ?? model.agents[0]?.id ?? null
  const name = model.project?.name ?? coordinator?.project.name ?? text.project

  const actions: CardActions = {
    project: name,
    agents: model.agents,
    agentName,
    onStart: (planId) => void model.startPlan(planId),
    onHold: (planId) => void model.holdPlan(planId),
    onChange: (planId, steps) => void model.changePlan(planId, steps),
    onOpen: onTask,
  }

  const send = (body: string, now: boolean) => {
    setDraft('')
    void (now ? model.sayNow(body) : model.say(body, chosen))
  }

  const composer = (
    <div className={s.composer}>
      {model.error !== null && (
        <p className={s.failure} role="alert">
          {model.error} <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
        </p>
      )}
      {session === null && model.agents.length === 0 && <p className={s.quiet}>{text.needsAgent}</p>}
      {session === null && suggested !== null && !suggested.available && chosen !== null && (
        <p className={s.quiet}>{text.signedOut(suggested.agentName, agentName(chosen))}</p>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        placeholder={busy ? text.placeholderBusy : text.placeholder}
        picker={
          model.agents.length > 0 && (
            <Select
              label={text.coordinator}
              variant="quiet"
              value={chosen}
              options={model.agents.map((agent) => ({ value: agent.id, label: agent.name }))}
              onChange={(agentId) => (session === null ? setPick(agentId) : void model.switchAgent(agentId))}
            />
          )
        }
      />
    </div>
  )

  return (
    <div className={s.window}>
      <TitleBar>
        <BackCrumb to={text.back} onBack={onBack} {...(model.project === null ? {} : { title: model.project.name })} />
      </TitleBar>
      <div className={s.head}>
        <ThreadMeasure>
          <div className={s.heading}>
            <div>
              <Heading level={1}>{name}</Heading>
              {model.project?.repository && <p className={s.repository}>{model.project.repository}</p>}
            </div>
            <Button onClick={() => setPlanning(true)}>{text.newTask}</Button>
          </div>
        </ThreadMeasure>
      </div>
      {coordinator === null ? (
        <div className={s.loading}>{model.error === null ? <Spinner /> : <p role="alert">{model.error}</p>}</div>
      ) : (
        <TaskFace
          className={s.face}
          composer={composer}
          panel={
            planning ? (
              <NewTask
                agents={model.agents}
                starting={model.starting}
                onClose={() => setPlanning(false)}
                onStart={(task) =>
                  void model.startTask(task).then((started) => {
                    if (started !== null) setPlanning(false)
                  })
                }
              />
            ) : undefined
          }
        >
          <Thread label={text.conversation} busy={busy}>
            {coordinator.earlier && (
              <ThreadDivider
                icon="up"
                action={model.loadingEarlier ? text.loadingEarlier : text.showEarlier}
                onAction={() => void model.loadEarlier()}
              >
                {text.earlier}
              </ThreadDivider>
            )}
            {coordinator.items.length === 0 && model.streaming.size === 0 && <p className={s.quiet}>{text.empty}</p>}
            <ThreadBlocks
              blocks={blocksOf({ items: coordinator.items, turnRunning: busy, worktree: null }, model.streaming, (iso) => ago(iso))}
              agentName={agentName}
              card={(card) => <Card card={card} actions={actions} />}
              queued={text.queued}
            />
          </Thread>
        </TaskFace>
      )}
    </div>
  )
}
