import { Fragment, useState, type ReactNode } from 'react'

import type { Unfurl } from '@althar/contracts'
import {
  Arrived,
  CodeBlock,
  FindingState,
  Issue,
  LinkButton,
  Markdown,
  Plan,
  Prose,
  Reasoning,
  Review,
  type ReviewFinding,
  Severity,
  Step,
  StepState,
  ThreadDivider,
  Tool,
  ToolState,
  Turn,
  Verdict,
  WorkedFor,
  You,
} from '@althar/ui'

import { CommandOutput } from './CommandOutput'
import { HandedBack } from './HandedBack'
import { lastTouches } from './handed'
import { useModelNames } from './modelNames'
import { issuePriority, issueStatus, productBrand, productName } from './products'
import type { ArrivalContent, Block, Part, StepResult, TaskCardContent } from './thread'
import s from './ThreadBlocks.module.css'

/*
 * A thread's blocks as the kit draws them, the same in a task and in the
 * coordinator's thread. A turn's work folds under how long it worked, or is
 * working, with its last message open under it; a step's result stands open
 * under the work that led to it. A task's card is the host's
 * to draw, since what it can do with one is the host's.
 */

/** How long a command can be before its row, at the thread's width, clips it. */
const LONG_COMMAND = 72

export const text = {
  thought: 'Thought',
  shell: 'Shell',
  step: { implement: 'Implement', review: 'Review', settle: 'Settle', publish: 'Pull request' } satisfies Record<
    StepResult['step'],
    string
  >,
  pushed: 'Push',
  change: {
    draft: 'Draft',
    open: 'Open',
    merged: 'Merged',
    closed: 'Closed',
  } satisfies Record<Extract<Unfurl, { kind: 'change' }>['state'], string>,
  heard: {
    comment: 'commented on',
    approved: 'approved',
    changes_requested: 'asked for changes on',
    commented: 'reviewed',
    checksPassed: 'Checks passed on',
    checksFailed: (failed: number, total: number) => (failed === total ? 'Checks failed on' : `${failed} of ${total} checks failed on`),
    merged: 'Merged',
    closed: 'Closed',
    ready: 'Ready for review:',
  },
  failing: (names: ReadonlyArray<string>) => `Failed: ${names.join(', ')}`,
  outsider: (from: string) => `Not passed to the lead: ${from} can’t write to the repository.`,
  passOn: 'Pass it on',
  /** What passing it on says to the lead, in the person's name. */
  passed: (said: string, text: string) =>
    `${said}:\n\n${text
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`,
}

const SEVERITY: Readonly<Record<StepResult['findings'][number]['severity'], Severity>> = {
  blocking: Severity.High,
  major: Severity.High,
  minor: Severity.Medium,
  nit: Severity.Low,
}

/**
 * A tool call. A command opens to what it printed, as the kit's Terminal:
 * open while it runs, so its output streams in view, and read from what was
 * kept only once opened. One from before Althar kept output, too long for
 * its row, opens to the whole command.
 */
function ToolView({ part, threadId }: { part: Extract<Part, { kind: 'tool' }>; threadId: string }) {
  const [open, setOpen] = useState(part.state === ToolState.Running && part.ran !== null)
  /* once opened, what it printed stays, so it doesn't vanish as the call folds */
  const [seen, setSeen] = useState(open)
  const long = part.command !== null && (part.command.includes('\n') || part.command.length > LONG_COMMAND)
  const body =
    part.ran !== null ? (
      seen ? (
        <CommandOutput
          threadId={threadId}
          itemId={part.id}
          ran={part.ran}
          exit={part.exit}
          {...(long && part.command !== null ? { command: part.command } : {})}
        />
      ) : (
        <></>
      )
    ) : long && part.command !== null ? (
      <CodeBlock code={part.command} lang={text.shell} />
    ) : undefined
  return (
    <Tool
      kind={part.toolKind}
      verb={part.verb}
      target={part.target}
      state={part.state}
      {...(part.command === null ? {} : { copy: part.command })}
      {...(part.state === ToolState.Failed && part.exit !== null ? { exit: part.exit } : {})}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSeen(true)
      }}
    >
      {body}
    </Tool>
  )
}

function PartView({ part, threadId }: { part: Part; threadId: string }) {
  switch (part.kind) {
    case 'message':
      return <Markdown source={part.text} />
    case 'thought':
      return (
        <Reasoning took="" text={{ thought: () => text.thought }}>
          <Prose dim>{part.text}</Prose>
        </Reasoning>
      )
    case 'tool':
      return <ToolView part={part} threadId={threadId} />
    case 'plan':
      return <Plan steps={part.steps} />
    case 'notice':
      return <p className={s[part.tone]}>{part.text}</p>
  }
}

