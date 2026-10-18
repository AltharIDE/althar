import { describe, titleOf } from './describe'
import { type Limiter, isRateLimitBinding, limiterOf } from './limits'
import { type Fetch, type Linear, LinearFailed, type SetupCache, makeLinear } from './linear'
import { type Submission, declaredTooLarge, essenceOf, readForm, readSubmission } from './report'
import { isRecord, nameOf } from './values'

/*
 * The report service: a Cloudflare Worker with one route, POST /reports,
 * which turns a problem report from the app into an issue in Linear's
 * triage. The checks run cheapest first: the route, the configuration, the
 * content type and declared size, the per-IP limit, then the body (held to
 * 8 MB as it is read), the report itself, and the per-install limit. Only
 * a report that passes them all reaches Linear.
 *
 * Every answer is JSON, `{ ok: true }` or `{ ok: false, error }`, with no
 * detail of Linear's or of the configuration's values. Failures are logged
 * with `console.error` (Workers Logs keeps them), never with the API key,
 * the person's text or their address.
 */

const DEFAULT_API_URL = 'https://api.linear.app/graphql'
const DEFAULT_LABEL = 'From the app'

/** What the Worker needs from outside its code: `fetch` for Linear, and where to keep Linear's ids between requests. */
export interface Deps {
  readonly fetch: Fetch
  readonly cache: SetupCache
}

interface Config {
  readonly apiKey: string
  readonly apiUrl: string
  readonly teamId: string
  readonly label: string
  readonly perInstall: Limiter
  readonly perIp: Limiter
}

const reply = (status: number, body: { readonly ok: boolean; readonly error?: string }, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })

const failure = (status: number, error: string, headers?: Record<string, string>) => reply(status, { ok: false, error }, headers)

const tooMany = () => failure(429, 'Too many reports. Try again in a minute.', { 'retry-after': '60' })

const setting = (env: Readonly<Record<string, unknown>>, name: string): string | null => {
  const value = env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** The configuration, or the name of what is missing. Values never leave this function in an answer. */
const configOf = (env: Readonly<Record<string, unknown>>): Config | string => {
  const apiKey = setting(env, 'LINEAR_API_KEY')
  if (apiKey === null) return 'LINEAR_API_KEY is not set'
  const teamId = setting(env, 'LINEAR_TEAM_ID')
  if (teamId === null) return 'LINEAR_TEAM_ID is not set'
  const apiUrl = setting(env, 'LINEAR_API_URL') ?? DEFAULT_API_URL
  if (!URL.canParse(apiUrl) || !/^https?:$/.test(new URL(apiUrl).protocol)) return 'LINEAR_API_URL is not an http or https address'
  const perInstall = env.REPORTS_PER_INSTALL
  const perIp = env.REPORTS_PER_IP
  if (!isRateLimitBinding(perInstall)) return 'the REPORTS_PER_INSTALL rate limit is not bound'
  if (!isRateLimitBinding(perIp)) return 'the REPORTS_PER_IP rate limit is not bound'
  return {
    apiKey,
    apiUrl,
    teamId,
    label: setting(env, 'LINEAR_LABEL') ?? DEFAULT_LABEL,
    perInstall: limiterOf(perInstall),
    perIp: limiterOf(perIp),
  }
}

/** Whether the limiter lets one more through. If the limiter itself fails, it does: a lost report costs more than a minute without a limit. */
const allows = async (limiter: Limiter, key: string, which: string): Promise<boolean> => {
  try {
    return await limiter.allows(key)
  } catch (error) {
    console.error('report: rate limit failed, letting the report through', { limit: which, error: nameOf(error) })
    return true
  }
}

const fileReport = async (linear: Linear, { report, screenshot, logs }: Submission): Promise<void> => {
  const setup = await linear.setup()
  const assets = {
    screenshot: screenshot === null ? null : await linear.upload(screenshot),
    logs: logs === null ? null : await linear.upload(logs),
  }
  await linear.createIssue({ ...setup, title: titleOf(report.text), description: describe(report, assets) })
}

const route = async (request: Request, env: Readonly<Record<string, unknown>>, deps: Deps): Promise<Response> => {
  if (new URL(request.url).pathname !== '/reports') return failure(404, 'Not found.')
  if (request.method !== 'POST') return failure(405, 'Reports are sent with POST.', { allow: 'POST' })

  const config = configOf(env)
  if (typeof config === 'string') {
    console.error('report: not configured', { problem: config })
    return failure(500, `The report service isn't set up: ${config}.`)
  }

  if (essenceOf(request.headers.get('content-type')) !== 'multipart/form-data')
    return failure(415, 'Send the report as multipart/form-data.')
  if (declaredTooLarge(request)) return failure(413, 'The report is larger than 8 MB.')
  if (!(await allows(config.perIp, request.headers.get('cf-connecting-ip') ?? 'unknown', 'ip'))) return tooMany()

  const form = await readForm(request)
  if (!form.ok) return failure(form.status, form.error)
  const submission = await readSubmission(form.value)
  if (!submission.ok) return failure(submission.status, submission.error)
  if (!(await allows(config.perInstall, submission.value.report.installId, 'install'))) return tooMany()

  const linear = makeLinear({ ...config, fetch: deps.fetch, cache: deps.cache })
  try {
    await fileReport(linear, submission.value)
  } catch (error) {
    if (!(error instanceof LinearFailed)) throw error
    console.error('report: Linear failed', { step: error.step, detail: error.detail })
    return failure(502, "Linear didn't take the report. Try again later.")
  }
  return reply(201, { ok: true })
}

/** One request, answered. Anything unforeseen is a 500 with no detail, logged by kind only. */
export const handle = async (request: Request, env: unknown, deps: Deps): Promise<Response> => {
  try {
    return await route(request, isRecord(env) ? env : {}, deps)
  } catch (error) {
    console.error('report: unexpected failure', { error: nameOf(error) })
    return failure(500, 'Something went wrong on the report service.')
  }
}

/** Linear's ids, kept for the isolate's life. */
const cache: SetupCache = new Map()

export default {
  fetch: (request: Request, env: unknown): Promise<Response> => handle(request, env, { fetch: (input, init) => fetch(input, init), cache }),
}
