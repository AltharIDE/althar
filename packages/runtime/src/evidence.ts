import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Evidence } from '@althar/contracts'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { inside, keepPicture, type HandedPlace, type KeptPicture, PICTURE_KEPT, picturesOf } from './handed'
import { ToolRefused } from './ToolServer'

/*
 * What a lead shows of its work when it finishes a step: evidence that the
 * change does what it should, in whatever form fits the task (a screenshot,
 * a command and what it printed, a test run, a response, a log, a note), each
 * with a caption saying what it shows; and what it couldn't show, as
 * unverified. A screenshot is a picture file in the task's worktree, kept in
 * the artifact store as a picture an agent hands back is (handed.ts); the
 * file itself stays where it is, and needn't be committed.
 */

export const EVIDENCE_KINDS = ['screenshot', 'recording', 'command', 'test_run', 'response', 'log', 'note'] as const
type Kind = (typeof EVIDENCE_KINDS)[number]

/** Kinds shown as a picture. */
const PICTURED: ReadonlyArray<Kind> = ['screenshot', 'recording']

/** How much of a command's output, or a text, is kept: its end, cut at a line. */
export const EVIDENCE_TEXT_KEPT = 12_000
/** How many pieces of evidence a step keeps. */
export const EVIDENCE_MOST = 24

export const EvidenceGiven = Schema.Struct({
  kind: Schema.Literals(EVIDENCE_KINDS),
  caption: Schema.String,
  path: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  exit_code: Schema.optional(Schema.Int),
  output: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
})
export type EvidenceGiven = typeof EvidenceGiven.Type

/** A piece of evidence as a step result keeps it. */
export interface KeptEvidence {
  readonly kind: Kind
  readonly caption: string
  readonly picture: KeptPicture | null
  /** The picture's path, from the worktree it's in, and that worktree: so it isn't counted as left uncommitted, or changed. */
  readonly path: string | null
  readonly worktree: string | null
  readonly command: string | null
  readonly exit: number | null
  readonly text: string | null
  /** Lines from the start of the text that weren't kept. */
  readonly dropped: number
}

/** A picture evidence names, found and read, before it is kept. */
interface Found {
  /** Its bytes; null for one too large to keep. */
  readonly bytes: Uint8Array | null
  readonly size: number
  readonly name: string
  /** Where it is, from the worktree it's in: so it needn't be committed. */
  readonly worktree: string
  readonly file: string
}

/** A text's end, up to EVIDENCE_TEXT_KEPT characters, from a line; and how many lines before it went. */
export const textKept = (whole: string): { readonly text: string; readonly dropped: number } => {
  if (whole.length <= EVIDENCE_TEXT_KEPT) return { text: whole, dropped: 0 }
  let from = whole.length - EVIDENCE_TEXT_KEPT
  const line = whole.indexOf('\n', from)
  if (line !== -1 && line + 1 < whole.length) from = line + 1
  return { text: whole.slice(from), dropped: whole.slice(0, from).split('\n').length - 1 }
}

const refuse = (message: string) => new ToolRefused({ message })

const PICTURE_NAME = /\.(png|jpe?g|gif|webp)$/i

/** Reads the picture a piece of evidence names, from inside the task's worktrees, or refuses it with what to do. */
const findPicture = (path: string, worktrees: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const [first] = worktrees
    if (first === undefined) return yield* refuse('Althar keeps a screenshot only from the task’s worktree, and this has none.')
    const named = isAbsolute(path) ? path : resolve(first, path)
    const real = yield* inside(named, worktrees)
    if (real === null)
      return yield* refuse(`Althar couldn’t find ${path} in the task’s worktree. Save the picture there, and name it from the worktree.`)
    if (!PICTURE_NAME.test(real))
      return yield* refuse(
        `${path} isn’t a picture Althar shows: a PNG, JPEG, GIF or WebP. A recording is kept as a GIF; otherwise describe it in a note.`,
      )
    const found = yield* Effect.promise(() => stat(real).catch(() => null))
    if (found === null || !found.isFile()) return yield* refuse(`${path} isn’t a file.`)
    const bytes = found.size > PICTURE_KEPT ? null : yield* Effect.promise(() => readFile(real).then((read) => new Uint8Array(read)))
    // Which worktree it's in, as the task names it, and where in it.
    let at = { worktree: first, file: real }
    for (const root of worktrees) {
      const realRoot = yield* inside(root, [root])
      if (realRoot !== null && real.startsWith(`${realRoot}${sep}`)) {
        at = { worktree: root, file: relative(realRoot, real) }
        break
      }
    }
    return { bytes, size: found.size, name: basename(real), ...at } satisfies Found
  })

