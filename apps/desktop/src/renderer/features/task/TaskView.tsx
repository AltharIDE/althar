import { useEffect, useMemo, useState } from 'react'

import type { ChangeSummary, ThreadSnapshot } from '@althar/contracts'
import {
  BackCrumb,
  Button,
  ChangeSet,
  ChangeState,
  ChangeView,
  ChromeButton,
  Composer,
  Issue,
  LinkButton,
  type ModelInfo,
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
} from '@althar/ui'

import { useModels } from '../../data/models'
import { modelInfo, waitsWords } from '../../shared/agents'
import { ModelChoice } from '../../shared/ModelChoice'
import { catalogOf, type Choice, modelName, runningOn } from '../../shared/models'
import { checkOf } from '../../shared/checks'
import { issuePriority, issueStatus, productBrand, productName } from '../../shared/products'
import { stepText, trackFor } from '../../shared/steps'
import { ago, clock, running, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { PermissionCall } from './PermissionCall'
import { StuckCall } from './StuckCall'
import s from './Task.module.css'
import { mergeHereLabel } from '../../shared/mergeHere'
import { useChanges } from './useChanges'
import type { TaskModel } from './useTask'

/*
 * A task: its header, its thread, and the composer that talks to its lead.
 * What the rules keep for the person arrives as a call at the end of the
 * thread. What it changed opens over the whole window, file by file, from
 * its header, its pull request, or ⌘D. Everything drawn here is the kit's;
 * this view only arranges it.
 */

/** A pull request's repository by its name alone: `web` for `meridian/web`. */
const repositoryName = (change: ChangeSummary) => change.repository.slice(change.repository.lastIndexOf('/') + 1)

export const text = {
  thread: 'Thread',
  noLead: 'No lead',
  lead: 'Lead',
  placeholderBusy: 'Add to the queue, or interrupt the lead',
  placeholder: (lead: string) => `Tell ${lead} something`,
  handsOver: (agent: string) => `hands the task to ${agent}`,
  takesOver: (to: string, from: string) => `${to} takes over from a brief; ${from}’s turn stops.`,
  handOver: 'Hand it over',
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
  /** In a task of several repositories, each pull request by its repository's name. */
  changeIn: (change: ChangeSummary) => `${repositoryName(change)} ${change.short} ${change.prefix}${change.number}`,
  changePanel: (change: ChangeSummary) => (change.noun === 'merge request' ? 'Merge request' : 'Pull request'),
  draftNote: 'Its checks run on it; mark it ready when you are',
  readyNote: (host: string) => `Merge it on ${host} when you’re ready`,
  closed: (change: ChangeSummary, host: string) => `${text.change(change)} was closed on ${host}.`,
  markReady: 'Mark ready for review',
  openChange: 'Open a pull request',
  push: (n: number) => (n === 1 ? 'Push 1 commit' : `Push ${n} commits`),
  pushTo: (n: number, change: ChangeSummary) => `${text.push(n)} to ${repositoryName(change)}`,
  unpushed: (n: number, change: ChangeSummary) =>
    n === 1 ? `One commit isn’t on the ${change.noun} yet.` : `${n} commits aren’t on the ${change.noun} yet.`,
  openOn: (host: string) => `Open on ${host}`,
  files: (count: number) => (count === 1 ? '1 file' : `${count} files`),
  reviewDiff: 'Review the changes',
  diffKey: '⌘D',
}

/**
 * Where a task stands, for its header: the step it is on, by what it does
 * there; a step held for a usage limit says whom it waits for, and until when.
 */
export const statusOf = (
  snapshot: ThreadSnapshot,
  agentName: (id: string) => string = (id) => id,
): { readonly status: TaskStatus; readonly state: string } => {
  if (snapshot.attention.length > 0) return { status: TaskStatus.Yours, state: text.needsYou }
  const { waits, phase, step } = snapshot.task
  if (waits !== null) return { status: TaskStatus.Paused, state: waitsWords(agentName(waits.agentId), clock(waits.until)) }
  const doing = step === null ? undefined : stepText.now[step]
  if (snapshot.session?.turnRunning === true) return { status: TaskStatus.Running, state: doing ?? text.working }
  // A run that passed review is ready, whatever its lead is doing now.
  if (phase === 'ready' || phase === 'settled') return { status: TaskStatus.Done, state: text.ready }
  // On a step another agent takes, a review, while its lead waits.
  if (phase === 'running' && doing !== undefined) return { status: TaskStatus.Running, state: doing }
  if (snapshot.session === null) return { status: TaskStatus.Stopped, state: text.stopped }
  return { status: TaskStatus.Running, state: text.idle }
}

/** A task's clock runs while it is under way or waits on the person. */
const ticking = (snapshot: ThreadSnapshot | null) =>
  snapshot !== null && (snapshot.session?.turnRunning === true || snapshot.task.phase === 'running' || snapshot.task.phase === 'waiting')

/**
 * How long a task has run: from its start until now while its clock runs;
 * once ready, until its last step reported; stopped, until the last thing it
 * said; settled, until it settled. Null before it starts.
 */
export const elapsedOf = (snapshot: ThreadSnapshot, now: string): string | null => {
  const { startedAt, settledAt, phase } = snapshot.task
  if (startedAt === null) return null
  if (settledAt !== null) return running(startedAt, settledAt)
  if (ticking(snapshot)) return running(startedAt, now)
  const last = phase === 'ready' ? snapshot.items.findLast((item) => item.kind === 'step_result') : snapshot.items.at(-1)
  return running(startedAt, last?.createdAt ?? now)
}

const noLead: ModelInfo = { id: 'none', name: text.noLead, short: text.noLead, runtime: '', efforts: [] }

/** A task's pull request beside its thread: the kit's change set, and what the person can do with it here. */
function ChangePanel({
  snapshot,
  change,
  lead,
  agentName,
  onReady,
  onPush,
  onClose,
  onOpenFile,
  pending,
}: {
  snapshot: ThreadSnapshot
  change: ChangeSummary
  lead: ModelInfo
  agentName: (id: string | null) => string
  onReady: () => void
  /** Pushes what the lead committed since, up to the commit shown. */
  onPush: (head: string) => void
  onClose: () => void
  /** Opens what the task changed over the whole window, on a file or the first. */
  onOpenFile: (path?: string) => void
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
            onOpenFile={onOpenFile}
            onReviewDiff={() => onOpenFile()}
            diffKey={text.diffKey}
            headingLevel={3}
            text={{
              number: (n) => `${change.prefix}${n}`,
              prs: () => text.changePanel(change),
              onHostLabel: (repo, n, on) => `Open ${repo} ${change.prefix}${n} on ${on}`,
            }}
          />
        )}
        {change.state === 'open' && change.unpushed > 0 && change.localHead !== null && (
          <p className={s.quiet}>{text.unpushed(change.unpushed, change)}</p>
        )}
        <div className={s.changeActions}>
          {change.state === 'open' && change.unpushed > 0 && change.localHead !== null && (
            <Button variant="signal" busy={pending} onClick={() => onPush(change.localHead ?? '')}>
              {text.push(change.unpushed)}
            </Button>
          )}
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
  const [pick, setPick] = useState<Choice | null>(null)
  // The pull request open beside the thread, by its address.
  const [showChange, setShowChange] = useState<string | null>(null)
  const known = useModels()
  const catalog = useMemo(() => catalogOf(known ?? [], model.agents), [known, model.agents])
  const files = model.snapshot?.task.files ?? []
  const changes = useChanges(model.snapshot?.task.id ?? null, files[0]?.path ?? null)
  // ⌘D opens what the task changed, when it changed something. With its modifier, never set off by typing or by voice.
  const { show } = changes
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (files.length === 0) return
      event.preventDefault()
      show()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, files.length])
  // A running turn says how long it has worked so far, and a task under way how long it has run.
  const now = useNow(ticking(model.snapshot))
  const snapshot = model.snapshot
  if (snapshot === null) {
    return (
      <div className={s.window}>
        <TitleBar lights="none">{null}</TitleBar>
        <div className={s.loading}>{model.error === null ? <Spinner /> : <p role="alert">{model.error}</p>}</div>
      </div>
    )
  }

  const session = snapshot.session
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  const lead =
    session === null
      ? noLead
      : modelInfo({ id: session.agentId, name: session.agentName }, modelName(catalog, session.agentId, session.model))
  const { status, state } = statusOf(snapshot, agentName)
  const elapsed = elapsedOf(snapshot, now)
  const busy = session?.turnRunning ?? false
  // A stopped task picks up with the agent that last led it, when it still can.
  const last = snapshot.items.findLast((item) => item.agentId !== null)?.agentId
  const resume = model.agents.find((agent) => agent.id === last) ?? model.agents[0]
  const chosen: Choice | null = pick ?? (resume === undefined ? null : { agentId: resume.id, model: null, effort: null })
  const choice = session === null ? chosen : runningOn(session)

  // With no lead working, what the person says starts the one picked, as its first turn.
  const send = (body: string, now: boolean) => {
    setDraft('')
    if (session === null) void model.send(body, chosen ?? undefined)
    else void (now ? model.sendNow(body) : model.send(body))
  }

  const { changes: pullRequests } = snapshot.task
  const change = pullRequests[0] ?? null
  const shown = pullRequests.find((candidate) => candidate.url === showChange) ?? null
  const several = pullRequests.length > 1
  const issue = snapshot.task.issue
  const ready = snapshot.task.phase === 'ready'
  // Work that ended on its branch merges here, beside any pull request of the rest, or can still open its pull request.
  const mergeable = ready && snapshot.task.here.length > 0
  const unpublished = ready && change === null && snapshot.task.commits > 0
  // Its pull request opens beside the thread.
  const changeButton = (
    <>
      {mergeable && (
        <Button size="small" busy={model.pending} onClick={() => void model.mergeHere()}>
          {mergeHereLabel(snapshot.task.here, change !== null)}
        </Button>
      )}
      {unpublished && (
        <Button size="small" busy={model.pending} onClick={() => void model.openChange()}>
          {text.openChange}
        </Button>
      )}
      {files.length > 0 && (
        <ChromeButton
          icon="file"
          label={text.files(files.length)}
          kbd={text.diffKey}
          expanded={changes.open}
          onClick={() => changes.show()}
        />
      )}
      {pullRequests.map((each) =>
        each.state === 'open' && each.unpushed > 0 && each.localHead !== null ? (
          <Button
            key={`push-${each.url}`}
            size="small"
            busy={model.pending}
            onClick={() => void model.push(each.localHead ?? '', each.url)}
          >
            {several ? text.pushTo(each.unpushed, each) : text.push(each.unpushed)}
          </Button>
        ) : null,
      )}
      {pullRequests.map((each) => (
        <ChromeButton
          key={each.url}
          icon="pr"
          label={several ? text.changeIn(each) : text.change(each)}
          expanded={showChange === each.url}
          onClick={() => setShowChange((open) => (open === each.url ? null : each.url))}
        />
      ))}
    </>
  )
  const actions =
    session === null ? (
      changeButton
    ) : (
      <>
        {changeButton}
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
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        placeholder={busy ? text.placeholderBusy : text.placeholder(session?.agentName ?? agentName(chosen?.agentId ?? null))}
        // Another agent's model hands the task to that agent.
        picker={
          model.agents.length > 0 &&
          choice !== null && (
            <ModelChoice
              owner={text.lead}
              agents={model.agents}
              value={choice}
              onChange={(next) => (session === null ? setPick(next) : void model.choose(next))}
              // A lead that runs is handed over by another agent's model; one at work, only once the person says.
              {...(session === null ? {} : { handover: { note: text.handsOver, ask: busy ? text.takesOver : null } })}
              text={{ proceed: text.handOver }}
            />
          )
        }
      />
    </div>
  )

  return (
    <div className={s.window}>
      <TitleBar lights="none">
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
            {...(elapsed === null ? {} : { elapsed })}
            steps={trackFor(snapshot.task.steps, snapshot.task.step, status === TaskStatus.Done)}
            actions={actions}
          />
        </ThreadMeasure>
      </div>
      <TaskFace
        className={s.face}
        composer={composer}
        panel={
          shown !== null ? (
            <ChangePanel
              snapshot={snapshot}
              change={shown}
              lead={lead}
              agentName={agentName}
              pending={model.pending}
              onReady={() => void model.markReady(shown.url)}
              onPush={(head) => void model.push(head, shown.url)}
              onClose={() => setShowChange(null)}
              onOpenFile={changes.show}
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
            onPassOn={(words) => void model.send(words)}
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
              <PermissionCall key={request.id} request={request} project={snapshot.project.name} onAnswer={model.answer} />
            ),
          )}
        </Thread>
      </TaskFace>
      {changes.open && (
        <ChangeView
          branch={snapshot.task.branch ?? ''}
          {...(snapshot.task.baseRef === null ? {} : { base: snapshot.task.baseRef.replace(/^origin\//, '') })}
          files={files}
          selected={changes.selected}
          onSelect={changes.select}
          view={changes.view}
          onRetry={changes.retry}
          onClose={changes.close}
        />
      )}
    </div>
  )
}
