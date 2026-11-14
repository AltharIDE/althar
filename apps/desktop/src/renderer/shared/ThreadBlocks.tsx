import { createContext, Fragment, useContext, useState, type ReactNode } from 'react'

import type { FieldAnswer, Unfurl } from '@althar/contracts'
import {
  AltharLine,
  Arrived,
  CodeBlock,
  FailedLogs,
  CanvasLine,
  Gallery,
  glyphOf,
  Issue,
  IssueRef,
  LinkButton,
  Markdown,
  MergeLine,
  Plan,
  Question,
  type QuestionAnswer,
  Reasoning,
  Terminal,
  Thinking,
  NoteDetails,
  ThreadDivider,
  Tool,
  ToolKind,
  ToolState,
  Turn,
  WorkedFor,
  WorkNow,
  You,
  McpAct,
  McpServer,
} from '@althar/ui'

import { CommandOutput } from './CommandOutput'
import { SettingChangeOf } from './SettingChangeOf'
import { shotsOf } from './evidence'
import { HandedBack } from './HandedBack'
import { documentVersions } from './handed'
import { fileAttachments } from './files'
import { sentAttachments } from './images'
import { useModelNames } from './modelNames'
import { FailedTurn } from './WayOut'
import { serverBrand } from './mcpServers'
import { linkedWords } from './noteLinks'
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
  ModelMoveContent,
  SmallChangeContent,
  TaskAskContent,
  QuestionContent,
  RunContent,
  SetupContent,
  StepResult,
  TaskCardContent,
} from './thread'
import { setupStanding } from './thread'
import { ReviewOfferOf } from '../features/team/ReviewOfferOf'
import s from './ThreadBlocks.module.css'
import { duration, lineOf, spentWords } from './turnTime'

/*
 * A thread's blocks as the kit draws them, the same in a task and in the
 * coordinator's thread. A turn's work folds under how long it worked, with
 * its last message open under it; a step's result stands open under the
 * work that led to it. Before the agent says anything, its turn stands
 * under its name, thinking, where its words will take its place. While it
 * works, as in Codex's app (ADR-099): how long it has worked so far, what it
 * said on the way, one line for what it does now, and what it is writing,
 * streaming in at an even pace, where its answer will stand; once the turn
 * ends, the rest folds away under how long it worked. Its thinking shows
 * only in its work, opened. A task's card is the host's to draw, since what
 * it can do with one is the host's.
 */

/** How long a command can be before its row, at the thread's width, clips it. */
const LONG_COMMAND = 72

