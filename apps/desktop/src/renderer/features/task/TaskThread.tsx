import { type ComponentProps, Fragment, memo, type ReactNode, useCallback, useLayoutEffect, useRef } from 'react'

import {
  AltharLine,
  Checked,
  Gallery,
  type GalleryShot,
  Markdown,
  Relayed,
  Round,
  shotName,
  Thinking,
  ThreadDivider,
  WorkLine,
  WorkNote,
  WorkSaid,
  WorkShots,
  type ModelInfo,
} from '@althar/ui'

import { piecesOf, shotsOf } from '../../shared/evidence'
import { handedBy } from '../../shared/handed'
import { HandedBack } from '../../shared/HandedBack'
import { useModelNames } from '../../shared/modelNames'
import { type Round as RoundModel, type RoundBlock, type Said, type Shown, type WorkStep, withoutShotList } from '../../shared/rounds'
import type { Block, StepResult } from '../../shared/thread'
import { RuleReceipt } from '../../shared/RuleReceipt'
import { SaidIn } from '../../shared/code/CodeHost'
import { PartView, ThreadBlocks } from '../../shared/ThreadBlocks'
import { WayOut } from '../../shared/WayOut'
import { PublishedReport, ReviewReport } from './Reports'
import s from './TaskThread.module.css'

/*
 * A task's thread in rounds (shared/rounds.ts, ADR-042), as the kit draws
 * them: each ask, then its lead's acknowledgement, the line of its work and
 * its result, with what its report showed; what the coordinator passed on,
 * on the person's side; a reviewer in its own voice; what Althar says. What
 * the person said, what came from outside, questions, runs and the rest are
 * drawn as every thread draws them (ThreadBlocks). Before the lead says
 * anything, its round stands under its name, thinking. What started a
 * round, and what a step reported, carry their item's id (`data-item`), so
 * the Graph face can take the person to them.
 *
 * A round, and what the person said, redraws only when what it shows
 * changed: typing, the lead's words streaming in and the ticking clock
 * redraw the round they are in, not the whole history before it.
 */

type Shared = Omit<ComponentProps<typeof ThreadBlocks>, 'blocks' | 'card' | 'queued'>

export interface TaskThreadProps extends Shared {
  readonly rounds: ReadonlyArray<RoundBlock>
  /** What each document was last changed by, so one handed back is read again after an edit (documentVersions). */
  readonly versionOf: (whole: string) => string
}

/** One step of a round's work, in its sheet. */
function StepView({ step, threadId, worktree }: { step: WorkStep; threadId: string; worktree: string | null }) {
  switch (step.kind) {
    case 'message':
      return <WorkSaid source={step.text} />
    case 'aside':
      return <WorkNote>{step.text}</WorkNote>
    case 'tool':
      return (
        <>
          <PartView part={step} threadId={threadId} />
          {/* what it looked at as it worked: small, under the step that read it, never with what it says */}
          <WorkShots shots={handedBy([{ id: step.id, pictures: step.pictures, files: [] }], worktree).pictures} />
        </>
      )
    default:
      return <PartView part={step} threadId={threadId} />
  }
}

/** What a report showed, as pictures to see large, and runs and notes as what it checked. */
const shownBy = (report: { readonly id: string; readonly result: StepResult }) => {
  const pieces = piecesOf(report.id, report.result.evidence)
  const shots = pieces.flatMap((piece): GalleryShot[] =>
    piece.form === 'picture' ? [{ ...piece.shot, id: piece.id, caption: piece.caption }] : [],
  )
  return { shots, pieces, unverified: report.result.unverified ?? [] }
}

/** Whether two things a round is drawn from are the same, value by value. */
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const one = a as Record<string, unknown>
  const other = b as Record<string, unknown>
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => Object.hasOwn(other, key) && same(one[key], other[key]))
}

/** The documents a round hands back, by their whole path. */
const documentsOf = (block: RoundModel) =>
  [block.ack?.handed, block.result?.handed, block.handed].flatMap((handed) => handed?.documents.map((file) => file.whole) ?? [])

/** The names a report's pictures go by: one taken again later is the same view. */
const shotNames = (report: RoundModel['report']) =>
  report === null ? [] : shownBy(report).shots.map((shot) => shotName(shot.caption) ?? shot.id)

