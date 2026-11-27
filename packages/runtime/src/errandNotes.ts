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
  /** The errand's step, where it was one: its own words say what was tried. */
  step?: SaidStep,
): StepNote => {
  const at = subject(target)
  const link = labelOf(at)
  const named = phrase(tool, request, link?.label ?? shortTarget(at)) ?? `${asWords(tool)} ${shortTarget(at)}`
  const what = step === undefined ? `${named.charAt(0).toLowerCase()}${named.slice(1)}` : lower(stepWords(step))
  const whole = message.trim().replace(/\s+/g, ' ')
  // What the host or Althar said to the agent (a tool, an order) stays out of the line, and folds under Details whole.
  const plain = forThePerson(whole)
  const why = plain === '' ? (uncertain ? 'it is not known whether it happened' : 'it did not go through') : plain
  const line = uncertain ? `Not sure this went through: ${what} — ${why}` : `Couldn’t do this: ${what} — failed: ${why}`
  const shown = linkProse(line.length > TITLE_MOST ? `${line.slice(0, TITLE_MOST - 1).trimEnd()}…` : line)
  const links = link === null ? shown.links : [link, ...shown.links.filter((one) => one.label !== link.label)]
  return { title: shown.text, links, ...(plain === whole ? {} : { details: trimmed(whole, DETAILS_MOST) }) }
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

/** A wait's clause, to follow "once": the agent's words, else the kind Althar knows; nothing where it is neither. */
const knownClause = (wait: SaidStep['waits'][number]): string | null => {
  const said = unstop(wait.says ?? '')
  if (said !== '') return lower(said.replace(/^(?:once|when|after|until)\s+/i, ''))
  const kind = wait.kind.toLowerCase().replace(/[-\s]+/g, '_')
  if (kind === 'task_pull_request') return 'its pull request is ready'
  if (kind === 'review_settled') return 'its review is settled'
  if (kind === 'lead_done') return 'its lead finishes'
  if (kind === 'post_merge') return 'the checks after the merge pass'
  if (kind === 'run') return 'its run asks for approval'
  if (kind === 'draft') return 'its draft is ready'
  if (/check/.test(kind)) return 'its checks pass'
  if (/review|approv/.test(kind)) return 'it’s approved'
  if (/merge_(?:queue|train|line|in_flight)/.test(kind)) return 'its turn to merge comes'
  if (/merged/.test(kind)) return 'it’s merged'
  if (/open/.test(kind)) return 'it’s open'
  if (/release|publish/.test(kind)) return 'it’s published'
  return null
}

/** A wait's clause, to follow "once": the agent's words, else the kind Althar knows, else the kind made plain. */
const waitClause = (wait: SaidStep['waits'][number]): string => knownClause(wait) ?? wait.kind.replaceAll('_', ' ').trim()

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

/** One merge an errand still has to make: its pull request as people say it (#1224), or its task's name while it has none. */
export interface MergeLeft {
  readonly label: string
  readonly url: string | null
  /** Its task, where it has one: what tells it from another merge of the same name until its pull request is known. */
  readonly task: string | null
  /** What it waits for, as "once its checks pass"; empty where it waits on nothing. */
  readonly once: string
}

/**
 * What an errand that only merges still has to merge, in order; null for an errand that does anything else, whose lines
 * stand as they are. A step with no pull request to name goes by its task's name, else its own words.
 */
export const mergesLeft = (
  steps: ReadonlyArray<{
    readonly step: SaidStep
    readonly done: boolean
    readonly task: { readonly id: string; readonly title: string | null } | null
  }>,
): ReadonlyArray<MergeLeft> | null => {
  if (steps.length === 0 || steps.some(({ step }) => step.tool !== 'merge_pull_request')) return null
  return steps
    .filter(({ done }) => !done)
    .map(({ step, task }) => {
      const link = labelOf(subject(step.target))
      const label = link?.label ?? task?.title ?? stepWords(step).replace(/^Merge\s+(?:the\s+)?/i, '')
      return { label, url: link?.url ?? null, task: task?.id ?? null, once: waitsWords(step) }
    })
}

/** How many steps the kept line names before it counts the rest. */
const NAMED_MOST = 3

/** Steps in order as one phrase: the first (with its waits, where asked), then the next two, then a count of the rest. */
const inOrder = (steps: ReadonlyArray<SaidStep>, waits: boolean): string => {
  const [first, ...rest] = steps
  if (first === undefined) return ''
  const named = rest.slice(0, NAMED_MOST - 1).map((step) => lower(stepWords(step)))
  const more = rest.length - named.length
  const then = [...named, ...(more > 0 ? [`${more} more ${more === 1 ? 'step' : 'steps'}`] : [])].map((step) => `, then ${step}`).join('')
  return `${lower(waits ? withWaits(first) : stepWords(first))}${then}`
}

/** A line cut to the longest a line may be, at a word, with an ellipsis. */
const fit = (line: string, most = TITLE_MOST): string =>
  line.length <= most ? line : `${line.slice(0, Math.max(line.lastIndexOf(' ', most - 1), most / 2)).trimEnd()}…`

/**
 * The line Althar says when it keeps an errand: its steps in plain words, in order, with what the first waits for (each later one
 * waits for the one before). The person's own words and every step with its waits fold under it.
 */
export const keptNote = (words: string, steps: ReadonlyArray<SaidStep>): StepNote => {
  if (steps[0] === undefined) return { title: 'Kept your errand', links: [] }
  const title = fit(`Kept your errand: ${inOrder(steps, true)}`)
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

/** Sentences that speak to the agent, not the person: a tool's name, an order, or where the errand waits for the person's word. */
const forTheAgent = (sentence: string): boolean =>
  /\b[a-z]+_[a-z_]+\b/.test(sentence) ||
  /^\s*(?:read|use|say|keep|ask|try|tell|resume|call|name)\b/i.test(sentence) ||
  /(?:waits? for|on|needs?) the person’s (?:fresh )?(?:word|message)|word again/i.test(sentence)

/** A reason as written to the person: what it says of them, to them; what it says to the agent (tools, orders) left out. */
const forThePerson = (reason: string | null): string =>
  (
    (reason ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? []
  )
    .map((sentence) => sentence.trim())
    // "A new objection needs the person’s word again" is for the agent, but that there was an objection is the person's to know.
    .map((sentence) => (/\bobjection\b/i.test(sentence) && forTheAgent(sentence) ? 'There was a new objection.' : sentence))
    .filter((sentence) => sentence !== '' && !forTheAgent(sentence))
    .map((sentence) => sentence.replace(/\bthe person’s\b/gi, 'your').replace(/\bthe person\b/gi, 'you'))
    .join(' ')

/** That reason to follow a dash: lower-cased where it starts a sentence, without its stop. */
export const plainReason = (reason: string | null): string => {
  const said = unstop(forThePerson(reason))
  return said === '' ? '' : lower(said)
}

/** What an unwatched wait means to the person: the step that has one, why Althar cannot go on, and how to get it going. */
export const unwatched = (
  steps: ReadonlyArray<SaidStep>,
  watched: ReadonlyArray<string>,
): { readonly why: string; readonly can: string } | undefined => {
  const waits = steps.flatMap((step) => step.waits).filter((wait) => !watched.includes(wait.kind))
  if (waits.length === 0) return undefined
  const clauses = [...new Set(waits.flatMap((wait) => knownClause(wait) ?? []))]
  return {
    why: clauses.length === 0 ? 'Althar can’t tell what it waits for' : `Althar can’t tell when ${list(clauses)}`,
    can: 'Ask for it again to keep it another way.',
  }
}

/** The reason Althar itself gives when it holds an errand for a wait it cannot watch; its lines say it in words instead. */
export const UNWATCHED_REASON = 'Althar cannot watch wait kinds:'

/**
 * A line of a lead, what the errand is, and why, cut to the longest a line may be. The reason is kept: the steps are cut first,
 * down to what leaves the reason room. Whatever was cut folds under Details, whole.
 */
const compose = (lead: string, what: string, because: string, tail = ''): Omit<StepNote, 'links'> => {
  const closing = tail === '' ? 0 : tail.length + 2
  const room = TITLE_MOST - closing
  const whole = `${lead}${what === '' ? '' : `: ${what}`}${because === '' ? '' : ` — ${because}`}`
  const join = (head: string) => (tail === '' ? head : `${head}${head.endsWith('…') ? ' ' : '. '}${tail}`)
  if (whole.length <= room) return { title: join(whole) }
  const reason = because === '' ? '' : fit(because, Math.max(Math.floor(room / 2), room - lead.length - 2 - what.length - 3))
  const steps = fit(what, Math.max(room - lead.length - 2 - (reason === '' ? 0 : reason.length + 3), 24))
  const head = `${lead}${steps === '' ? '' : `: ${steps}`}${reason === '' ? '' : ` — ${reason}`}`
  return { title: join(fit(head, room)), details: trimmed(join(whole), DETAILS_MOST) }
}

/**
 * An errand put on hold, in the person's words: what is left of it (the held step first), why in a phrase they know, and what
 * they can do. The reason the agents read stays on the errand, not here.
 */
export const heldNote = (
  steps: ReadonlyArray<SaidStep>,
  reason: string | null,
  plain?: { readonly why: string; readonly can?: string },
  lead = 'Errand on hold',
): StepNote => {
  const line = compose(lead, inOrder(steps, false), plain?.why ?? plainReason(reason), plain?.can ?? 'Say go ahead to continue.')
  return { ...line, links: linksIn(line.title, steps) }
}

/** An errand called off: what it was, and why where it was not the person's own word. */
export const calledOffNote = (steps: ReadonlyArray<SaidStep>, reason: string | null, byPerson: boolean): StepNote => {
  const line = compose('Errand called off', inOrder(steps, false), byPerson ? '' : plainReason(reason))
  return { ...line, links: linksIn(line.title, steps) }
}

/** What has happened to one of a held errand's steps, as the host shows it now: "v0.9.0 is tagged already", "#957 is open". */
export interface Happened {
  readonly said: string
  readonly links: ReadonlyArray<NoteLink>
}

/**
 * A held errand that closed by itself, since what it waited on has happened: done, where every step left was done already;
 * else closed, where the next step's wait came while Althar couldn't watch for it, so that step and those after it are the
 * person's to ask for again.
 */
export const settledNote = (
  done: ReadonlyArray<Happened>,
  left?: { readonly steps: ReadonlyArray<SaidStep>; readonly happened: Happened },
): StepNote => {
  // A merge said done already isn't said again as what the next step waited for.
  const again = left !== undefined && done.some((one) => one.said.startsWith(left.happened.said))
  const said = [...done, ...(left === undefined || again ? [] : [left.happened])]
  const what = said.map((one) => one.said).join('; ')
  const title = fit(
    left === undefined
      ? `Errand done: ${what}`
      : `Errand closed: ${what}, which Althar couldn’t watch for. Ask again to ${inOrder(left.steps, false)}.`,
  )
  const links: Array<NoteLink> = []
  for (const link of said.flatMap((one) => one.links)) if (!links.some((own) => own.label === link.label)) links.push(link)
  return { title, links: links.filter((link) => title.includes(link.label)) }
}

/** An errand the person set going again: what it goes on with. */
export const resumedNote = (steps: ReadonlyArray<SaidStep>): StepNote => {
  const line = compose('Errand resumed', inOrder(steps, true), '')
  return { ...line, links: linksIn(line.title, steps) }
}

/** Where an errand still waits, for its daily reminder: its steps to go and what the first waits for, or why it is on hold. */
export const stillNote = (
  paused: boolean,
  reason: string | null,
  steps: ReadonlyArray<SaidStep>,
  plain?: { readonly why: string; readonly can?: string },
): StepNote => {
  if (paused) return heldNote(steps, reason, plain, 'Errand still on hold')
  const full = steps[0] === undefined ? 'Errand still waits' : `Errand still waits to ${inOrder(steps, true)}`
  const title = fit(full)
  return { title, links: linksIn(title, steps), ...(title === full ? {} : { details: trimmed(full, DETAILS_MOST) }) }
}