export const text = {
  /** Under a call the person's own rule refused: what the lead was told, and the way to the rules. */
  refused: (words: string) => `${words} The lead was told so.`,
  rules: 'Rules',
  /** Under a call to a server that was down: what it was, and the way in. */
  server: {
    'needs-auth': (agent: string, server: string) => `${agent} isn’t signed in to ${server}, so this didn’t go through.`,
    failed: (_agent: string, server: string) => `${server} didn’t start, so this didn’t go through.`,
    signIn: 'Sign in',
  },
  readSkill: (names: ReadonlyArray<string>) => `read skill ${names.join(', ')}`,
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
  /** The checks that failed: by name while there are two at most, else how many. */
  failing: (names: ReadonlyArray<string>) => (names.length > 2 ? `${names.length} failed` : `Failed: ${names.join(', ')}`),
  outsider: (from: string) => `Not passed to the lead: ${from} can’t write to the repository.`,
  passOn: 'Pass it on',
  /** Althar setting up a repository's worktree: installing the dependencies its lockfile names, or the setup kept for it. */
  setup: {
    running: (setup: SetupContent) => (setup.kept ? `Setting up ${setup.repository}…` : `Installing dependencies in ${setup.repository}…`),
    done: (setup: SetupContent) => (setup.kept ? `Set up ${setup.repository}` : `Installed dependencies in ${setup.repository}`),
    failed: (setup: SetupContent) =>
      `${setup.kept ? `Couldn’t set up ${setup.repository}` : `Couldn’t install dependencies in ${setup.repository}`}.`,
    stopped: (setup: SetupContent) => `Setting up ${setup.repository} stopped when Althar quit.`,
    /** A recorded setup that ran, but couldn't copy files it names from the person's checkout. */
    missing: (setup: SetupContent, files: ReadonlyArray<string>) => `Couldn’t copy ${files.join(', ')} into ${setup.repository}’s folder.`,
    timedOut: 'Timed out.',
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
  const standing = setupStanding(setup)
  const line = standing === 'missing' ? text.setup.missing(setup, ended?.missing ?? []) : text.setup[standing](setup)
  return (
    <>
      <ThreadDivider icon="terminal">{line}</ThreadDivider>
      {ended !== null && (standing === 'failed' || standing === 'missing') && (
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
 * kept only once opened. Its row shows the command whole once opened, so the
 * output doesn't say it again, unless the row names something else (a label,
 * or the file it works on). One from before Althar kept output, too long for
 * its row, opens to show it whole.
 */
/**
 * What a round's calls to the person's MCP servers did outside, each a card
 * under its work (ADR-097): what acted on the world stands out of what only
 * read, which stays folded in the work.
 */
/** A canvas an agent drew or opened (ADR-104): its line, which opens it beside the conversation. */
export function CanvasOf({ part }: { part: Extract<Part, { kind: 'canvas' }> }) {
  const { canvas } = part
  return (
    <CanvasLine
      data-item={part.id}
      canvas={{ canvasId: canvas.canvasId, name: canvas.name, title: canvas.title, kind: canvas.canvasKind, version: canvas.version }}
      action={canvas.action}
      note={canvas.note}
    />
  )
}

/** The canvases a round drew or opened, each its line, in order. */
export function CanvasLines({ drawn }: { drawn: ReadonlyArray<Extract<Part, { kind: 'canvas' }>> }) {
  return drawn.map((part) => <CanvasOf key={part.id} part={part} />)
}

export function McpActs({ parts }: { parts: ReadonlyArray<Part> }) {
  const acts = parts.flatMap((part) =>
    part.kind === 'tool' && part.mcp?.acts === true && part.state === ToolState.Done ? [{ id: part.id, mcp: part.mcp }] : [],
  )
  return acts.map(({ id, mcp }) => (
    <McpAct key={id} server={mcp.server} brand={serverBrand(mcp.server)} did={mcp.did} words={mcp.words} link={mcp.link} />
  ))
}

/** Where Althar's lines under a call lead: the project's rules, an agent's sign-in. The host that can open them provides it. */
export interface ThreadWays {
  readonly onRules?: () => void
  readonly onSignIn?: (agentId: string) => void
}
export const ThreadWaysContext = createContext<ThreadWays>({})

const AGENT_NAMES: Readonly<Record<string, string>> = { 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

/** A server's name as a person says it: the first letter capital, "linear-server" as "Linear". */
const serverName = (name: string) => {
  const word = name.replace(/[-_](server|mcp)$/i, '').replace(/^(mcp)[-_]/i, '')
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function ToolView({ part, threadId }: { part: Extract<Part, { kind: 'tool' }>; threadId: string }) {
  const [open, setOpen] = useState(part.state === ToolState.Running && part.ran !== null)
  /* once opened, what it printed stays, so it doesn't vanish as the call folds */
  const [seen, setSeen] = useState(open)
  /* the row names something other than the command, so the command is said under it */
  const named = part.command !== null && part.target !== part.command
  const long = part.command !== null && (part.command.includes('\n') || part.command.length > LONG_COMMAND)
  const body =
    part.ran !== null ? (
      seen ? (
        <CommandOutput
          threadId={threadId}
          itemId={part.id}
          ran={part.ran}
          exit={part.exit}
          {...(named && part.command !== null ? { command: part.command } : {})}
          {...(part.command !== null ? { printedBy: part.command } : {})}
        />
      ) : (
        <></>
      )
    ) : named && part.command !== null ? (
      <CodeBlock code={part.command} lang={text.shell} />
    ) : long ? (
      <></>
    ) : undefined
  const ways = useContext(ThreadWaysContext)
  const tool = (
    <Tool
      kind={part.toolKind}
      verb={part.verb}
      target={part.target}
      state={part.state}
      {...(part.toolKind === ToolKind.Run && part.skills !== undefined ? { meta: text.readSkill(part.skills.names) } : {})}
      {...(part.mcp === undefined ? {} : { meta: <McpServer name={part.mcp.server} brand={serverBrand(part.mcp.server)} /> })}
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
  if (part.refused === undefined && part.server === undefined) return tool
  const { server } = part
  return (
    <>
      {tool}
      {part.refused !== undefined && (
        <AltharLine>
          {text.refused(part.refused)} {ways.onRules && <LinkButton onClick={ways.onRules}>{text.rules}</LinkButton>}
        </AltharLine>
      )}
      {server !== undefined && (
        <AltharLine tone="warning">
          {text.server[server.down](AGENT_NAMES[server.agentId ?? ''] ?? 'The agent', serverName(server.name))}{' '}
          {server.down === 'needs-auth' && server.agentId !== undefined && ways.onSignIn && (
            <LinkButton onClick={() => ways.onSignIn?.(server.agentId ?? '')}>{text.server.signIn}</LinkButton>
          )}
        </AltharLine>
      )}
    </>
  )
}

/** A part of a turn as the thread draws it: what it said, a thought, a tool call, its plan, a notice. */
export function PartView({ part, threadId }: { part: Part; threadId: string }) {
  switch (part.kind) {
    case 'message':
      // Its names are read as they were when it was said.
      return (
        <SaidIn.Provider value={part.id}>
          <Markdown source={part.text} streaming={part.live === true} />
        </SaidIn.Provider>
      )
    case 'thought':
      return (
        <SaidIn.Provider value={part.id}>
          <Reasoning source={part.text} live={part.live === true} {...(part.took == null ? {} : { took: part.took })} />
        </SaidIn.Provider>
      )
    case 'tool':
      return <ToolView part={part} threadId={threadId} />
    case 'plan':
      return <Plan steps={part.steps} />
    case 'notice':
      // A review a lead offered: its line asks, with its buttons, and says what came of it once answered.
      if (part.offer?.kind === 'review') return <ReviewOfferOf offer={part.offer} ask={part.text} />
      // A turn that failed reads as a problem; the thread's last one has its ways out beside it (ThreadBlocks, TaskThread).
      if (part.tone === 'error') return <FailedTurn text={part.text} detail={part.detail} failure={part.failure} />
      return (
        <>
          <p className={s[part.tone]}>{part.text}</p>
          {part.detail !== undefined && <p className={s.detail}>{part.detail}</p>}
        </>
      )
    case 'pictures':
      return <Gallery shots={shotsOf(part.id, part.pictures)} />
    case 'canvas':
      return <CanvasOf part={part} />
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
function ArrivalView({
  arrival,
  at,
  count,
  onPassOn,
  'data-item': item,
}: {
  'data-item': string
  arrival: ArrivalContent
  at: string
  count: number
  onPassOn?: (words: string) => void
}) {
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
      count={count}
      data-item={item}
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
  taskAsk,
  smallChange,
  modelMove,
  queued,
  retryable,
  onTryAgain,
  onSignIn,
  onCompact,
  onPassOn,
  onAnswerQuestion,
  focusQuestion,
  project,
  signed,
  undoable,
  onUndoFrom,
}: {
  blocks: ReadonlyArray<Block>
  undoable?: ReadonlyArray<string> | undefined
  onUndoFrom?: ((itemId: string) => void) | undefined
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
  /** Who signs its turns in place of their model, with its mark: the coordinator, in its conversation and in its asides. */
  signed?: { readonly voice: string; readonly mark: ReactNode }
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
  /** Draws the coordinator's card asking to stop, hold, restart or settle a task, by its item, which answering it names. */
  taskAsk?: (ask: TaskAskContent, itemId: string) => ReactNode
  /** Draws a small change's card, by its item, which Merge and Make it a full task name. */
  smallChange?: (card: SmallChangeContent, itemId: string) => ReactNode
  /** Draws Auto's line on moving the lead to a lighter model, by its item, which Keep and Undo name. */
  modelMove?: (move: ModelMoveContent, itemId: string) => ReactNode
  /** What a message still waiting says: who reads it next. */
  queued?: string
  /** The runtime's retry eligibility, refreshed with the thread's head. */
  retryable?: boolean | undefined
  /** Tries the last turn again, where it ended in an error, as on the connection: Try again under it. Without it, none. */
  onTryAgain?: () => void
  /** Opens Settings at an agent's sign-in, where the last turn failed for it being signed out: Sign in again. Without it, none. */
  onSignIn?: (agentId: string) => void
  /** Has the thread's agent compact its context, where the last turn failed for it being full: Compact. Without it, none. */
  onCompact?: () => void
}) {
  const named = useModelNames()
  // What each document was last changed by, so it is read again after an edit.
  const versionOf = documentVersions(
    blocks.flatMap((block) => (block.kind === 'turn' ? block.parts : [])),
    worktree,
  )
  // A turn on the model it ran on, where the runtime recorded it; an older one, on the thread's current session, as
  // before; another agent's, on its own model.
  const turnModel = (agentId: string | null, model: string | null = null) =>
    agentId !== null && model !== null
      ? named(agentId, model)
      : session != null && agentId === session.agentId
        ? named(agentId, session.model, session.account)
        : named(agentId)
  // Signed, the turns say who speaks rather than which model.
  const speaker = (agentId: string | null, model: string | null = null) =>
    signed === undefined ? { model: turnModel(agentId, model) } : { voice: signed.voice, mark: signed.mark }
  // The thread's last turn, where an error ended it: it can be tried again. What the person said in it may wait after it.
  const last = blocks.findLast((block) => block.kind === 'turn' || block.kind === 'waiting')
  const ending = last?.kind === 'turn' && !last.live ? last.said.at(-1) : undefined
  const failed = ending?.kind === 'notice' && ending.tone === 'error' ? last?.id : undefined
  // Signing in again the agent whose turn it was: the thread's own, where the turn doesn't say.
  const signInAs = (agentId: string | null) => {
    const who = agentId ?? session?.agentId ?? null
    return onSignIn === undefined || who === null ? undefined : () => onSignIn(who)
  }
  return blocks.map((block) => {
    switch (block.kind) {
      case 'you':
        return (
          <You
            key={block.id}
            data-item={block.id}
            at={block.at}
            delivery={block.delivery}
            {...(onUndoFrom === undefined || !undoable?.includes(block.id) ? {} : { onUndo: () => onUndoFrom(block.id) })}
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
        return (
          <ArrivalView
            key={block.id}
            data-item={block.id}
            arrival={block.arrival}
            at={block.at}
            count={block.count}
            {...(onPassOn === undefined ? {} : { onPassOn })}
          />
        )
      case 'divider':
        return (
          <div key={block.id} className={s.note}>
            <ThreadDivider icon="agents">{linkedWords(block.text, block.links)}</ThreadDivider>
            {block.details !== undefined && <NoteDetails>{block.details}</NoteDetails>}
          </div>
        )
      case 'offer':
        return (
          <div key={block.id} className={s.offer}>
            <ReviewOfferOf offer={block.offer} ask={block.text} />
          </div>
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
      case 'task_ask':
        return <Fragment key={block.id}>{taskAsk?.(block.ask, block.id)}</Fragment>
      case 'small_change':
        return <Fragment key={block.id}>{smallChange?.(block.card, block.id)}</Fragment>
      case 'model_move':
        return <Fragment key={block.id}>{modelMove?.(block.move, block.id)}</Fragment>
      case 'merge_line':
        return <MergeLine key={block.id} rows={block.line.rows} branch={block.line.branch} />
      case 'setting':
        return <SettingChangeOf key={block.id} change={block.change} itemId={block.id} />
      case 'waiting':
        return (
          <Turn key={block.id} {...speaker(session?.agentId ?? null)}>
            <Thinking {...(block.took === null ? {} : { took: block.took })} slow={block.slow} />
          </Turn>
        )
      case 'turn': {
        // What Copy takes: what it said, open under its work.
        const said = block.said.flatMap((part) => (part.kind === 'message' && part.text.trim() !== '' ? [part.text] : [])).join('\n\n')
        // At work, what it said on the way so far, as it said it; once it answers, that folds with the rest of its work.
        const working = block.live && !block.answering
        const onTheWay = working ? block.work.flatMap((part) => (part.kind === 'message' && part.text.trim() !== '' ? [part] : [])) : []
        const doing = block.doing
        const workTime = block.spent === null ? null : { ...block.spent, total: block.spent.work, place: 0, session: 0 }
        return (
          <Turn
            key={block.id}
            {...speaker(block.agentId, block.model)}
            at={block.at}
            {...(said === '' || block.live ? {} : { copy: said })}
            // Every message it shows, so a search can bring the person to the one it found.
            data-items={block.parts.flatMap((part) => (part.kind === 'message' ? [part.id] : [])).join(' ')}
          >
            {block.work.length > 0 && (
              <WorkedFor
                took={workTime === null ? block.took : duration(workTime.work)}
                {...(block.spent === null ? {} : { spent: spentWords(block.spent) })}
                {...(workTime === null || lineOf(workTime) === undefined ? {} : { most: lineOf(workTime) })}
                live={working}
                {...(onTheWay.length === 0
                  ? {}
                  : {
                      said: onTheWay.map((part) => (
                        <SaidIn.Provider key={part.id} value={part.id}>
                          <Markdown source={part.text} />
                        </SaidIn.Provider>
                      )),
                    })}
                {...(doing === null
                  ? {}
                  : { now: <WorkNow {...(doing.tool === null ? {} : { icon: glyphOf(doing.tool) })}>{doing.text}</WorkNow> })}
              >
                {block.work.map((part) => (
                  <PartView key={part.id} part={part} threadId={threadId} />
                ))}
              </WorkedFor>
            )}
            <RuleReceipt parts={block.parts} {...(project === undefined ? {} : { project })} />
            {block.said.map((part) =>
              // The thread's last turn, where it failed: the problem with its ways out beside it.
              block.id === failed && part === ending && ending.kind === 'notice' ? (
                <FailedTurn
                  key={part.id}
                  text={ending.text}
                  detail={ending.detail}
                  failure={ending.failure}
                  onTryAgain={retryable === true ? onTryAgain : undefined}
                  onSignIn={signInAs(block.agentId)}
                  onCompact={onCompact}
                />
              ) : (
                <PartView key={part.id} part={part} threadId={threadId} />
              ),
            )}
            <HandedBack handed={block.handed} threadId={threadId} versionOf={versionOf} {...(openFile === undefined ? {} : { openFile })} />
          </Turn>
        )
      }
    }
  })
}
