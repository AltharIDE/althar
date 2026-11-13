import type { Evidence, GalleryUpdate, Picture } from './Api'

/*
 * A task's visual collection: new handoffs patch views by stable identity.
 * Older reports replay the original selection policy as a migration
 * baseline, so discarded prototype directions do not suddenly reappear.
 * The runtime checkpoints this reducer and serves the same result to the
 * window and PR posting, independently of conversation pagination.
 */

/** A lead's report, as far as its pictures go: what it showed, in order, and the views from before it said still hold. */
export interface PictureReport {
  readonly id: string
  readonly sequence: number
  readonly createdAt: string
  readonly evidence: ReadonlyArray<Evidence>
  readonly keptViews?: ReadonlyArray<string> | undefined
  readonly gallery?: GalleryUpdate | undefined
}

/** A screenshot as it is now: its view, by which it is kept or left out, and the picture last taken of it. */
export interface ScreenshotNow {
  /** Its view: its name where its caption gives one (A1), else its own id. */
  readonly key: string
  /** The report it was shown in, and its place there: `<report id>:<index>`. */
  readonly id: string
  readonly caption: string
  readonly picture: Picture
  /** When the evidence was reported, not a claim about when its bytes were captured. */
  readonly sequence?: number | undefined
  readonly reportedAt?: string | undefined
  readonly needsRefresh?: boolean | undefined
  readonly earlier?: boolean | undefined
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

/** Replays immutable reports in order. `updateScreenshots` also advances a saved checkpoint. */
export const screenshotsNow = (
  reports: ReadonlyArray<PictureReport>,
  options: { readonly change: boolean; readonly since: string | null },
): ReadonlyArray<ScreenshotNow> => {
  let shown: ReadonlyArray<ScreenshotNow> = []
  for (const report of reports.toSorted((one, other) => one.sequence - other.sequence)) shown = updateScreenshots(shown, report, options)
  return shown
}

/** Incremental projection. Legacy reports keep their old selection; new reports explicitly patch it. */
export const updateScreenshots = (
  previous: ReadonlyArray<ScreenshotNow>,
  report: PictureReport,
  options: { readonly change: boolean; readonly since: string | null },
): ReadonlyArray<ScreenshotNow> => {
  const shown = new Map(previous.map((shot) => [shot.key, shot]))
  if (options.change && options.since !== null && report.createdAt < options.since) return previous
  const shots = report.evidence.flatMap((piece, index): ScreenshotNow[] =>
    piece.picture === null || (options.change && piece.option === true)
      ? []
      : [
          {
            key: pictureViewKey(piece) ?? `${report.id}:${index}`,
            id: `${report.id}:${index}`,
            caption: piece.caption,
            picture: piece.picture,
            sequence: report.sequence,
            reportedAt: report.createdAt,
          },
        ],
  )
  const kept = (report.keptViews ?? []).map((view) => view.trim())
  if (report.gallery !== undefined) {
    // A failed capture never takes away a usable earlier one, even in a replacement report.
    const usable = shots.filter((shot) => shot.picture.digest !== null)
    if (report.gallery.mode === 'replace' && (shots.length === 0 || usable.length > 0)) shown.clear()
    for (const view of report.gallery.remove ?? []) for (const key of shown.keys()) if (viewOfKey(key) === view) shown.delete(key)
    for (const view of report.gallery.invalidate ?? [])
      for (const [key, shot] of shown) if (viewOfKey(key) === view) shown.set(key, { ...shot, needsRefresh: true })
    for (const failed of shots.filter((shot) => shot.picture.digest === null)) {
      const earlier = shown.get(failed.key) ?? previous.find((shot) => shot.key === failed.key)
      shown.set(failed.key, { ...(earlier ?? failed), needsRefresh: true })
    }
    for (const shot of usable) shown.set(shot.key, shot)
    return [...shown.values()]
  }
  if (shots.length === 0 && kept.length === 0) return previous
  // Only views taken again: a follow-up that leaves the others as they were.
  // A view counts by its name, so a before added to a view, or a view's own picture, is a retake too.
  const known = new Set([...shown.keys()].map(viewOfKey))
  const retaken = shots.length > 0 && shots.every((shot) => known.has(viewOfKey(shot.key)))
  // A view kept by name keeps both its picture and its before.
  if (!retaken) for (const key of shown.keys()) if (!kept.includes(viewOfKey(key))) shown.delete(key)
  for (const shot of shots) shown.set(shot.key, shot)
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
export const pictureViewKey = (piece: Evidence): string | null => {
  const given = piece.view?.trim()
  const named = given !== undefined && given !== '' ? given : viewOf(piece.caption)
  return named !== null && piece.before === true ? `${named}${BEFORE_SUFFIX}` : named
}

/** Provenance is separate from a view's identity and its caption. */
export const screenshotNote = (shot: ScreenshotNow): string | undefined =>
  shot.needsRefresh ? 'Needs a new capture' : shot.earlier ? 'From an earlier update' : undefined
