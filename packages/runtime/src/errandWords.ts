/**
 * What a task's card says of its open errands, in a few plain words
 * (DEV board cards): built from what Althar knows of each, its tool, its
 * waits and the pull request it acts on, never the record's own text. A
 * merge the person asked for reads "In the merge queue" or "Merges once
 * checks pass"; a wait the card's pull request chip and checks already say
 * reads nothing. Free text that still reaches the card, a tool or a wait
 * an agent named, is made plain: addresses become their
 * short form (#773) or go, "owner/repo branch" goes, and it keeps to one
 * short line, cut between words.
 *
 * The lead's own prompt keeps the full record (`errandLines`): this is the
 * person's.
 */

/** One open or paused errand's waiting step, as its records keep it. */
export interface ErrandRecord {
  readonly tool: string
  readonly target: string
  readonly paused: boolean
  readonly waits: ReadonlyArray<{ readonly kind: string; readonly target: string }>
}

/** What the card already shows of a pull request: its chip names it, its foot says its checks. */
export interface CardChange {
  readonly url: string
  readonly short: string
  readonly state: 'open' | 'merged' | 'closed'
  readonly queued?: boolean | undefined
  readonly checks: { readonly outcome: 'none' | 'running' | 'passed' | 'failed' } | null
}

/** The longest an errand's line runs, so it stays on one line of a card. */
export const LINE_MOST = 48

const QUEUES = new Set(['merge_queue', 'merge_train', 'merge_line', 'merge_in_flight'])
const MERGE_TOOL = 'merge_pull_request'

/** A pull request's or issue's number from its address, in its host's words: GitLab's merge requests are !, the rest #. */
const shortOfUrl = (url: string): string | null => {
  const merge = /\/-\/merge_requests\/(\d+)/.exec(url)
  if (merge !== null) return `!${merge[1]}`
  const numbered = /\/(?:pull|pulls|pull-requests|issues|-\/issues)\/(\d+)/.exec(url)
  return numbered === null ? null : `#${numbered[1]}`
}

const URL = /\bhttps?:\/\/[^\s)>\]]+/g
/** "AltharIDE/althar main": a repository's owner and name with the branch after it, which says nothing the card doesn't. */
const REPO_BRANCH = /(?<![\w./-])([\w-]+(?:\.[\w-]+)*)\/([\w-]+(?:\.[\w-]+)*)\s+([\w./-]*[\w-])(?![\w./-])/g
/** A file's path rather than a repository's: its name has an extension. */
const FILE = /\.[a-z]{1,5}$/i
/** A commit's hash, long or short, which means nothing to the person on a card: hex with a digit in it. */
const SHA = /\b(?:at\s+)?([0-9a-f]{7,40})\b/g

/** Cut to `most` characters between words, with an ellipsis where anything went. */
export const oneLine = (text: string, most = LINE_MOST): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= most) return flat
  const cut = flat.slice(0, most)
  const space = cut.lastIndexOf(' ')
  const kept = (space > most / 3 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')
  return `${kept}…`
}

/**
 * Free text made fit for a card: each address its short form (#773) or
 * gone, "owner/repo branch" and commit hashes gone, tool names in words,
 * on one line cut between words. Empty where nothing is left.
 */
export const plainText = (text: string, most = LINE_MOST): string => {
  const words = text
    .replace(URL, (url) => {
      const trimmed = url.replace(/[.,;:]+$/, '')
      const short = shortOfUrl(trimmed)
      return `${short ?? ''}${url.slice(trimmed.length)}`
    })
    .replace(REPO_BRANCH, (whole, _owner: string, name: string) => (FILE.test(name) ? whole : ''))
    .replace(SHA, (whole, hash: string) => (/\d/.test(hash) ? '' : whole))
    .replace(/\b([a-z]+)_([a-z_]+)\b/g, (whole) => whole.replaceAll('_', ' '))
    // What the cuts left: a colon or comma with nothing before it, doubled ones, empty brackets.
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/^[\s,;:.–—-]+/, '')
    .replace(/[\s,;:–—-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (words === '' || /^[.…]+$/.test(words)) return ''
  return oneLine(`${words.charAt(0).toUpperCase()}${words.slice(1)}`, most)
}

/** A wait's kind in words, where Althar knows it; else the kind made plain. */
const waitWords = (kind: string): string => {
  switch (kind) {
    case 'checks':
      return 'checks'
    case 'review':
    case 'approval':
      return 'a review'
    case 'merge_queue':
      return 'the merge queue'
    case 'merge_train':
      return 'the merge train'
    case 'merge_line':
    case 'merge_in_flight':
      return 'its turn to merge'
    default:
      return plainText(kind.replaceAll('_', ' ')).toLowerCase()
  }
}

/** A tool's name as words to start a line with: publish_release → Publish release. */
const toolWords = (tool: string): string => {
  const words = tool
    .replace(/^mcp__[^_]+__/, '')
    .replaceAll('_', ' ')
    .trim()
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()

/** A merge the person asked for, as its pull request stands. */
const mergeLine = (errand: ErrandRecord, change: CardChange | undefined, named: string, queueShown: boolean): string | null => {
  const way = errand.waits.find((wait) => QUEUES.has(wait.kind))?.kind
  const of = named === '' ? '' : ` ${named}`
  if (errand.paused) return `Merge${of} on hold`
  if (change !== undefined && change.state !== 'open') return null
  if (change?.queued === true && queueShown) return null
  if (change?.queued === true)
    return way === 'merge_train' ? `In the merge train${of === '' ? '' : `:${of}`}` : `In the merge queue${of === '' ? '' : `:${of}`}`
  if (way === 'merge_in_flight') return `Merges${of} after the merge ahead`
  const outcome = change?.checks?.outcome
  if (outcome === 'passed' || outcome === 'none')
    return way === 'merge_line' || way === undefined
      ? `Waiting its turn to merge${of}`
      : `Going into the ${way === 'merge_train' ? 'merge train' : 'merge queue'}${of === '' ? '' : `:${of}`}`
  return `Merges${of} once checks pass`
}

/**
 * The card's line for each errand, from its records and the pull request the
 * card shows: nothing where it would only say what the chip and its checks
 * say, and never the same line twice. `queueShown` where the card's own word
 * says its pull request is in the merge queue already, as for one whose
 * steps are done (the window's `asMerging`).
 */
export const errandCardLines = (
  errands: ReadonlyArray<ErrandRecord>,
  change: CardChange | null,
  { queueShown = false }: { readonly queueShown?: boolean } = {},
): ReadonlyArray<string> => {
  const lines = errands.flatMap((errand): ReadonlyArray<string> => {
    const ours = change !== null && sameUrl(errand.target, change.url)
    // Its own pull request goes unnamed, as the chip names it; another is named short, #773, and any other target not at all.
    const named = ours ? '' : (shortOfUrl(errand.target) ?? '')
    const found = ours ? change : undefined
    if (errand.tool === MERGE_TOOL) {
      const line = mergeLine(errand, found, named, queueShown)
      return line === null ? [] : [line]
    }
    const tool = toolWords(errand.tool)
    const what = named === '' ? tool : `${tool} ${named}`
    if (errand.paused) return [plainText(`${what} on hold`)]
    const waits = [...new Set(errand.waits.map((wait) => waitWords(wait.kind)).filter((words) => words !== ''))]
    return [
      plainText(
        waits.length === 0
          ? `${what} next`
          : waits.length === 1 && waits[0] === 'checks'
            ? `${what} once checks pass`
            : `${what} waits for ${waits.join(' and ')}`,
      ),
    ]
  })
  return [...new Set(lines.filter((line) => line !== ''))]
}
