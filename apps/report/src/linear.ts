import { isRecord, nameOf } from './values'

/*
 * Linear, over its GraphQL API: the few calls that turn a report into an
 * issue. A personal API key goes in `Authorization` as it is, with no
 * "Bearer", and only to the API: uploads go to the storage address Linear
 * signs for each file, with the headers it hands out and no key.
 *
 * The team's triage state and the label are looked up once and kept in a
 * cache the caller owns (in the Worker, for the isolate's life). A failed
 * issueCreate forgets them, in case the team's settings changed since.
 *
 * Every answer is checked before it is used. A failure is a `LinearFailed`
 * whose detail is safe to log: a status, Linear's error codes, and Linear's
 * own words only for calls that carry nothing the person wrote (an error
 * about the issue itself may quote its input, description and all).
 */

/** `fetch`, or a stand-in for it in tests. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export type Step = 'team' | 'label' | 'upload' | 'issue'

export class LinearFailed extends Error {
  constructor(
    readonly step: Step,
    readonly detail: string,
  ) {
    super(`Linear failed at ${step}: ${detail}`)
    this.name = 'LinearFailed'
  }
}

/** Where a new issue goes: the triage state, or null for the team's default, and the label's id. */
export interface Setup {
  readonly stateId: string | null
  readonly labelId: string
}

/** Setups by API, team and label, so a test or a changed setting never gets another's. */
export type SetupCache = Map<string, Setup>

export interface LinearOptions {
  readonly fetch: Fetch
  readonly apiUrl: string
  readonly apiKey: string
  readonly teamId: string
  readonly label: string
  readonly cache: SetupCache
}

export interface Upload {
  readonly filename: string
  readonly contentType: string
  readonly file: Blob
}

export interface NewIssue extends Setup {
  readonly title: string
  readonly description: string
}

export interface Linear {
  setup(): Promise<Setup>
  /** Uploads a file to Linear's storage, and gives the address the issue links to. */
  upload(upload: Upload): Promise<string>
  createIssue(issue: NewIssue): Promise<void>
}

const TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 30_000
/** How much of Linear's own words a logged failure keeps. */
const WORDS_KEPT = 200

const TEAM = `query ReportTeam($id: String!) {
  team(id: $id) { triageEnabled states { nodes { id type } } }
}`

const LABELS = `query ReportLabel($name: String!) {
  issueLabels(filter: { name: { eqIgnoreCase: $name } }) { nodes { id team { id } } }
}`

const LABEL_CREATE = `mutation ReportLabelCreate($input: IssueLabelCreateInput!) {
  issueLabelCreate(input: $input) { success issueLabel { id } }
}`

const FILE_UPLOAD = `mutation ReportFileUpload($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    success uploadFile { uploadUrl assetUrl headers { key value } }
  }
}`

const ISSUE_CREATE = `mutation ReportIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier } }
}`

const unexpected = (step: Step, what: string) => new LinearFailed(step, `unexpected answer: ${what}`)

/** Linear's errors, as codes and, where `words` allows, its messages, cut short. */
const errorsOf = (errors: ReadonlyArray<unknown>, words: boolean): string =>
  errors
    .map((error) => {
      const code =
        isRecord(error) && isRecord(error.extensions) && typeof error.extensions.code === 'string' ? error.extensions.code : 'error'
      const message = words && isRecord(error) && typeof error.message === 'string' ? `: ${error.message.slice(0, WORDS_KEPT)}` : ''
      return `${code}${message}`
    })
    .join('; ')

const nodesOf = (connection: unknown): ReadonlyArray<unknown> =>
  isRecord(connection) && Array.isArray(connection.nodes) ? connection.nodes : []

const stringAt = (value: unknown, key: string): string | null => (isRecord(value) && typeof value[key] === 'string' ? value[key] : null)

/** An http or https address, as Linear gave it; null for anything else. */
const addressOf = (value: unknown): string | null => {
  if (typeof value !== 'string' || !URL.canParse(value)) return null
  const { protocol } = new URL(value)
  return protocol === 'https:' || protocol === 'http:' ? value : null
}

