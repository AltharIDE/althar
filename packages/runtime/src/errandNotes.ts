/**
 * The note an errand's step leaves in a thread: one short line in words, its links as their labels, and the host's raw
 * answer, where there is one, kept apart to be folded under "Details". The person's own words are on the errand, not here.
 */

export interface NoteLink {
  readonly label: string
  readonly url: string
}

export interface StepNote {
  readonly title: string
  /** Each label in the title that is a link, with where it goes. */
  readonly links: ReadonlyArray<NoteLink>
  /** The raw answer, pretty-printed and cut: shown folded, never in the line. */
  readonly details?: string
}

/** How much of a raw answer is kept for the fold. */
export const DETAILS_MOST = 4000
/** The longest line a prose answer may be before the rest moves into the fold. */
export const TITLE_MOST = 240

const trimmed = (text: string, most: number): string =>
  text.length <= most ? text : `${text.slice(0, most).trimEnd()}\n… (${text.length - most} more characters cut)`

/** A change, issue or comment as people say it: #698, !12, DEV-145. Nothing where the address doesn't say. */
export const labelOf = (target: string): NoteLink | null => {
  const url = /^https?:\/\/\S+/.exec(target)?.[0]
  if (url === undefined) return null
  const pull = /\/(?:pull|issues|pull-requests)\/(\d+)/.exec(url)
  if (pull !== null) return { label: `#${pull[1]}`, url }
  const request = /\/merge_requests\/(\d+)/.exec(url)
  if (request !== null) return { label: `!${request[1]}`, url }
  const key = /\/(?:issue|browse)\/([A-Z][A-Z0-9]*-\d+)/.exec(url)
  if (key !== null) return { label: key[1]!, url }
  return null
}

const asWords = (tool: string) => tool.replaceAll('_', ' ')

/** What a target is, short: its label where it has one, else its last part, else the target cut. */
const shortTarget = (target: string): string => {
  const label = labelOf(target)
  if (label !== null) return label.label
  const rest = /^https?:\/\//.test(target) ? target.replace(/^https?:\/\/(?:www\.)?/, '') : target.slice(target.indexOf(':') + 1)
  return rest.length <= 48 ? rest : `${rest.slice(0, 47)}…`
}

const list = (names: ReadonlyArray<string>): string =>
  names.length > 3
    ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
    : names.length < 2
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

const strings = (value: unknown): Array<string> =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

interface Parsed {
  readonly status: number | null
  readonly shown: string
  readonly message: string | null
}

/** A host's answer as the tools keep it: its status and body as JSON. Anything else is prose. */
const parse = (answer: string): Parsed | null => {
  let value: unknown
  try {
    value = JSON.parse(answer)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object') return null
  const status = 'status' in value && typeof value.status === 'number' ? value.status : null
  const body: unknown = 'body' in value ? value.body : undefined
  let message: string | null = null
  if (body !== null && typeof body === 'object') {
    const found: unknown = 'message' in body ? body.message : 'error' in body ? body.error : undefined
    if (typeof found === 'string') message = found
    else if ('errors' in body && Array.isArray(body.errors)) {
      const first: unknown = body.errors[0]
      if (typeof first === 'string') message = first
      else if (first !== null && typeof first === 'object' && 'message' in first && typeof first.message === 'string')
        message = first.message
    }
  }
  return { status, shown: trimmed(JSON.stringify(value, null, 2), DETAILS_MOST), message }
}

/** The line a known tool gets, from what it was asked: undefined where the tool has no phrase of its own. */
const phrase = (tool: string, request: Readonly<Record<string, unknown>>, at: string): string | undefined => {
  switch (tool) {
    case 'request_pull_request_reviewers': {
      const names = [...strings(request.reviewers), ...strings(request.teams)]
      return names.length === 0 ? `Asked for a review of ${at}` : `Asked ${list(names)} to review ${at}`
    }
    case 'resolve_review_thread':
      return request.resolved === false ? `Reopened a review thread on ${at}` : `Resolved a review thread on ${at}`
    case 'mark_pull_request_draft':
      return `Marked ${at} as a draft`
    case 'merge_pull_request':
      return `Merged ${at}`
    case 'post_review': {
      const verdict = typeof request.verdict === 'string' ? request.verdict.toLowerCase() : ''
      return verdict.includes('approve')
        ? `Approved ${at}`
        : verdict.includes('change')
          ? `Asked for changes on ${at}`
          : `Posted a review on ${at}`
    }
    case 'change_issue_relation':
      return `Changed a relation on ${at}`
    case 'upload_issue_attachment':
      return `Attached a file to ${at}`
    case 'edit_issue_comment':
      return `Edited a comment on ${at}`
    case 'reply_to_issue_comment':
      return `Replied to a comment on ${at}`
    default:
      return undefined
  }
}

/** The target as the line names it: the part before " thread …" or " comment …", which the phrase says itself. */
const subject = (target: string): string => target.split(/ (?:thread|comment) /)[0]!

/**
 * One step's note. `answer` is what the tool gave back: a host's JSON, or a sentence Althar wrote (a merge in the queue, a
 * release step), which is the line as it is, cut where it is long.
 */
export const stepNote = (tool: string, target: string, request: Readonly<Record<string, unknown>>, answer: string): StepNote => {
  const at = subject(target)
  const link = labelOf(at)
  const links = link === null ? [] : [link]
  const parsed = parse(answer)
  if (parsed === null) {
    const prose = answer.trim().replace(/\s+/g, ' ')
    if (prose === '') return { title: `${asWords(tool)}: ${shortTarget(at)}: done`, links }
    if (prose.length <= TITLE_MOST) return { title: prose, links }
    const cut = prose.lastIndexOf(' ', TITLE_MOST)
    const end = cut > TITLE_MOST / 2 ? cut : TITLE_MOST
    return { title: `${prose.slice(0, end).trimEnd()}…`, links, details: trimmed(prose, DETAILS_MOST) }
  }
  const failed = parsed.status !== null && parsed.status >= 400
  const named = phrase(tool, request, link?.label ?? shortTarget(at))
  const status = parsed.status === null ? '' : ` (HTTP ${parsed.status})`
  const title = failed
    ? `${named === undefined ? `${asWords(tool)}: ${shortTarget(at)}` : `Couldn’t do this: ${named.charAt(0).toLowerCase()}${named.slice(1)}`} — failed: ${parsed.message ?? 'the host refused it'}${status}`
    : (named ?? `${asWords(tool)}: ${shortTarget(at)} — done${status}`)
  return { title, links, details: parsed.shown }
}
