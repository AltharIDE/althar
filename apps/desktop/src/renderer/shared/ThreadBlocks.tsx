import { Fragment, useState, type ReactNode } from 'react'

import type { FieldAnswer, Unfurl } from '@althar/contracts'
import {
  Arrived,
  CodeBlock,
  FailedLogs,
  Gallery,
  Issue,
  IssueRef,
  LinkButton,
  Markdown,
  Plan,
  Prose,
  Question,
  type QuestionAnswer,
  Reasoning,
  Terminal,
  Thinking,
  ThreadDivider,
  Tool,
  ToolState,
  Turn,
  WorkedFor,
  You,
} from '@althar/ui'

import { CommandOutput } from './CommandOutput'
import { shotsOf } from './evidence'
import { HandedBack } from './HandedBack'
import { documentVersions } from './handed'
import { fileAttachments } from './files'
import { sentAttachments } from './images'
import { useModelNames } from './modelNames'
import { keyOf, pastedIn } from './pasted'
import { RuleReceipt } from './RuleReceipt'
import { SaidIn } from './code/CodeHost'
import { issuePriority, issueStatus, productBrand, productName } from './products'
import { answersOf, partsOf, pickedOf, questionText } from './questions'
import type {
  ArrivalContent,
  AutomationCardContent,
  Block,
  IssueChangesContent,
  IssueDraftContent,
  ReviewDraftContent,
  Part,
  PushRequestContent,
  QuestionContent,
  RunContent,
  SetupContent,
  StepResult,
  TaskCardContent,
} from './thread'
import s from './ThreadBlocks.module.css'

/*
 * A thread's blocks as the kit draws them, the same in a task and in the
 * coordinator's thread. A turn's work folds under how long it worked, or is
 * working, with its last message open under it; a step's result stands open
 * under the work that led to it. Before the agent says anything, its turn
 * stands under its name, thinking, where its words will take its place. A
 * task's card is the host's to draw, since what it can do with one is the
 * host's.
 */

/** How long a command can be before its row, at the thread's width, clips it. */
const LONG_COMMAND = 72

export const text = {
  thought: 'Thought',
  /** Under a last turn that failed, as on the connection: what the person said in it goes again. */
  tryAgain: 'Try again',
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
  /** Althar setting up a repository's worktree: installing the dependencies its lockfile names, or the setup kept for it. */
  setup: {
    running: (setup: SetupContent) => (setup.kept ? `Setting up ${setup.repository}…` : `Installing dependencies in ${setup.repository}…`),
    done: (setup: SetupContent) => (setup.kept ? `Set up ${setup.repository}` : `Installed dependencies in ${setup.repository}`),
    failed: (setup: SetupContent) =>
      `${setup.kept ? `Couldn’t set up ${setup.repository}` : `Couldn’t install dependencies in ${setup.repository}`}. The lead is told.`,
    stopped: (setup: SetupContent) => `Setting up ${setup.repository} stopped as Althar quit. It runs again before the lead starts.`,
    timedOut: 'It took too long, and was stopped.',
  },
  /** What passing it on says to the lead, in the person's name. */
  passed: (said: string, text: string) =>
    `${said}:\n\n${text
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`,
}

/**
 * Althar setting up the task's worktree before its lead starts (ADR-023): a
 * line across the thread while it runs, and once it went through. Failed,
 * the end of what it printed shows under it, as a command's output does.
 */
