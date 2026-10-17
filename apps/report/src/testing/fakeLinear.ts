import { isRecord } from '../values'

/*
 * A stand-in for Linear's GraphQL API and its upload storage, for the tests
 * and for running the Worker locally (scripts/fake-linear.ts serves it on
 * 127.0.0.1:8788). It answers the five calls the Worker makes with
 * plausible data, keeps the label it is asked to make, and records every
 * request, so a test, or a person watching the script, sees exactly what
 * Linear would have received. Like the real storage, it turns an upload
 * away unless it carries the headers fileUpload handed out for it.
 *
 * It is test tooling: the Worker never imports it.
 */

export const FAKE_TEAM_ID = '114c997c-12a5-4ab3-89bc-8d29dfd2ddeb'
export const FAKE_TRIAGE_STATE_ID = 'state-triage'

export interface FakeLinearOptions {
  /** Whether the team has Triage on. On by default. */
  readonly triage?: boolean
  /** Where the label is to begin with: in the team, in the workspace, in another team, or nowhere (the default). */
  readonly label?: 'team' | 'workspace' | 'other-team' | 'missing'
  readonly labelName?: string
  readonly teamId?: string
}

export interface FakeCall {
  readonly method: string
  readonly url: string
  /** Lowercase names. */
  readonly headers: Readonly<Record<string, string>>
  /** The GraphQL operation's name, or null for an upload. */
  readonly operation: string | null
  readonly variables: Readonly<Record<string, unknown>>
  /** An upload's bytes, or null for a GraphQL call. */
  readonly bytes: Uint8Array | null
  readonly status: number
}

export interface FakeLinear {
  readonly calls: Array<FakeCall>
  readonly handle: (request: Request) => Promise<Response>
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>
}

interface Label {
  readonly id: string
  readonly name: string
  readonly teamId: string | null
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const graphqlError = (status: number, code: string, message: string) => json(status, { errors: [{ message, extensions: { code } }] })

export const makeFakeLinear = (options: FakeLinearOptions = {}): FakeLinear => {
  const teamId = options.teamId ?? FAKE_TEAM_ID
  const labelName = options.labelName ?? 'From the app'
  const labels: Array<Label> = []
  const where = options.label ?? 'missing'
  if (where === 'team') labels.push({ id: 'label-team', name: labelName, teamId })
  if (where === 'workspace') labels.push({ id: 'label-workspace', name: labelName, teamId: null })
  if (where === 'other-team') labels.push({ id: 'label-other', name: labelName, teamId: 'another-team' })

  const uploads = new Map<string, Readonly<Record<string, string>>>()
  const calls: Array<FakeCall> = []
  let issues = 0

  const answer = (operation: string, variables: Readonly<Record<string, unknown>>, origin: string): Response => {
    switch (operation) {
      case 'ReportTeam':
        return variables.id === teamId
          ? json(200, {
              data: {
                team: {
                  triageEnabled: options.triage ?? true,
                  states: {
                    nodes: [
                      { id: 'state-backlog', type: 'backlog' },
                      { id: FAKE_TRIAGE_STATE_ID, type: 'triage' },
                      { id: 'state-todo', type: 'unstarted' },
                    ],
                  },
                },
              },
            })
          : graphqlError(200, 'INVALID_INPUT', 'Entity not found: Team')
      case 'ReportLabel': {
        const name = typeof variables.name === 'string' ? variables.name.toLowerCase() : ''
        const nodes = labels
          .filter((label) => label.name.toLowerCase() === name)
          .map((label) => ({ id: label.id, team: label.teamId === null ? null : { id: label.teamId } }))
        return json(200, { data: { issueLabels: { nodes } } })
      }
      case 'ReportLabelCreate': {
        const input = isRecord(variables.input) ? variables.input : {}
        const label = {
          id: `label-${labels.length + 1}`,
          name: String(input.name),
          teamId: typeof input.teamId === 'string' ? input.teamId : null,
        }
        labels.push(label)
        return json(200, { data: { issueLabelCreate: { success: true, issueLabel: { id: label.id } } } })
      }
      case 'ReportFileUpload': {
        const n = uploads.size + 1
        const filename = String(variables.filename)
        const headers = {
          'content-disposition': `attachment; filename="${filename}"`,
          'x-goog-content-length-range': `0,${String(variables.size)}`,
        }
        uploads.set(`/upload/${n}`, headers)
        return json(200, {
          data: {
            fileUpload: {
              success: true,
              uploadFile: {
                uploadUrl: `${origin}/upload/${n}`,
                assetUrl: `https://uploads.linear.app/fake/${n}/${filename}`,
                headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
              },
            },
          },
        })
      }
      case 'ReportIssueCreate': {
        issues += 1
        return json(200, { data: { issueCreate: { success: true, issue: { id: `issue-${issues}`, identifier: `DEV-${100 + issues}` } } } })
      }
      default:
        return graphqlError(400, 'GRAPHQL_VALIDATION_FAILED', `Unknown operation ${operation}`)
    }
  }

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const headers = Object.fromEntries(Array.from(request.headers, ([name, value]) => [name.toLowerCase(), value]))
    const record = (
      response: Response,
      operation: string | null,
      variables: Readonly<Record<string, unknown>>,
      bytes: Uint8Array | null,
    ) => {
      calls.push({ method: request.method, url: request.url, headers, operation, variables, bytes, status: response.status })
      return response
    }

    if (request.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const bytes = new Uint8Array(await request.arrayBuffer())
      const expected = uploads.get(url.pathname)
      const signed = expected !== undefined && Object.entries(expected).every(([name, value]) => headers[name] === value)
      return record(new Response(signed ? null : 'SignatureDoesNotMatch', { status: signed ? 200 : 403 }), null, {}, bytes)
    }

    if (request.method === 'POST' && url.pathname === '/graphql') {
      const body: unknown = await request.json().catch(() => null)
      const query = isRecord(body) && typeof body.query === 'string' ? body.query : ''
      const variables = isRecord(body) && isRecord(body.variables) ? body.variables : {}
      const operation = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'anonymous'
      if (headers.authorization === undefined || headers.authorization === '')
        return record(graphqlError(401, 'AUTHENTICATION_ERROR', 'Authentication required, not authenticated'), operation, variables, null)
      return record(answer(operation, variables, url.origin), operation, variables, null)
    }

    return record(new Response('Not found', { status: 404 }), null, {}, null)
  }

  return { calls, handle, fetch: (input, init) => handle(new Request(input, init)) }
}