interface RoundProps {
  readonly block: RoundModel
  readonly model: ModelInfo
  /** The names of its pictures an earlier round showed already: shown small, as retakes. */
  readonly retakes: ReadonlyArray<string>
  /** What each document it hands back was last changed by. */
  readonly versions: Readonly<Record<string, string>>
  readonly threadId: string
  readonly worktree: string | null
  readonly project: string | undefined
  readonly openFile: ((path: string) => void) | undefined
  /** The ways out of the error it ended with, where it is the thread's last: Try again, and the agent to sign in again. */
  readonly out: { readonly again: boolean; readonly compact: boolean; readonly signIn: string | null } | null
  readonly onTryAgain: () => void
  readonly onCompact: () => void
  readonly onSignIn: (agentId: string) => void
}

/** One round: its ask's acknowledgement, the line of its work, and its result, with what its report showed. */
const RoundView = memo(function RoundView({
  block,
  model,
  retakes,
  versions,
  threadId,
  worktree,
  project,
  openFile,
  out,
  onTryAgain,
  onCompact,
  onSignIn,
}: RoundProps) {
  const versionOf = (whole: string) => versions[whole] ?? ''
  const opens = openFile === undefined ? {} : { openFile }

  // What it says, then what it shows and hands back, each a part of the round, spaced as the round spaces them: its own pictures large.
  const said = (one: Said, children?: ReactNode) => (
    <Fragment key={one.id}>
      <SaidIn.Provider value={one.id}>
        <Markdown source={one.text} />
      </SaidIn.Provider>
      <Gallery shots={one.handed.pictures.map((picture) => ({ ...picture, caption: picture.label ?? picture.name }))} />
      {children}
      <HandedBack handed={{ ...one.handed, pictures: [] }} threadId={threadId} versionOf={versionOf} {...opens} />
    </Fragment>
  )

  // Pictures it showed the person, each set where it showed it.
  const pictures = (sets: ReadonlyArray<Shown>) =>
    sets.map((shown) => <Gallery key={shown.id} data-item={shown.id} shots={shotsOf(shown.id, shown.pictures)} />)

  const work = block.work
  // A round that said nothing is its line alone, with who worked.
  if (
    block.ack === null &&
    block.result === null &&
    block.report === null &&
    block.failed === null &&
    block.shown.before.length === 0 &&
    work !== null &&
    !block.live
  )
    return (
      <WorkLine who={model} took={work.took} summary={work.counts}>
        {work.steps.map((step) => (
          <StepView key={step.id} step={step} threadId={threadId} worktree={worktree} />
        ))}
      </WorkLine>
    )
  const report = block.report
  const shown = report === null ? null : shownBy(report)
  const before = new Set(retakes)
  const fresh = shown?.shots.filter((shot) => !before.has(shotName(shot.caption) ?? shot.id)) ?? []
  const retaken = shown?.shots.filter((shot) => !fresh.includes(shot)) ?? []
  const names = new Set(fresh.flatMap((shot) => shotName(shot.caption) ?? []))
  const showing = shown !== null && (
    <>
      <Gallery shots={fresh} retaken={retaken} />
      <Checked pieces={shown.pieces} unverified={shown.unverified} />
    </>
  )
  // What Copy takes: what it said last, else first.
  const copy = block.live ? undefined : (block.result ?? block.ack)?.text
  return (
    <Round model={model} at={block.at} {...(copy === undefined ? {} : { copy })} {...(report === null ? {} : { 'data-item': report.id })}>
      {block.ack !== null && said(block.ack)}
      {work !== null && (
        <WorkLine
          took={work.took}
          live={work.live}
          {...(work.live ? (work.now === null ? {} : { summary: work.now }) : { summary: work.counts })}
        >
          {work.steps.length === 0
            ? undefined
            : work.steps.map((step) => <StepView key={step.id} step={step} threadId={threadId} worktree={worktree} />)}
        </WorkLine>
      )}
      <RuleReceipt parts={block.parts} {...(project === undefined ? {} : { project })} />
      {pictures(block.shown.before)}
      {/* what it handed over along the way, with no result yet to stand with */}
      {block.result === null && (
        <>
          <Gallery shots={block.handed.pictures.map((picture) => ({ ...picture, caption: picture.label ?? picture.name }))} />
          <HandedBack handed={{ ...block.handed, pictures: [] }} threadId={threadId} versionOf={versionOf} {...opens} />
        </>
      )}
      {block.result !== null
        ? said({ ...block.result, text: withoutShotList(block.result.text, names) }, showing)
        : report !== null && (
            <>
              <Markdown source={report.result.built ?? report.result.summary} />
              {showing}
            </>
          )}
      {pictures(block.shown.after)}
      {block.failed !== null && (
        <>
          <AltharLine tone="warning">{block.failed.text}</AltharLine>
          {block.failed.detail !== undefined && <p className={s.detail}>{block.failed.detail}</p>}
          {out !== null && (
            <WayOut
              failure={block.failed.failure}
              {...(out.again ? { onTryAgain } : {})}
              {...(out.compact ? { onCompact } : {})}
              {...(out.signIn === null ? {} : { onSignIn: () => onSignIn(out.signIn ?? '') })}
            />
          )}
        </>
      )}
    </Round>
  )
}, same)