/** What a step reported: the lead's summary, open under its work, or the review's verdict and findings. */
function StepView({ id, result, of }: { id: string; result: StepResult; of: number }) {
  const named = useModelNames()
  // Implement is the first step, a review and settling it the second, and the pull request the last.
  const n = result.step === 'implement' ? 1 : result.step === 'publish' ? of : 2
  const model = result.agentId === null ? undefined : named(result.agentId)
  if (result.step === 'publish') {
    const change = result.change
    return (
      <Step
        n={n}
        of={of}
        label={change === null ? text.pushed : text.step.publish}
        state={StepState.Done}
        defaultOpen
        detail={
          <>
            <Markdown source={result.summary} />
            {change !== null && (
              <Issue
                mark={productBrand(change.product)}
                source={productName(change.product)}
                id={`${change.short} ${change.prefix}${change.number}`}
                title={change.title}
                href={change.url}
                meta={[change.repository, change.draft ? text.change.draft : text.change[change.state]].join(' · ')}
              />
            )}
          </>
        }
      />
    )
  }
  if (result.step !== 'review')
    return (
      <Step
        n={n}
        of={of}
        label={text.step[result.step]}
        state={StepState.Done}
        {...(model === undefined ? {} : { model })}
        defaultOpen
        detail={<Markdown source={result.summary} />}
      />
    )
  // The lead settles findings on its own for now: what the review found is left to it.
  const findings: ReadonlyArray<ReviewFinding> = result.findings.map((finding, index) => ({
    id: `${id}-${index}`,
    severity: SEVERITY[finding.severity],
    at: finding.file === null ? '' : finding.line === null ? finding.file : `${finding.file}:${finding.line}`,
    by: model === undefined ? [] : [model],
    state: FindingState.Lead,
    claim: finding.claim,
  }))
  return (
    <>
      <Review
        n={n}
        of={of}
        reviewers={model === undefined ? [] : [{ model }]}
        verdict={result.verdict === 'pass' ? Verdict.Pass : Verdict.Changes}
        defaultFindings={findings}
        {...(result.round > 0 ? { round: result.round + 1 } : {})}
      />
      {result.summary !== '' && (
        <div className={s.said}>
          <Markdown source={result.summary} />
        </div>
      )}
    </>
  )
}

/** A link the person pasted, unfurled: an issue as its tracker shows it, or a pull request. */
function LinkView({ link }: { link: Unfurl }) {
  if (link.kind === 'issue')
    return (
      <Issue
        mark={productBrand(link.product)}
        source={productName(link.product)}
        id={link.key}
        tone={link.product === 'linear' ? 'linear' : 'plain'}
        title={link.title}
        href={link.url}
        status={{ state: issueStatus(link.status.category), label: link.status.name }}
        {...(link.priority === null || link.priority.level === 'none'
          ? {}
          : { priority: { level: issuePriority(link.priority.level), label: link.priority.name } })}
        {...(link.container === null ? {} : { meta: link.container })}
      />
    )
  return (
    <Issue
      mark={productBrand(link.product)}
      source={productName(link.product)}
      id={link.key}
      title={link.title}
      href={link.url}
      meta={`${link.repository} · ${text.change[link.state]}`}
    />
  )
}

/** Something heard from outside, as a quoted note: who, what they did, where, and what they said. */
/**
 * Something heard from outside. What someone who can't write to the
 * repository said wasn't passed to the lead, as anyone can comment on a
 * public one; the person reads it, and can pass it on.
 */
