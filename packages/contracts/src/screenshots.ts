import type { Evidence, Picture } from './Api'

/*
 * The screenshots a task's Outputs show as it is now (What it looks like),
 * worked out in one place: the window draws them, and the runtime puts the
 * same ones in a comment on the task's pull request (ADR-077), so what the
 * person sees is what goes there. A view taken again shows once, where it
 * was last taken: a view is a picture's name, A1, from its caption, and a
 * picture with no name is a view of its own.
 */

/** A lead's report, as far as its pictures go: what it showed, in order. */
export interface PictureReport {
  readonly id: string
  readonly sequence: number
  readonly createdAt: string
  readonly evidence: ReadonlyArray<Evidence>
}

/** A screenshot as it is now: its view, by which it is kept or left out, and the picture last taken of it. */
export interface ScreenshotNow {
  /** Its view: its name where its caption gives one (A1), else its own id. */
  readonly key: string
  /** The report it was shown in, and its place there: `<report id>:<index>`. */
  readonly id: string
  readonly caption: string
  readonly picture: Picture
}

/** "A1 · One quiet line: the first message lands", or "T1 Today: …": a picture's name, where its caption starts with one. */
const NAMED = /^([A-Z])(\d*)/
const SPACE = /\s/

/** A picture's name, from its caption, where it has one: A1, Z. A later picture of the same name is the same view taken again. */
export const viewOf = (caption: string): string | null => {
  const found = NAMED.exec(caption)
  if (found === null) return null
  const end = found[0].length
  let separator = end
  while (separator < caption.length && SPACE.test(caption.charAt(separator))) separator++
  // The old trailing .+ also accepts whitespace: leave at least one character
  // after punctuation, or after the first whitespace of a numbered name.
  if (
    ((caption[separator] === '·' || caption[separator] === ':') && separator + 1 < caption.length) ||
    (found[2] !== '' && separator > end && end + 1 < caption.length)
  )
    return found[0]
  return null
}

/**
 * The screenshots as the task is now, from its lead's reports: a change's
 * since it became one (`since`), so a prototype's rounds before don't
 * count; any other task's from its last report that showed one. Each view
 * once, as last taken, in the order the reports showed them.
 */
export const screenshotsNow = (
  reports: ReadonlyArray<PictureReport>,
  options: { readonly change: boolean; readonly since: string | null },
): ReadonlyArray<ScreenshotNow> => {
  const rounds = reports
    .toSorted((one, other) => one.sequence - other.sequence)
    .map((report) => ({
      at: report.createdAt,
      shots: report.evidence.flatMap((piece, index): ScreenshotNow[] =>
        piece.picture === null
          ? []
          : [
              {
                key: viewOf(piece.caption) ?? `${report.id}:${index}`,
                id: `${report.id}:${index}`,
                caption: piece.caption,
                picture: piece.picture,
              },
            ],
      ),
    }))
  const lastShown = rounds.findLastIndex((round) => round.shots.length > 0)
  const now = options.change
    ? rounds.filter((round) => options.since === null || round.at >= options.since)
    : lastShown === -1
      ? []
      : rounds.slice(lastShown)
  const latest = new Map<string, string>()
  for (const round of now) for (const shot of round.shots) latest.set(shot.key, shot.id)
  return now.flatMap((round) => round.shots.filter((shot) => latest.get(shot.key) === shot.id))
}
