import { useState } from 'react'

import type { AttentionRequest, ChangeSummary, ThreadSnapshot } from '@charrette/contracts'
import {
  BackCrumb,
  Button,
  type ChangeCheck,
  ChangeSet,
  ChangeState,
  CheckState,
  ChromeButton,
  Composer,
  Decision,
  Issue,
  LinkButton,
  type ModelInfo,
  Permission,
  Select,
  SidePanel,
  SidePanelBody,
  SidePanelTitle,
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
import { issuePriority, issueStatus, productBrand, productName } from '../../shared/products'
import { ago, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { StuckCall } from './StuckCall'
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
  ready: 'Ready',
  idle: 'Idle',
  stopped: 'Stopped',
  dismiss: 'Dismiss',
  earlier: 'Earlier in this task',
  showEarlier: 'Show',
  loadingEarlier: 'Showing…',
  change: (change: ChangeSummary) => `${change.short} ${change.prefix}${change.number}`,
  changePanel: (change: ChangeSummary) => (change.noun === 'merge request' ? 'Merge request' : 'Pull request'),
  draftNote: 'Its checks run on it; mark it ready when you are',
  readyNote: (host: string) => `Merge it on ${host} when you’re ready`,
  closed: (change: ChangeSummary, host: string) => `${text.change(change)} was closed on ${host}.`,
  markReady: 'Mark ready for review',
  openOn: (host: string) => `Open on ${host}`,
}

/** A check as the kit lists it: one that was skipped or said nothing counts as passed, with what it said. */
const checkOf = (check: NonNullable<ChangeSummary['checks']>['list'][number], index: number): ChangeCheck => {
  const state = ((): CheckState => {
    switch (check.state) {
      case 'queued':
        return CheckState.Queued
      case 'running':
        return CheckState.Running
      case 'failed':
        return CheckState.Failed
      default:
        return CheckState.Passed
    }
  })()
  const said = check.state === 'skipped' || check.state === 'neutral' || check.state === 'cancelled' ? check.state : check.summary
  return { id: `${index}-${check.name}`, name: check.name, state, ...(said === null ? {} : { detail: said }) }
}

/** Where a task stands, for its header. */
export const statusOf = (snapshot: ThreadSnapshot): { readonly status: TaskStatus; readonly state: string } => {
  if (snapshot.attention.length > 0) return { status: TaskStatus.Yours, state: text.needsYou }
  if (snapshot.session?.turnRunning === true) return { status: TaskStatus.Running, state: text.working }
  // A run that passed review is ready, whatever its lead is doing now.
  if (snapshot.task.phase === 'ready' || snapshot.task.phase === 'settled') return { status: TaskStatus.Done, state: text.ready }
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

/** A task's pull request beside its thread: the kit's change set, and what the person can do with it here. */
function ChangePanel({
  snapshot,
  change,
  lead,
  agentName,
  onReady,
  onClose,
  pending,
}: {
  snapshot: ThreadSnapshot
  change: ChangeSummary
  lead: ModelInfo
  agentName: (id: string | null) => string
  onReady: () => void
  onClose: () => void
  pending: boolean
}) {
  const host = productName(change.product)
  const reviewers = [
    ...new Set(
      snapshot.items.flatMap((item) =>
        item.kind === 'step_result' && item.content.step === 'review' && item.content.agentId !== null ? [item.content.agentId] : [],
      ),
    ),
  ].map((id) => modelInfo({ id, name: agentName(id) }, null))
  const state = change.state === 'merged' ? ChangeState.Merged : change.draft ? ChangeState.Draft : ChangeState.Ready
  return (
    <SidePanel label={text.changePanel(change)} head={<SidePanelTitle>{text.changePanel(change)}</SidePanelTitle>} onClose={onClose}>
      <SidePanelBody>
        {change.state === 'closed' ? (
          <p className={s.quiet}>{text.closed(change, host)}</p>
        ) : (
          <ChangeSet
            state={state}
            host={{ name: host, brand: productBrand(change.product) }}
            {...(state === ChangeState.Draft
              ? { note: text.draftNote }
              : state === ChangeState.Ready
                ? { note: text.readyNote(host) }
                : {})}
            title={change.title}
            branch={snapshot.task.branch ?? ''}
            base={(snapshot.task.baseRef ?? '').replace(/^origin\//, '')}
            commits={snapshot.task.commits}
            lead={lead}
            reviewers={reviewers}
            prs={[{ repo: change.repository, number: change.number, url: change.url, files: snapshot.task.files }]}
            checks={(change.checks?.list ?? []).map(checkOf)}
            headingLevel={3}
            text={{
              number: (n) => `${change.prefix}${n}`,
              prs: () => text.changePanel(change),
              onHostLabel: (repo, n, on) => `Open ${repo} ${change.prefix}${n} on ${on}`,
            }}
          />
        )}
        <div className={s.changeActions}>
          {change.state === 'open' && change.draft && (
            <Button variant="signal" busy={pending} onClick={onReady}>
              {text.markReady}
            </Button>
          )}
          <a className={s.external} href={change.url} target="_blank" rel="noreferrer">
            {text.openOn(host)}
          </a>
        </div>
      </SidePanelBody>
    </SidePanel>
  )
}

export function TaskView({ model, onBack }: { model: TaskModel; onBack: () => void }) {
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [showChange, setShowChange] = useState(false)
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

  const change = snapshot.task.changes[0] ?? null
  const issue = snapshot.task.issue
  // Its pull request opens beside the thread.
  const changeButton = change !== null && (
    <ChromeButton icon="pr" label={text.change(change)} expanded={showChange} onClick={() => setShowChange((open) => !open)} />
  )
  const actions =
    session === null ? (
      <>
        {changeButton}
        {chosen !== null && <TaskMenu status={status} onResume={() => void model.start(chosen)} />}
      </>
    ) : (
      <>
        {changeButton}
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
      <TaskFace
        className={s.face}
        composer={composer}
        panel={
          showChange && change !== null ? (
            <ChangePanel
              snapshot={snapshot}
              change={change}
              lead={lead}
              agentName={agentName}
              pending={model.pending}
              onReady={() => void model.markReady()}
              onClose={() => setShowChange(false)}
            />
          ) : undefined
        }
      >
        <Thread label={text.thread} busy={busy}>
          {issue !== null && !snapshot.earlier && (
            <div className={s.issue}>
              <Issue
                mark={productBrand(issue.product)}
                source={productName(issue.product)}
                id={issue.key}
                tone={issue.product === 'linear' ? 'linear' : 'plain'}
                title={issue.title}
                href={issue.url}
                status={{ state: issueStatus(issue.status.category), label: issue.status.name }}
                {...(issue.priority === null || issue.priority.level === 'none'
                  ? {}
                  : { priority: { level: issuePriority(issue.priority.level), label: issue.priority.name } })}
                {...(issue.container === null ? {} : { meta: issue.container })}
              />
            </div>
          )}
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
          {snapshot.attention.map((request) =>
            request.kind === 'stuck' && request.stuck !== null ? (
              <StuckCall
                key={request.id}
                request={request}
                stuck={request.stuck}
                agents={model.agents}
                agentName={agentName}
                onAnswer={(attentionId, answer) => void model.answerStuck(attentionId, answer)}
              />
            ) : (
              <Call key={request.id} request={request} project={snapshot.project.name} onAnswer={model.answer} />
            ),
          )}
        </Thread>
      </TaskFace>
    </div>
  )
}
