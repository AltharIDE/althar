import { useState } from 'react'

import type { AttentionRequest, ThreadSnapshot } from '@charrette/contracts'
import {
  BackCrumb,
  Button,
  Composer,
  Decision,
  LinkButton,
  type ModelInfo,
  Permission,
  Select,
  Spinner,
  TaskFace,
  TaskHeader,
  TaskMenu,
  TaskStatus,
  Thread,
  ThreadDivider,
  ThreadMeasure,
  TitleBar,
} from '@charrette/ui'

import { modelInfo } from '../../shared/agents'
import { ago, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import s from './Task.module.css'
import type { TaskModel } from './useTask'

/*
 * A task: its header, its thread, and the composer that talks to its lead.
 * What the rules keep for the person arrives as a call at the end of the
 * thread. Everything drawn here is the kit's; this view only arranges it.
 */

export const text = {
  thread: 'Thread',
  noLead: 'No lead',
  noLeadNote: 'No agent is working on this task.',
  startLead: 'Start the lead',
  lead: 'Lead',
  handTo: 'Hand to',
  model: 'Model',
  placeholderBusy: 'Add to the queue, or interrupt the lead',
  placeholder: (lead: string) => `Tell ${lead} something`,
  placeholderNone: 'Start a lead to talk to it',
  working: 'Working',
  needsYou: 'Needs you',
  idle: 'Idle',
  stopped: 'Stopped',
  dismiss: 'Dismiss',
  earlier: 'Earlier in this task',
  showEarlier: 'Show',
  loadingEarlier: 'Showing…',
}

/** Where a task stands, for its header. */
export const statusOf = (snapshot: ThreadSnapshot): { readonly status: TaskStatus; readonly state: string } => {
  if (snapshot.attention.length > 0) return { status: TaskStatus.Yours, state: text.needsYou }
  if (snapshot.session === null) return { status: TaskStatus.Stopped, state: text.stopped }
  return snapshot.session.turnRunning
    ? { status: TaskStatus.Running, state: text.working }
    : { status: TaskStatus.Running, state: text.idle }
}

const noLead: ModelInfo = { id: 'none', name: text.noLead, short: text.noLead, runtime: '', context: 0, efforts: [] }

function Call({ request, project, onAnswer }: { request: AttentionRequest; project: string; onAnswer: TaskModel['answer'] }) {
  return (
    <Permission
      id={request.id}
      what={request.title}
      cmd={request.command ?? request.title}
      why={request.reason}
      offers={[Decision.AllowOnce, Decision.Deny]}
      project={project}
      onAnswer={(answer) =>
        void onAnswer(
          request.id,
          answer.decision === Decision.AllowOnce ? 'allow' : 'reject',
          answer.decision === Decision.Deny ? answer.note : undefined,
        )
      }
    />
  )
}

export function TaskView({ model, onBack }: { model: TaskModel; onBack: () => void }) {
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  // A running turn says how long it has worked so far.
  const now = useNow(model.snapshot?.session?.turnRunning ?? false)
  const snapshot = model.snapshot
  if (snapshot === null) {
    return (
      <div className={s.window}>
        <TitleBar>{null}</TitleBar>
        <div className={s.loading}>{model.error === null ? <Spinner /> : <p role="alert">{model.error}</p>}</div>
      </div>
    )
  }

  const session = snapshot.session
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  const lead = session === null ? noLead : modelInfo({ id: session.agentId, name: session.agentName }, session.model)
  const { status, state } = statusOf(snapshot)
  const busy = session?.turnRunning ?? false
  const others = model.agents.filter((agent) => agent.id !== session?.agentId)
  // A stopped task picks up with the agent that last led it, when it still can.
  const last = snapshot.items.findLast((item) => item.agentId !== null)?.agentId
  const chosen = pick ?? model.agents.find((agent) => agent.id === last)?.id ?? model.agents[0]?.id ?? null

  const send = (body: string, now: boolean) => {
    setDraft('')
    void (now ? model.sendNow(body) : model.send(body))
  }

  const actions =
    session === null ? (
      chosen !== null && <TaskMenu status={status} onResume={() => void model.start(chosen)} />
    ) : (
      <>
        {session.models.length > 0 && (
          <Select
            label={text.model}
            variant="quiet"
            value={session.model}
            options={session.models.map((value) => ({ value, label: value }))}
            onChange={(value) => void model.setModel(value)}
          />
        )}
        {others.length > 0 && (
          <Select
            label={text.handTo}
            variant="quiet"
            value={null}
            placeholder={text.handTo}
            options={others.map((agent) => ({ value: agent.id, label: agent.name }))}
            onChange={(agentId) => void model.switchAgent(agentId)}
          />
        )}
        <TaskMenu status={status} onStop={() => void model.stop()} />
      </>
    )

  const composer = (
    <div className={s.composer}>
      {model.error !== null && (
        <p className={s.failure} role="alert">
          {model.error} <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
        </p>
      )}
      {session === null && (
        <div className={s.start}>
          <span>{text.noLeadNote}</span>
          {model.agents.length > 0 && chosen !== null && (
            <>
              <Select
                label={text.lead}
                variant="filled"
                value={chosen}
                options={model.agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                onChange={setPick}
              />
              <Button variant="signal" size="small" busy={model.pending} onClick={() => void model.start(chosen)}>
                {text.startLead}
              </Button>
            </>
          )}
        </div>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        placeholder={session === null ? text.placeholderNone : busy ? text.placeholderBusy : text.placeholder(session.agentName)}
      />
    </div>
  )

  return (
    <div className={s.window}>
      <TitleBar>
        <BackCrumb to={snapshot.project.name} onBack={onBack} task={snapshot.task.slug} title={snapshot.task.title} />
      </TitleBar>
      <div className={s.head}>
        <ThreadMeasure>
          <TaskHeader
            title={snapshot.task.title}
            status={status}
            state={state}
            lead={lead}
            {...(snapshot.task.branch === null ? {} : { branch: snapshot.task.branch })}
            actions={actions}
          />
        </ThreadMeasure>
      </div>
      <TaskFace className={s.face} composer={composer}>
        <Thread label={text.thread} busy={busy}>
          {snapshot.earlier && (
            <ThreadDivider
              icon="up"
              action={model.loadingEarlier ? text.loadingEarlier : text.showEarlier}
              onAction={() => void model.loadEarlier()}
            >
              {text.earlier}
            </ThreadDivider>
          )}
          <ThreadBlocks
            blocks={blocksOf(
              { items: snapshot.items, turnRunning: busy, worktree: snapshot.task.worktree },
              model.streaming,
              (iso) => ago(iso),
              now,
            )}
            agentName={agentName}
          />
          {snapshot.attention.map((request) => (
            <Call key={request.id} request={request} project={snapshot.project.name} onAnswer={model.answer} />
          ))}
        </Thread>
      </TaskFace>
    </div>
  )
}
