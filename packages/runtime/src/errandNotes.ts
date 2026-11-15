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
  const release = /\/releases\/tag\/([^/?#\s]+)/.exec(url)
  if (release !== null) return { label: decodeURIComponent(release[1]!), url }
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

/**
 * A sentence's addresses as linked labels: "Opened PR #7 (https://…/pull/7)" keeps its own "#7", linked, and loses the address;
 * any other address becomes its label, or its last part. Each label is a link, so no long address stays in the line.
 */
export const linkProse = (prose: string): { readonly text: string; readonly links: ReadonlyArray<NoteLink> } => {
  const links: Array<NoteLink> = []
  const add = (link: NoteLink) => {
    if (!links.some((one) => one.label === link.label)) links.push(link)
  }
  const URL = /(\s*\()?(https?:\/\/[^\s)]+?)([.,;:]*)(\)|(?=\s|$))/g
  const text = prose.replace(URL, (all, open: string | undefined, url: string, tail: string, close: string) => {
    const label = labelOf(url)
    const wrapped = open !== undefined && close === ')'
    if (label !== null && wrapped && prose.includes(label.label)) {
      add(label)
      return tail
    }
    const last = decodeURIComponent(
      url
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
        .split('/')
        .pop() ?? url,
    )
    const chosen = label ?? { label: last.length > 0 && last.length <= 40 ? last : url.replace(/^https?:\/\//, '').slice(0, 40), url }
    add(chosen)
    return `${wrapped ? `${open}${chosen.label})` : `${open ?? ''}${chosen.label}`}${tail}`
  })
  return { text, links }
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
    const said = answer.trim().replace(/\s+/g, ' ')
    if (said === '') return { title: `${asWords(tool)}: ${shortTarget(at)}: done`, links }
    const short = linkProse(said)
    const all = [...links, ...short.links.filter((one) => !links.some((own) => own.label === one.label))]
    const prose = short.text
    // Where it had addresses, the whole sentence is kept for the fold, addresses and all.
    const whole = short.text === said ? undefined : trimmed(said, DETAILS_MOST)
    if (prose.length <= TITLE_MOST) return { title: prose, links: all, ...(whole === undefined ? {} : { details: whole }) }
    const cut = prose.lastIndexOf(' ', TITLE_MOST)
    const end = cut > TITLE_MOST / 2 ? cut : TITLE_MOST
    return { title: `${prose.slice(0, end).trimEnd()}…`, links: all, details: whole ?? trimmed(said, DETAILS_MOST) }
  }
  const failed = parsed.status !== null && parsed.status >= 400
  const named = phrase(tool, request, link?.label ?? shortTarget(at))
  const status = parsed.status === null ? '' : ` (HTTP ${parsed.status})`
  const title = failed
    ? `${named === undefined ? `${asWords(tool)}: ${shortTarget(at)}` : `Couldn’t do this: ${named.charAt(0).toLowerCase()}${named.slice(1)}`} — failed: ${parsed.message ?? 'the host refused it'}${status}`
    : (named ?? `${asWords(tool)}: ${shortTarget(at)} — done${status}`)
  return { title, links, details: parsed.shown }
}

/**
 * The note for a step that did not go through: what it was, and plainly why. A refusal the host or Althar made proves nothing was
 * done; anything else is not known to have happened or not, and says so.
 */
export const failedNote = (
  tool: string,
  target: string,
  request: Readonly<Record<string, unknown>>,
  message: string,
  uncertain: boolean,
): StepNote => {
  const at = subject(target)
  const link = labelOf(at)
  const named = phrase(tool, request, link?.label ?? shortTarget(at)) ?? `${asWords(tool)} ${shortTarget(at)}`
  const what = `${named.charAt(0).toLowerCase()}${named.slice(1)}`
  const why = message.trim().replace(/\s+/g, ' ')
  const line = uncertain ? `Not sure this went through: ${what} — ${why}` : `Couldn’t do this: ${what} — failed: ${why}`
  const shown = linkProse(line.length > TITLE_MOST ? `${line.slice(0, TITLE_MOST - 1).trimEnd()}…` : line)
  const links = link === null ? shown.links : [link, ...shown.links.filter((one) => one.label !== link.label)]
  return { title: shown.text, links }
}

/** A step as the person reads it: what it does, and what it waits for, in Althar's words where the agent left none. */
export interface SaidStep {
  readonly tool: string
  readonly target: string
  /** The step in a few plain words, as the agent that kept it put it: "Merge the 0.9.0 pull request". */
  readonly says?: string | null | undefined
  /** The tool's arguments, where they name what it acts on (a tag). */
  readonly request?: Readonly<Record<string, unknown>> | undefined
  readonly waits: ReadonlyArray<{ readonly kind: string; readonly says?: string | undefined }>
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`
/** Lower-cased to go mid-sentence, unless it starts with a name or an acronym (PR, GitHub). */
const lower = (text: string) =>
  /^[A-Z][a-z]/.test(text) && !/^[A-Z][a-z]+[A-Z]/.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
const unstop = (text: string) => text.trim().replace(/[.\s]+$/, '')

/** A tag as a release names it, v0.9.0 or 0.9.0, from the tool's arguments or the end of its target. */
const tagOf = (step: SaidStep): string | null => {
  const asked = step.request?.tag
  if (typeof asked === 'string' && asked.trim() !== '') return asked.trim()
  return /(?:^|\s)(v?\d+(?:\.\d+)+(?:[-+][\w.]+)?)$/.exec(step.target.trim())?.[1] ?? null
}

/**
 * A step's words: the agent's own; else what a known tool does to the thing its target names as people do (#958, v0.9.0, DEV-12);
 * else the tool alone. A target with no such name (a branch, owner/repo, task:<slug>) is never said: it means nothing to the person.
 */
export const stepWords = (step: SaidStep): string => {
  const said = unstop(step.says ?? '')
  if (said !== '') return capital(said)
  const label = labelOf(subject(step.target))?.label
  switch (step.tool) {
    case 'merge_pull_request':
      return label === undefined ? 'Merge the pull request' : `Merge ${label}`
    case 'push_tag': {
      const tag = tagOf(step)
      return tag === null ? 'Push the tag' : `Tag ${tag}`
    }
    case 'publish_release': {
      const tag = label ?? tagOf(step)
      return tag === null ? 'Publish the release' : `Publish the ${tag} release`
    }
    case 'approve_release_run': {
      const tag = tagOf(step)
      return tag === null ? 'Approve the release run' : `Approve the ${tag} release run`
    }
    default: {
      const tool = step.tool
        .replace(/^mcp__[^_]+__/, '')
        .replaceAll('_', ' ')
        .trim()
      return capital(label === undefined ? tool : `${tool} ${label}`)
    }
  }
}

/** A wait's clause, to follow "once": the agent's words, else the kind Althar knows, else the kind made plain. */
const waitClause = (wait: SaidStep['waits'][number]): string => {
  const said = unstop(wait.says ?? '')
  if (said !== '') return lower(said.replace(/^(?:once|when|after|until)\s+/i, ''))
  const kind = wait.kind.toLowerCase().replace(/[-\s]+/g, '_')
  if (kind === 'task_pull_request') return 'its pull request is ready'
  if (kind === 'post_merge') return 'the checks after the merge pass'
  if (kind === 'run') return 'its run asks for approval'
  if (kind === 'draft') return 'its draft is ready'
  if (/check/.test(kind)) return 'its checks pass'
  if (/review|approv/.test(kind)) return 'it’s approved'
  if (/merge_(?:queue|train|line|in_flight)/.test(kind)) return 'its turn to merge comes'
  if (/merged/.test(kind)) return 'it’s merged'
  if (/open/.test(kind)) return 'it’s open'
  if (/release|publish/.test(kind)) return 'it’s published'
  return wait.kind.replaceAll('_', ' ').trim()
}

/** What a step waits for, as "once it’s open and its checks pass"; empty where it waits on nothing. */
export const waitsWords = (step: SaidStep): string => {
  const clauses = [...new Set(step.waits.map(waitClause).filter((clause) => clause !== ''))]
  return clauses.length === 0 ? '' : `once ${list(clauses)}`
}

const withWaits = (step: SaidStep, words = stepWords(step)) => {
  const waits = waitsWords(step)
  return waits === '' ? words : `${words} ${waits}`
}

/** Each step's target that has a label, where the line names it. */
const linksIn = (line: string, steps: ReadonlyArray<SaidStep>): ReadonlyArray<NoteLink> => {
  const links: Array<NoteLink> = []
  for (const step of steps) {
    const link = labelOf(subject(step.target))
    if (link !== null && line.includes(link.label) && !links.some((one) => one.label === link.label)) links.push(link)
  }
  return links
}

/** How many steps the kept line names before it counts the rest. */
const NAMED_MOST = 3

/**
 * The line Althar says when it keeps an errand: its steps in plain words, in order, with what the first waits for (each later one
 * waits for the one before). The person's own words and every step with its waits fold under it.
 */
export const keptNote = (words: string, steps: ReadonlyArray<SaidStep>): StepNote => {
  const [first, ...rest] = steps
  if (first === undefined) return { title: 'Kept your errand', links: [] }
  const named = rest.slice(0, NAMED_MOST - 1).map((step) => lower(stepWords(step)))
  const more = rest.length - named.length
  const then = [...named, ...(more > 0 ? [`${more} more ${more === 1 ? 'step' : 'steps'}`] : [])].map((step) => `, then ${step}`).join('')
  const full = `Kept your errand: ${lower(withWaits(first))}${then}`
  const title = full.length <= TITLE_MOST ? full : `${full.slice(0, full.lastIndexOf(' ', TITLE_MOST - 1)).trimEnd()}…`
  const details = [`You said: “${words.trim()}”`, '', ...steps.map((step, at) => `${at + 1}. ${withWaits(step)}`)].join('\n')
  return { title, links: linksIn(title, steps), details: trimmed(details, DETAILS_MOST) }
}

/** A step's note, said where its errand stands after it: the step that comes next, or that the errand is done. */
export const afterStep = (note: StepNote, next: SaidStep | undefined): StepNote => {
  const said = unstop(note.title)
  const title = next === undefined ? `${said}. Errand done` : `${said}. Next: ${lower(stepWords(next))}`
  const links = [
    ...note.links,
    ...linksIn(title, next === undefined ? [] : [next]).filter((one) => !note.links.some((own) => own.label === one.label)),
  ]
  return { ...note, title, links }
}

/** Why an errand is held or called off, to follow a colon: the reason without its stop, lower-cased where it starts a sentence. */
export const why = (reason: string | null, otherwise = 'it waits for your word'): string => lower(unstop(reason ?? '') || otherwise)

/** Where an errand still waits, for its daily reminder: its first step to go and what that waits for, or why it is on hold. */
export const stillNote = (paused: boolean, reason: string | null, step: SaidStep | undefined): StepNote => {
  if (paused) return { title: `Errand still on hold: ${why(reason)}`, links: [] }
  const line = step === undefined ? 'Errand still waits' : `Errand still waits to ${lower(withWaits(step))}`
  return { title: line, links: step === undefined ? [] : linksIn(line, [step]) }
}