function ArrivalView({ arrival, at, onPassOn }: { arrival: ArrivalContent; at: string; onPassOn?: (words: string) => void }) {
  const where =
    arrival.path === null ? arrival.where : `${arrival.where} · ${arrival.path}${arrival.line === null ? '' : `:${arrival.line}`}`
  const verb = ((): string => {
    switch (arrival.kind) {
      case 'comment':
        return text.heard.comment
      case 'review':
        return arrival.verdict === null ? text.heard.commented : text.heard[arrival.verdict]
      case 'checks': {
        const failed = arrival.failed ?? 0
        return failed === 0 ? text.heard.checksPassed : text.heard.checksFailed(failed, failed + (arrival.passed ?? 0))
      }
      case 'merged':
        return text.heard.merged
      case 'closed':
        return text.heard.closed
      case 'ready':
        return text.heard.ready
    }
  })()
  const body = arrival.kind === 'checks' ? (arrival.failing.length > 0 ? text.failing(arrival.failing) : null) : arrival.text
  const from = arrival.from ?? ''
  const foot = arrival.outsider && (
    <>
      <span>{text.outsider(from)}</span>
      {onPassOn !== undefined && body !== null && body !== '' && (
        <LinkButton onClick={() => onPassOn(text.passed(`${from} ${verb} ${where}`, body))}>{text.passOn}</LinkButton>
      )}
    </>
  )
  return (
    <Arrived
      {...(arrival.from === null ? {} : { from: arrival.from })}
      verb={verb}
      where={where}
      at={at}
      mark={productBrand(arrival.source)}
      {...(foot === false ? {} : { foot })}
    >
      {body !== null && body !== '' && <Markdown source={body} />}
    </Arrived>
  )
}

export function ThreadBlocks({
  blocks,
  threadId,
  worktree = null,
  openFile,
  session,
  card,
  queued,
  onPassOn,
}: {
  blocks: ReadonlyArray<Block>
  /** The thread they are of: what a command printed and the documents an agent wrote are read by it. */
  threadId: string
  /** The worktree its paths are under, for the files a turn hands back. */
  worktree?: string | null
  /** Opens a file of the task's in the person's editor; without it, a file has no such button. */
  openFile?: (path: string) => void
  /** The thread's session, whose model and account name its turns. */
  session?: { readonly agentId: string; readonly model: string | null; readonly account: string | null } | null
  /** Sends what someone outside said to the lead, in the person's name. */
  onPassOn?: (words: string) => void
  /** Draws a task's card, in the coordinator's thread. */
  card?: (card: TaskCardContent) => ReactNode
  /** What a message still waiting says: who reads it next. */
  queued?: string
}) {
  // A task that was reviewed has two steps, the review and settling it being the second; its pull request, once opened, is one more.
  const done = new Set(blocks.flatMap((block) => (block.kind === 'step' ? [block.result.step] : [])))
  const of = 1 + (done.has('review') || done.has('settle') ? 1 : 0) + (done.has('publish') ? 1 : 0)
  const named = useModelNames()
  // Where each file was last touched, so a document is read again after an edit.
  const touched = lastTouches(
    blocks.flatMap((block) => (block.kind === 'turn' ? block.parts : [])),
    worktree,
  )
  // A turn of the thread's own agent, on its session's model and account; another's, on its own model.
  const turnModel = (agentId: string | null) =>
    session != null && agentId === session.agentId ? named(agentId, session.model, session.account) : named(agentId)
  return blocks.map((block) => {
    switch (block.kind) {
      case 'you':
        return (
          <Fragment key={block.id}>
            <You at={block.at} delivery={block.delivery} {...(queued === undefined ? {} : { text: { queued } })}>
              {block.text}
            </You>
            {block.links.length > 0 && (
              <div className={s.links}>
                {block.links.map((link) => (
                  <LinkView key={link.url} link={link} />
                ))}
              </div>
            )}
          </Fragment>
        )
      case 'arrival':
        return <ArrivalView key={block.id} arrival={block.arrival} at={block.at} {...(onPassOn === undefined ? {} : { onPassOn })} />
      case 'divider':
        return (
          <ThreadDivider key={block.id} icon="agents">
            {block.text}
          </ThreadDivider>
        )
      case 'step':
        return <StepView key={block.id} id={block.id} result={block.result} of={of} />
      case 'card':
        return <Fragment key={block.id}>{card?.(block.card)}</Fragment>
      case 'turn': {
        // What Copy takes: what it said, open under its work.
        const said = block.said.flatMap((part) => (part.kind === 'message' && part.text.trim() !== '' ? [part.text] : [])).join('\n\n')
        return (
          <Turn key={block.id} model={turnModel(block.agentId)} at={block.at} {...(said === '' || block.live ? {} : { copy: said })}>
            {block.work.length > 0 && (
              <WorkedFor took={block.took} live={block.live} {...(block.doing === null ? {} : { summary: block.doing })}>
                {block.work.map((part) => (
                  <PartView key={part.id} part={part} threadId={threadId} />
                ))}
              </WorkedFor>
            )}
            {block.said.map((part) => (
              <PartView key={part.id} part={part} threadId={threadId} />
            ))}
            <HandedBack handed={block.handed} threadId={threadId} touched={touched} {...(openFile === undefined ? {} : { openFile })} />
          </Turn>
        )
      }
    }
  })
}