/** What the person said, which draws from nothing but itself. */
const YouView = memo(
  function YouView({ block, threadId }: { block: Block; threadId: string }) {
    return <ThreadBlocks threadId={threadId} blocks={[block]} />
  },
  (before, after) => before.threadId === after.threadId && same(before.block, after.block),
)

export function TaskThread({ rounds, versionOf, ...shared }: TaskThreadProps) {
  const { threadId, worktree = null, openFile, session, project, onTryAgain, onCompact, onSignIn } = shared
  const named = useModelNames()
  // A turn of the thread's own agent, on its session's model and account; another's, on its own model.
  const modelOf = (agentId: string | null) =>
    session != null && agentId === session.agentId ? named(agentId, session.model, session.account) : named(agentId)
  // Opening a file goes through one function that stays, so a round drawn before opens it as the person now does.
  const opening = useRef(openFile)
  useLayoutEffect(() => {
    opening.current = openFile
  })
  const open = useCallback((path: string) => opening.current?.(path), [])
  // So do a failed round's ways out.
  const acting = useRef({ onTryAgain, onCompact, onSignIn })
  useLayoutEffect(() => {
    acting.current = { onTryAgain, onCompact, onSignIn }
  })
  const tryAgain = useCallback(() => acting.current.onTryAgain?.(), [])
  const compact = useCallback(() => acting.current.onCompact?.(), [])
  const signIn = useCallback((agentId: string) => acting.current.onSignIn?.(agentId), [])
  // The thread's last round, where an error ended it, has its ways out.
  const last = rounds.findLast((block) => block.kind === 'round' || block.kind === 'waiting')
  const outOf = (block: RoundModel) =>
    block !== last || block.failed === null
      ? null
      : {
          again: onTryAgain !== undefined,
          compact: onCompact !== undefined,
          signIn: onSignIn === undefined ? null : (block.agentId ?? session?.agentId ?? null),
        }
  // The pictures already shown, by their names: a later report's retakes of a view aren't shown again.
  const seen = new Set<string>()

  const round = (block: RoundModel) => {
    const names = shotNames(block.report)
    const retakes = names.filter((name) => seen.has(name))
    for (const name of names) seen.add(name)
    return (
      <RoundView
        key={block.id}
        block={block}
        model={modelOf(block.agentId)}
        retakes={retakes}
        versions={Object.fromEntries(documentsOf(block).map((whole) => [whole, versionOf(whole)]))}
        threadId={threadId}
        worktree={worktree}
        project={project}
        openFile={openFile === undefined ? undefined : open}
        out={outOf(block)}
        onTryAgain={tryAgain}
        onCompact={compact}
        onSignIn={signIn}
      />
    )
  }

  return rounds.map((block) => {
    switch (block.kind) {
      case 'round':
        return round(block)
      case 'waiting':
        return (
          <Round key={block.id} model={modelOf(session?.agentId ?? null)}>
            <Thinking {...(block.took === null ? {} : { took: block.took })} slow={block.slow} />
          </Round>
        )
      case 'relayed':
        return <Relayed key={block.id} title={block.title} body={block.body} data-item={block.id} />
      case 'althar':
        return (
          <AltharLine key={block.id} tone={block.tone}>
            {block.text}
          </AltharLine>
        )
      case 'folder':
        return (
          <ThreadDivider key={block.id} icon="folder">
            {block.text}
          </ThreadDivider>
        )
      case 'verdict':
        return (
          <Round key={block.id} model={named(block.result.agentId)} at={block.at} part="Review" data-item={block.id}>
            <ReviewReport id={block.id} result={block.result} />
          </Round>
        )
      case 'published':
        // Althar's own words for it, and the pull request under them, as every thread shows one.
        return (
          <div key={block.id} className={s.published} data-item={block.id}>
            <PublishedReport result={block.result} />
          </div>
        )
      case 'you':
        return <YouView key={block.id} block={block} threadId={threadId} />
      default:
        return <ThreadBlocks key={block.id} {...shared} blocks={[block as Block]} />
    }
  })
}
