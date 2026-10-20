import { type ComponentProps, Fragment, type ReactNode } from 'react'

import {
  AltharLine,
  Checked,
  Gallery,
  type GalleryShot,
  Issue,
  Markdown,
  Relayed,
  Reviewer,
  Round,
  shotName,
  Thinking,
  Verdict,
  WorkLine,
  WorkNote,
  WorkSaid,
  WorkShots,
} from '@althar/ui'

import { piecesOf } from '../../shared/evidence'
import { handedBy } from '../../shared/handed'
import { HandedBack } from '../../shared/HandedBack'
import { useModelNames } from '../../shared/modelNames'
import { type Round as RoundModel, type RoundBlock, type Said, type WorkStep, withoutShotList } from '../../shared/rounds'
import type { Block, StepResult } from '../../shared/thread'
import { RuleReceipt } from '../../shared/RuleReceipt'
import { SaidIn } from '../../shared/code/CodeHost'
import { productBrand, productName } from '../../shared/products'
import { PartView, text as threadText, ThreadBlocks } from '../../shared/ThreadBlocks'
import s from './TaskThread.module.css'

/*
 * A task's thread in rounds (shared/rounds.ts, ADR-042), as the kit draws
 * them: each ask, then its lead's acknowledgement, the line of its work and
 * its result, with what its report showed; what the coordinator passed on,
 * on the person's side; a reviewer in its own voice; what Althar says. What
 * the person said, what came from outside, questions, runs and the rest are
 * drawn as every thread draws them (ThreadBlocks). Before the lead says
 * anything, its round stands under its name, thinking.
 */

export const text = {
  /** A pull request the task opened, or a branch it pushed, where Althar's report doesn't say. */
  opened: (name: string) => `Opened ${name}.`,
  pushed: 'Pushed the branch.',
}

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

export function TaskThread({ rounds, versionOf, ...shared }: TaskThreadProps) {
  const { threadId, worktree = null, openFile, session, project } = shared
  const named = useModelNames()
  // A turn of the thread's own agent, on its session's model and account; another's, on its own model.
  const modelOf = (agentId: string | null) =>
    session != null && agentId === session.agentId ? named(agentId, session.model, session.account) : named(agentId)
  // The pictures already shown, by their names: a later report's retakes of a view aren't shown again.
  const seen = new Set<string>()

  // What it says, then what it shows and hands back, each a part of the round, spaced as the round spaces them: its own pictures large.
  const said = (one: Said, children?: ReactNode) => (
    <Fragment key={one.id}>
      <SaidIn.Provider value={one.id}>
        <Markdown source={one.text} />
      </SaidIn.Provider>
      <Gallery shots={one.handed.pictures.map((picture) => ({ ...picture, caption: picture.label ?? picture.name }))} />
      {children}
      <HandedBack
        handed={{ ...one.handed, pictures: [] }}
        threadId={threadId}
        versionOf={versionOf}
        {...(openFile === undefined ? {} : { openFile })}
      />
    </Fragment>
  )

  const round = (block: RoundModel) => {
    const work = block.work
    // A round that said nothing is its line alone, with who worked.
    if (block.ack === null && block.result === null && block.report === null && block.failed === null && work !== null && !block.live)
      return (
        <WorkLine key={block.id} who={modelOf(block.agentId)} took={work.took} summary={work.counts}>
          {work.steps.map((step) => (
            <StepView key={step.id} step={step} threadId={threadId} worktree={worktree} />
          ))}
        </WorkLine>
      )
    const report = block.report
    const shown = report === null ? null : shownBy(report)
    const fresh = shown?.shots.filter((shot) => !seen.has(shotName(shot.caption) ?? shot.id)) ?? []
    const retaken = shown?.shots.filter((shot) => !fresh.includes(shot)) ?? []
    for (const shot of shown?.shots ?? []) seen.add(shotName(shot.caption) ?? shot.id)
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
      <Round key={block.id} model={modelOf(block.agentId)} at={block.at} {...(copy === undefined ? {} : { copy })}>
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
        {/* what it handed over along the way, with no result yet to stand with */}
        {block.result === null && (
          <>
            <Gallery shots={block.handed.pictures.map((picture) => ({ ...picture, caption: picture.label ?? picture.name }))} />
            <HandedBack
              handed={{ ...block.handed, pictures: [] }}
              threadId={threadId}
              versionOf={versionOf}
              {...(openFile === undefined ? {} : { openFile })}
            />
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
        {block.failed !== null && <AltharLine tone="warning">{block.failed}</AltharLine>}
      </Round>
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
        return <Relayed key={block.id} title={block.title} body={block.body} />
      case 'althar':
        return (
          <AltharLine key={block.id} tone={block.tone}>
            {block.text}
          </AltharLine>
        )
      case 'verdict':
        return (
          <Round key={block.id} model={named(block.result.agentId)} at={block.at} part="Review">
            <Reviewer
              verdict={block.result.verdict === 'pass' ? Verdict.Pass : Verdict.Changes}
              findings={block.result.findings.map((finding, index) => ({
                id: `${block.id}-${index}`,
                weight: finding.severity,
                ...(finding.file === null ? {} : { at: finding.line === null ? finding.file : `${finding.file}:${finding.line}` }),
                claim: finding.claim,
              }))}
            />
            {block.result.summary !== '' && <Markdown source={block.result.summary} />}
          </Round>
        )
      case 'published': {
        // Althar's own words for it, and the pull request under them, as every thread shows one.
        const change = block.result.change
        const said = block.result.summary.trim()
        return (
          <div key={block.id} className={s.published}>
            <AltharLine>
              {said !== '' ? said : change === null ? text.pushed : text.opened(`${change.short} ${change.prefix}${change.number}`)}
            </AltharLine>
            {change !== null && (
              <Issue
                mark={productBrand(change.product)}
                source={productName(change.product)}
                id={`${change.short} ${change.prefix}${change.number}`}
                title={change.title}
                href={change.url}
                meta={[change.repository, change.draft ? threadText.change.draft : threadText.change[change.state]].join(' · ')}
              />
            )}
          </div>
        )
      }
      default:
        return <ThreadBlocks key={block.id} {...shared} blocks={[block as Block]} />
    }
  })
}