/**
 * Reads the evidence a lead gave, refusing what can't be kept with what to
 * do about it: a caption is needed, a screenshot names a picture in the
 * worktree, a command says what it ran. Pictures are read now and kept
 * later, once the step is taken.
 */
export const readEvidence = (given: ReadonlyArray<EvidenceGiven>, worktrees: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (given.length > EVIDENCE_MOST)
      return yield* refuse(`That's ${given.length} pieces of evidence; Althar keeps up to ${EVIDENCE_MOST}. Keep what shows the most.`)
    const read: Array<{ readonly given: EvidenceGiven; readonly found: Found | null }> = []
    for (const [index, piece] of given.entries()) {
      const which = `Evidence ${index + 1}`
      if (piece.caption.trim() === '') return yield* refuse(`${which} needs a caption: a line on what it shows.`)
      if (PICTURED.includes(piece.kind)) {
        if (piece.path === undefined || piece.path.trim() === '')
          return yield* refuse(`${which} is a ${piece.kind}: give the picture’s path in the worktree, in \`path\`.`)
        read.push({ given: piece, found: yield* findPicture(piece.path.trim(), worktrees) })
        continue
      }
      // A run is what ran and how it went; a response or a log, what it said. A claim without them is a note, or unverified.
      if (
        (piece.kind === 'command' || piece.kind === 'test_run') &&
        (piece.command === undefined || piece.command.trim() === '' || piece.exit_code === undefined || piece.output === undefined)
      )
        return yield* refuse(
          `${which} is a ${piece.kind === 'command' ? 'command' : 'test run'}: give what you ran in \`command\`, its \`exit_code\`, and what it printed in \`output\` (the part that shows the result; empty if it printed nothing). What you didn't run belongs in \`unverified\`.`,
        )
      if ((piece.kind === 'response' || piece.kind === 'log') && (piece.text ?? piece.output ?? '').trim() === '')
        return yield* refuse(`${which} is a ${piece.kind}: give what it said, in \`text\`.`)
      read.push({ given: piece, found: null })
    }
    return read
  })

/** The files evidence names, by worktree: left out of what must be committed. */
export const evidenceFiles = (read: ReadonlyArray<{ readonly found: Found | null }>) =>
  read.flatMap((piece) => (piece.found === null ? [] : [{ worktree: piece.found.worktree, file: piece.found.file }]))

/**
 * The pictures a task's lead handed as evidence, by their paths in their
 * worktrees: not committed, they are left out of what the task changed and
 * of what it left uncommitted.
 */
export const evidencePaths = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ path: string; worktree: string | null }>`
      SELECT DISTINCT json_extract(e.value, '$.path') AS path, json_extract(e.value, '$.worktree') AS worktree
      FROM thread_items i JOIN threads t ON t.id = i.thread_id AND t.kind = 'task', json_each(i.content, '$.evidence') e
      WHERE t.task_id = ${taskId} AND i.kind = 'step_result' AND json_extract(e.value, '$.path') IS NOT NULL`
    /** Whether a file, by its path in a worktree, is a picture handed as evidence from that worktree. */
    return (worktree: string, file: string) => rows.some((row) => row.path === file && (row.worktree === null || row.worktree === worktree))
  })

/** Keeps evidence read: its pictures in the artifact store, for the item they belong to; its texts to their ends. */
export const keepEvidence = (place: HandedPlace, read: ReadonlyArray<{ readonly given: EvidenceGiven; readonly found: Found | null }>) =>
  Effect.forEach(read, ({ given, found }) =>
    Effect.gen(function* () {
      const said = given.output ?? given.text
      const kept = said === undefined || said.trim() === '' ? null : textKept(said)
      const picture =
        found === null
          ? null
          : found.bytes === null
            ? ({
                artifactId: null,
                sha256: null,
                mediaType: '',
                bytes: found.size,
                width: null,
                height: null,
                name: found.name,
                why: 'too_large',
              } satisfies KeptPicture)
            : yield* keepPicture(place, found.bytes, '', found.name)
      return {
        kind: given.kind,
        caption: given.caption.trim(),
        picture,
        path: found?.file ?? null,
        worktree: found?.worktree ?? null,
        command: given.command?.trim() || null,
        exit: given.exit_code ?? null,
        text: kept?.text ?? null,
        dropped: kept?.dropped ?? 0,
      } satisfies KeptEvidence
    }),
  )

/** What couldn't be shown, as the lead said it: each line once, none empty. */
export const unverifiedOf = (given: ReadonlyArray<string>) => [...new Set(given.map((line) => line.trim()).filter((line) => line !== ''))]

/* ---- As the contract has it ---- */