export const makeLinear = (options: LinearOptions): Linear => {
  const key = [options.apiUrl, options.teamId, options.label].join('\n')

  /** A query or mutation's `data`. `words`: whether Linear's error messages may be kept, false where they could quote the person. */
  const graphql = async (
    step: Step,
    query: string,
    variables: Readonly<Record<string, unknown>>,
    words = true,
  ): Promise<Readonly<Record<string, unknown>>> => {
    let response: Response
    try {
      response = await options.fetch(options.apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: options.apiKey },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      throw new LinearFailed(step, `request failed (${nameOf(error)})`)
    }
    // An answer that isn't JSON (a proxy's error page) is read as none; the status then says what happened.
    const body: unknown = await response.json().catch(() => null)
    const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : []
    if (errors.length > 0) throw new LinearFailed(step, `HTTP ${response.status}, ${errorsOf(errors, words)}`)
    if (!response.ok) throw new LinearFailed(step, `HTTP ${response.status}`)
    if (!isRecord(body) || !isRecord(body.data)) throw unexpected(step, 'no data')
    return body.data
  }

  /** A mutation's payload, which must say it succeeded. */
  const succeeded = (step: Step, payload: unknown): Readonly<Record<string, unknown>> => {
    if (!isRecord(payload) || payload.success !== true) throw new LinearFailed(step, 'success: false')
    return payload
  }

  const triageState = async (): Promise<string | null> => {
    const { team } = await graphql('team', TEAM, { id: options.teamId })
    if (!isRecord(team) || typeof team.triageEnabled !== 'boolean') throw unexpected('team', 'no team')
    if (!team.triageEnabled) return null
    const triage = nodesOf(team.states).find((state) => stringAt(state, 'type') === 'triage')
    const id = stringAt(triage, 'id')
    if (id === null) throw unexpected('team', 'triage is on but the team has no triage state')
    return id
  }

  /** The label in the team, or else the workspace's; made in the team when there is neither. A label of another team doesn't count. */
  const labelId = async (): Promise<string> => {
    const { issueLabels } = await graphql('label', LABELS, { name: options.label })
    const labels = nodesOf(issueLabels)
    const teamOf = (label: unknown) => (isRecord(label) ? label.team : undefined)
    const found = labels.find((label) => stringAt(teamOf(label), 'id') === options.teamId) ?? labels.find((label) => teamOf(label) === null)
    const foundId = stringAt(found, 'id')
    if (foundId !== null) return foundId
    const { issueLabelCreate } = await graphql('label', LABEL_CREATE, { input: { name: options.label, teamId: options.teamId } })
    const createdId = stringAt(succeeded('label', issueLabelCreate).issueLabel, 'id')
    if (createdId === null) throw unexpected('label', 'no label id')
    return createdId
  }

  return {
    setup: async () => {
      const cached = options.cache.get(key)
      if (cached !== undefined) return cached
      const setup = { stateId: await triageState(), labelId: await labelId() }
      options.cache.set(key, setup)
      return setup
    },

    upload: async ({ filename, contentType, file }) => {
      const { fileUpload } = await graphql('upload', FILE_UPLOAD, { contentType, filename, size: file.size })
      const uploadFile = succeeded('upload', fileUpload).uploadFile
      const uploadUrl = addressOf(isRecord(uploadFile) ? uploadFile.uploadUrl : undefined)
      const assetUrl = addressOf(isRecord(uploadFile) ? uploadFile.assetUrl : undefined)
      if (!isRecord(uploadFile) || uploadUrl === null || assetUrl === null) throw unexpected('upload', 'no upload address')
      // Linear's headers go last, so they win, as its documentation has it.
      const headers = new Headers({ 'content-type': contentType, 'cache-control': 'public, max-age=31536000' })
      for (const header of Array.isArray(uploadFile.headers) ? uploadFile.headers : []) {
        const name = stringAt(header, 'key')
        const value = stringAt(header, 'value')
        if (name === null || value === null) throw unexpected('upload', 'a header without a key or value')
        try {
          headers.set(name, value)
        } catch {
          // Headers.set throws on a name or value no request could carry.
          throw unexpected('upload', 'a header no request can carry')
        }
      }
      let response: Response
      try {
        response = await options.fetch(uploadUrl, { method: 'PUT', headers, body: file, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) })
      } catch (error) {
        throw new LinearFailed('upload', `storage request failed (${nameOf(error)})`)
      }
      if (!response.ok) throw new LinearFailed('upload', `storage answered HTTP ${response.status}`)
      return assetUrl
    },

    createIssue: async ({ title, description, stateId, labelId }) => {
      const input = { teamId: options.teamId, title, description, labelIds: [labelId], ...(stateId === null ? {} : { stateId }) }
      try {
        const { issueCreate } = await graphql('issue', ISSUE_CREATE, { input }, false)
        succeeded('issue', issueCreate)
      } catch (error) {
        options.cache.delete(key)
        throw error
      }
    },
  }
}
