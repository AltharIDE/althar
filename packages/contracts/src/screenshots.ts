import type { Evidence, Picture } from './Api'

/*
 * The screenshots a task's Outputs show as it is now (What it looks like),
 * worked out in one place: the window draws them, and the runtime puts the
 * same ones in a comment on the task's pull request (ADR-077), so what the
 * person sees is what goes there. Each picture is of a view: the one its
 * lead named it by, else the name its caption starts with (A1), else a view
 * of its own. A round that pictures the work again replaces what came
 * before, so pictures that no longer hold drop out rather than pile up: but
 * for the views it names again, which it takes anew, and those it says
 * still hold. A round that only takes known views again keeps the rest. In
 * a change, the options the person chose between, and explorations, never
 * count: they stay in the thread, where the person saw them (ADR-079).
 */

/** A lead's report, as far as its pictures go: what it showed, in order, and the views from before it said still hold. */
export interface PictureReport {
  readonly id: string
  readonly sequence: number
  readonly createdAt: string
  readonly evidence: ReadonlyArray<Evidence>
  readonly keptViews?: ReadonlyArray<string> | undefined
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
 * count, and never an option or exploration; any other task's, a
 * prototype's, its directions too. Each round that pictures it replaces the
 * rounds before, but for the views it takes again or says still hold; one
 * that only takes known views again keeps the rest. Each view once, as last
 * taken, where it was first shown in the round that set it.
 */
export const screenshotsNow = (
  reports: ReadonlyArray<PictureReport>,
  options: { readonly change: boolean; readonly since: string | null },
): ReadonlyArray<ScreenshotNow> => {
  const shown = new Map<string, ScreenshotNow>()
  for (const report of reports.toSorted((one, other) => one.sequence - other.sequence)) {
    if (options.change && options.since !== null && report.createdAt < options.since) continue
    const shots = report.evidence.flatMap((piece, index): ScreenshotNow[] =>
      piece.picture === null || (options.change && piece.option === true)
        ? []
        : [
            {
              key: keyOf(piece) ?? `${report.id}:${index}`,
              id: `${report.id}:${index}`,
              caption: piece.caption,
              picture: piece.picture,
            },
          ],
    )
    const kept = (report.keptViews ?? []).map((view) => view.trim())
    if (shots.length === 0 && kept.length === 0) continue
    // Only views taken again: a follow-up that leaves the others as they were.
    // A view counts by its name, so a before added to a view, or a view's own picture, is a retake too.
    const known = new Set([...shown.keys()].map(viewOfKey))
    const retaken = shots.length > 0 && shots.every((shot) => known.has(viewOfKey(shot.key)))
    // A view kept by name keeps both its picture and its before.
    if (!retaken) for (const key of shown.keys()) if (!kept.includes(viewOfKey(key))) shown.delete(key)
    for (const shot of shots) shown.set(shot.key, shot)
  }
  return [...shown.values()]
}

/** What follows a view's name in the key of its before: `A1` is the view, `A1:before` the picture of it before the change. */
export const BEFORE_SUFFIX = ':before'

/** A view's name from a key, whether it is of the view's picture or of its before. */
export const viewOfKey = (key: string): string => (key.endsWith(BEFORE_SUFFIX) ? key.slice(0, -BEFORE_SUFFIX.length) : key)

/**
 * A picture's view where it has a name: the one its lead gave, else its
 * caption's. A before, which its lead says is of that view, is kept apart
 * from the view's own picture; one with no name to say which view it is the
 * before of is only a picture.
 */
const keyOf = (piece: Evidence): string | null => {
  const given = piece.view?.trim()
  const named = given !== undefined && given !== '' ? given : viewOf(piece.caption)
  return named !== null && piece.before === true ? `${named}${BEFORE_SUFFIX}` : named
}