function SetupView({ setup }: { setup: SetupContent }) {
  const { ended } = setup
  const failed = ended !== null && !ended.stopped && ended.code !== 0
  const line =
    ended === null
      ? text.setup.running(setup)
      : ended.stopped
        ? text.setup.stopped(setup)
        : failed
          ? text.setup.failed(setup)
          : text.setup.done(setup)
  return (
    <>
      <ThreadDivider icon="terminal">{line}</ThreadDivider>
      {failed && (
        <Terminal
          command={setup.command}
          lines={ended.last?.split('\n') ?? []}
          {...(ended.code === null ? {} : { exit: ended.code })}
          {...(ended.timedOut ? { failure: text.setup.timedOut } : {})}
        />
      )}
    </>
  )
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
  const long = part.command !== null && (part.command.includes('\n') || part.command.length > LONG_COMMAND || part.label !== undefined)
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
      {...(part.why === undefined ? {} : { why: part.why })}
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

/** A part of a turn as the thread draws it: what it said, a thought, a tool call, its plan, a notice. */
export function PartView({ part, threadId }: { part: Part; threadId: string }) {
  switch (part.kind) {
    case 'message':
      // Its names are read as they were when it was said.
      return (
        <SaidIn.Provider value={part.id}>
          <Markdown source={part.text} />
        </SaidIn.Provider>
      )
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
    case 'pictures':
      return <Gallery shots={shotsOf(part.id, part.pictures)} />
  }
}

/** What the person said, each link that unfurled read as its key where they pasted it; its card, under the words, says the rest. */
function Said({ text, links }: { text: string; links: ReadonlyArray<Unfurl> }) {
  return pastedIn(text, links).map((piece, at) =>
    typeof piece === 'string' ? (
      <Fragment key={at}>{piece}</Fragment>
    ) : (
      <IssueRef key={at} mark={productBrand(piece.product)} id={keyOf(piece)} linear={piece.product === 'linear'} />
    ),
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

/** What happened, in the words between who and where: commented on, Checks passed on. */
export const heardVerb = (arrival: ArrivalContent): string => {
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
}

/** A GitHub Actions log line's time, which every line starts with: noise on a card. */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z /

/**
 * A failed check's log as its card shows it: by its lines, without their
 * times, ending where GitHub Actions marked it failed (`##[error]`), not in
 * the job's cleanup after.
 */
export const logLines = (log: string) => {
  const lines = log
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(STAMP, ''))
  const failed = lines.findLastIndex((line) => line.startsWith('##[error]'))
  return failed === -1 ? lines : lines.slice(0, failed + 1)
}

/**
 * Something heard from outside, as a quoted note: who, what they did, where,
 * and what they said. Failed checks show the end of each one's log, or why
 * it couldn't be read. What someone who can't write to the repository said
 * wasn't passed to the lead, as anyone can comment on a public one; the
 * person reads it, and can pass it on.
 */
function ArrivalView({ arrival, at, onPassOn }: { arrival: ArrivalContent; at: string; onPassOn?: (words: string) => void }) {
  const where =
    arrival.path === null ? arrival.where : `${arrival.where} · ${arrival.path}${arrival.line === null ? '' : `:${arrival.line}`}`
  const verb = heardVerb(arrival)
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
      {arrival.logs.length > 0 && (
        <FailedLogs
          logs={arrival.logs.map((log) => ({
            name: log.name,
            url: log.url,
            lines: log.log === null ? null : logLines(log.log),
            missing: log.missing,
          }))}
        />
      )}
    </Arrived>
  )
}

/**
 * An agent's question, where it asked it: answered here, it says what was said
 * at once, and so it stays once the runtime says so; an answer that didn't go
 * through says why, and keeps what was picked to send again.
 */
function QuestionView({
  question,
  onAnswer,
  focus = false,
}: {
  question: QuestionContent
  onAnswer?: (attentionId: string, answers: Readonly<Record<string, FieldAnswer>>) => Promise<string | null>
  /** The person was brought here to answer it. */
  focus?: boolean
}) {
  const [sent, setSent] = useState<QuestionAnswer | null>(null)
  const [answering, setAnswering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parts = partsOf(question.fields)
  const title = question.fields.length > 1 ? { title: question.message } : {}
  if (question.state === 'withdrawn')
    return <Question parts={parts} {...title} withdrawn={questionText.withdrawn[question.withdrawn ?? 'turn']} />
  const answer = question.answers === null ? sent : pickedOf(question.answers)
  return (
    <Question
      parts={parts}
      {...title}
      focusOnMount={focus}
      answer={question.state === 'answered' ? answer : sent}
      answering={answering}
      {...(error === null ? {} : { error })}
      {...(onAnswer === undefined
        ? {}
        : {
            onAnswer: (picked: QuestionAnswer) => {
              setError(null)
              setAnswering(true)
              void onAnswer(question.attentionId, answersOf(picked)).then((failed) => {
                setAnswering(false)
                if (failed === null) setSent(picked)
                else setError(failed)
              })
            },
          })}
    />
  )
}

export function ThreadBlocks({
  blocks,
  threadId,
  worktree = null,
  openFile,
  session,
  card,
  run,
  draft,
  changes,
  push,
  review,
  automation,
  queued,
  onTryAgain,
  onPassOn,
  onAnswerQuestion,
  focusQuestion,
  project,
}: {
  blocks: ReadonlyArray<Block>
  /** The thread they are of: what a command printed and the documents an agent wrote are read by it. */
  threadId: string
  /** The worktree its paths are under, for the files a turn hands back. */
  worktree?: string | null
  /** Opens a file of the task's in the person's editor; without it, a file has no such button. */
  openFile?: (path: string) => void
  /** The project whose rules let requests through, for the line that says so. */
  project?: string
  /** The thread's session, whose model and account name its turns. */
  session?: { readonly agentId: string; readonly model: string | null; readonly account: string | null } | null
  /** Sends what someone outside said to the lead, in the person's name. */
  onPassOn?: (words: string) => void
  /** Answers an agent's question; what went wrong, in words, or null. Without it, a question can't be answered here. */
  onAnswerQuestion?: (attentionId: string, answers: Readonly<Record<string, FieldAnswer>>) => Promise<string | null>
  /** The question waiting as the thread opened, by its call: the person was brought here to answer it, so it takes focus. */
  focusQuestion?: string
  /** Draws a task's card, in the coordinator's thread. */
  card?: (card: TaskCardContent) => ReactNode
  /** Draws a run's card, in the thread it was asked for in. */
  run?: (run: RunContent) => ReactNode
  /** Draws an issue the coordinator drafted, in its thread. */
  draft?: (draft: IssueDraftContent) => ReactNode
  /** Draws changes to issues, in the thread of whoever proposed them. */
  changes?: (changes: IssueChangesContent) => ReactNode
  /** Draws a push the lead asked for, in a task's thread, with when it was asked or settled. */
  push?: (request: PushRequestContent, at: string) => ReactNode
  /** Draws a review the lead drafted of someone else's pull request, in a review task's thread. */
  review?: (review: ReviewDraftContent) => ReactNode
  /** Draws an automation's card in the coordinator's thread, by its item, which turning it on, undoing and answering it name. */
  automation?: (automation: AutomationCardContent, itemId: string) => ReactNode
  /** What a message still waiting says: who reads it next. */
  queued?: string
  /** Tries the last turn again, where it ended in an error, as on the connection: Try again under it. Without it, none. */
  onTryAgain?: () => void
}) {
  const named = useModelNames()
  // What each document was last changed by, so it is read again after an edit.
  const versionOf = documentVersions(
    blocks.flatMap((block) => (block.kind === 'turn' ? block.parts : [])),
    worktree,
  )
  // A turn of the thread's own agent, on its session's model and account; another's, on its own model.
  const turnModel = (agentId: string | null) =>
    session != null && agentId === session.agentId ? named(agentId, session.model, session.account) : named(agentId)
  // The thread's last turn, where an error ended it: it can be tried again. What the person said in it may wait after it.
  const last = blocks.findLast((block) => block.kind === 'turn' || block.kind === 'waiting')
  const ending = last?.kind === 'turn' && !last.live ? last.said.at(-1) : undefined
  const failed = ending?.kind === 'notice' && ending.tone === 'error' ? last?.id : undefined
  return blocks.map((block) => {
    switch (block.kind) {
      case 'you':
        return (
          <You
            key={block.id}
            data-item={block.id}
            at={block.at}
            delivery={block.delivery}
            {...(queued === undefined ? {} : { text: { queued } })}
            // The images sent with it, each opening full size with the others; then its files and folders, a chip each.
            {...(block.pictures.length + block.files.length === 0
              ? {}
              : { attach: [...sentAttachments(block.pictures), ...fileAttachments(block.files)] })}
            // The links in it that unfurled, in the bubble under the words, so they read as part of what the person said.
            {...(block.links.length === 0 ? {} : { unfurl: block.links.map((link) => <LinkView key={link.url} link={link} />) })}
          >
            {block.links.length === 0 || block.text === '' ? block.text : <Said text={block.text} links={block.links} />}
          </You>
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
        // A step's report is a task's, and its thread draws it in its rounds (TaskThread, ADR-042).
        return null
      case 'card':
        return <Fragment key={block.id}>{card?.(block.card)}</Fragment>
      case 'question':
        return (
          <QuestionView
            key={block.id}
            question={block.question}
            focus={block.question.attentionId === focusQuestion}
            {...(onAnswerQuestion === undefined ? {} : { onAnswer: onAnswerQuestion })}
          />
        )
      case 'run':
        return <Fragment key={block.id}>{run?.(block.run)}</Fragment>
      case 'draft':
        return <Fragment key={block.id}>{draft?.(block.draft)}</Fragment>
      case 'changes':
        return <Fragment key={block.id}>{changes?.(block.changes)}</Fragment>
      case 'setup':
        return <SetupView key={block.id} setup={block.setup} />
      case 'push':
        return <Fragment key={block.id}>{push?.(block.request, block.at)}</Fragment>
      case 'review':
        return <Fragment key={block.id}>{review?.(block.review)}</Fragment>
      case 'automation':
        return <Fragment key={block.id}>{automation?.(block.automation, block.id)}</Fragment>
      case 'waiting':
        return (
          <Turn key={block.id} model={turnModel(session?.agentId ?? null)}>
            <Thinking {...(block.took === null ? {} : { took: block.took })} slow={block.slow} />
          </Turn>
        )
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
            <RuleReceipt parts={block.parts} {...(project === undefined ? {} : { project })} />
            {block.said.map((part) => (
              <PartView key={part.id} part={part} threadId={threadId} />
            ))}
            {block.id === failed && onTryAgain !== undefined && <LinkButton onClick={onTryAgain}>{text.tryAgain}</LinkButton>}
            <HandedBack handed={block.handed} threadId={threadId} versionOf={versionOf} {...(openFile === undefined ? {} : { openFile })} />
          </Turn>
        )
      }
    }
  })
}
