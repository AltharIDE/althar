import type { Evidence, ThreadItem } from '@althar/contracts'
import { type EvidencePiece, EvidenceKind, unreachable } from '@althar/ui'

import { pictureUrl } from '../../main/pictureAddress'
import { bytesText, linesOf, text as handedText } from './handed'

/*
 * What a lead showed of its change working, as the kit's Evidence draws it
 * (the lead's finish_step): a screenshot by its digest, as a picture an
 * agent hands back is shown; a command, a test run, a response or a log as
 * what it printed, its end first; a note as it was said. A task's finished
 * view is what its lead last said it built, then all its lead's steps
 * showed, in order, with what it last said it couldn't show.
 */

const kindOf = (kind: Evidence['kind']): EvidenceKind => {
  switch (kind) {
    case 'screenshot':
      return EvidenceKind.Screenshot
    case 'recording':
      return EvidenceKind.Recording
    case 'command':
      return EvidenceKind.Command
    case 'test_run':
      return EvidenceKind.TestRun
    case 'response':
      return EvidenceKind.Response
    case 'log':
      return EvidenceKind.Log
    case 'note':
      return EvidenceKind.Note
    default:
      return unreachable(kind)
  }
}

/** One piece, as the kit draws it, by an id of its item and place. */
export const pieceOf = (evidence: Evidence, id: string): EvidencePiece => {
  const base = { id, kind: kindOf(evidence.kind), caption: evidence.caption }
  const { picture } = evidence
  if (picture !== null) {
    const facts = [
      ...(picture.width === null || picture.height === null ? [] : [handedText.size(picture.width, picture.height)]),
      bytesText(picture.bytes),
    ]
    return {
      ...base,
      form: 'picture',
      shot: {
        name: picture.name ?? evidence.caption,
        alt: evidence.caption,
        ...(picture.digest === null
          ? { status: 'failed' as const, meta: handedText.unkept[picture.unkept ?? 'unkept'] }
          : { src: pictureUrl(picture.digest), thumb: pictureUrl(picture.digest, true), meta: facts.join(' · ') }),
        ...(picture.width === null ? {} : { width: picture.width }),
        ...(picture.height === null ? {} : { height: picture.height }),
      },
    }
  }
  // What ran, or what was printed or answered, opens to it; a note is said as it is.
  if (evidence.command !== null || (evidence.kind !== 'note' && evidence.text !== null)) {
    const { lines, earlier } = linesOf(evidence.text ?? '')
    return {
      ...base,
      form: 'output',
      lines: [...lines],
      ...(earlier.length === 0 ? {} : { earlier: [...earlier] }),
      ...(evidence.dropped === 0 ? {} : { omitted: evidence.dropped }),
      ...(evidence.command === null ? {} : { command: evidence.command }),
      ...(evidence.exit === null ? {} : { exit: evidence.exit }),
    }
  }
  return { ...base, form: 'note', ...(evidence.text === null ? {} : { text: evidence.text }) }
}

/** A step result's evidence, as the kit draws it. */
export const piecesOf = (itemId: string, evidence: ReadonlyArray<Evidence>): EvidencePiece[] =>
  evidence.map((piece, index) => pieceOf(piece, `${itemId}:${index}`))

/**
 * A task's finished view, as its pull request says it: what its lead last
 * said it built (a step that changed the work says it again), what each of
 * its lead's steps showed, in order, and what it last said it couldn't show.
 */
export const taskEvidence = (
  items: ReadonlyArray<ThreadItem>,
): { readonly built: string | null; readonly pieces: EvidencePiece[]; readonly unverified: string[] } => {
  const lead = items.flatMap((item) =>
    item.kind === 'step_result' && (item.content.step === 'implement' || item.content.step === 'settle') ? [item] : [],
  )
  return {
    built: lead.findLast((item) => item.content.built !== null)?.content.built ?? null,
    pieces: lead.flatMap((item) => piecesOf(item.id, item.content.evidence)),
    // The last list it said, even empty: what an earlier step couldn't show, a later one may have.
    unverified: [...(lead.findLast((item) => item.content.unverified !== null)?.content.unverified ?? [])],
  }
}