const recordIn = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** The evidence a step result keeps, as a screen shows it. */
export const evidenceOf = (value: unknown): ReadonlyArray<Evidence> =>
  (Array.isArray(value) ? value : []).flatMap((entry) => {
    const piece = recordIn(entry)
    const kind = EVIDENCE_KINDS.find((known) => known === piece.kind)
    const caption = stringOrNull(piece.caption)
    if (kind === undefined || caption === null) return []
    const [picture] = picturesOf(piece.picture === null || piece.picture === undefined ? [] : [piece.picture])
    return [
      {
        kind,
        caption,
        picture: picture ?? null,
        command: stringOrNull(piece.command),
        exit: typeof piece.exit === 'number' ? piece.exit : null,
        text: stringOrNull(piece.text),
        dropped: typeof piece.dropped === 'number' ? piece.dropped : 0,
      },
    ]
  })

/** What a step result says couldn't be shown; null where it didn't say, so what an earlier step said stands. */
export const unverifiedIn = (value: unknown): ReadonlyArray<string> | null =>
  Array.isArray(value) ? value.flatMap((line) => (typeof line === 'string' && line !== '' ? [line] : [])) : null

/**
 * What a task's lead showed across its steps, in order, and what it last said
 * it couldn't show: a step that says nothing of it leaves the last list
 * standing, and one that says none clears it.
 */
export const taskShown = (threadId: string, since: string | null = null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // Since a time, where only what came after counts: a task's next pull request is described from its own work (ADR-034).
    const rows = yield* sql<{ content: string }>`
      SELECT content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
        AND json_extract(content, '$.step') IN ('implement', 'settle') AND (${since} IS NULL OR created_at > ${since})
      ORDER BY sequence`
    const reported = rows.map((row) => recordIn(JSON.parse(row.content)))
    return {
      evidence: reported.flatMap((report) => evidenceOf(report.evidence)),
      unverified: reported.map((report) => unverifiedIn(report.unverified)).findLast((list) => list !== null) ?? [],
    }
  })

const KIND_WORDS: Readonly<Record<Kind, string>> = {
  screenshot: 'screenshot',
  recording: 'recording',
  command: 'command',
  test_run: 'test run',
  response: 'response',
  log: 'log',
  note: 'note',
}

/** A file name from what a lead called a picture: its last part, in letters a file name takes. */
const fileName = (name: string) => basename(name).replace(/[^\w.-]+/g, '-') || 'picture'

/**
 * The lead's evidence for its reviewer, who reads a copy of the work where a
 * screenshot the lead left uncommitted, or kept out by git, isn't: each
 * picture from the store, and each output whole as it was kept, written to
 * `folder` (made again each time), and in words, with where each is.
 */
export const evidenceForReview = (taskThreadId: string, folder: string) =>
  Effect.gen(function* () {
    const artifacts = yield* Artifacts
    const { evidence, unverified } = yield* taskShown(taskThreadId)
    yield* Effect.promise(() => rm(folder, { recursive: true, force: true }))
    if (evidence.length > 0) yield* Effect.promise(() => mkdir(folder, { recursive: true }))
    const lines: Array<string> = []
    for (const [index, piece] of evidence.entries()) {
      const n = index + 1
      const ran = piece.command === null ? '' : ` (\`${piece.command}\`${piece.exit === null ? '' : `, exit ${piece.exit}`})`
      let at = ''
      const digest = piece.picture?.digest ?? null
      const bytes = digest === null ? null : yield* artifacts.read(digest)
      if (bytes !== null) {
        const path = join(folder, `${n}-${fileName(piece.picture?.name ?? 'screenshot.png')}`)
        yield* Effect.promise(() => writeFile(path, bytes))
        at = `: ${path}`
      } else if (piece.text !== null) {
        const path = join(folder, `${n}-${piece.kind}.txt`)
        const whole = [
          ...(piece.command === null ? [] : [`$ ${piece.command}`]),
          ...(piece.dropped === 0 ? [] : [`(${piece.dropped} earlier lines weren't kept)`]),
          piece.text,
          ...(piece.exit === null ? [] : [`(exit ${piece.exit})`]),
        ].join('\n')
        yield* Effect.promise(() => writeFile(path, whole))
        at = `: ${path}`
      } else if (piece.picture !== null) at = ' (not kept)'
      lines.push(`- ${KIND_WORDS[piece.kind]}: ${piece.caption}${ran}${at}`)
    }
    return [
      lines.length === 0
        ? 'The lead handed no evidence.'
        : `The lead's evidence, each picture and output where you can read it:\n${lines.join('\n')}`,
      unverified.length === 0
        ? "It lists nothing it couldn't show."
        : `What it says it couldn't show:\n${unverified.map((line) => `- ${line}`).join('\n')}`,
    ].join('\n\n')
  })
