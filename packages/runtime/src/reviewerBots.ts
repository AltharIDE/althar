import { agentBot } from './credit'

/*
 * The bots a project's leads may hear (ADR-104): the review and triage
 * agents teams put in their pipelines, which Althar recognises by their
 * accounts. The person trusts each one alone, in the project's settings;
 * none is trusted unless they did. A bot Althar doesn't recognise as a
 * reviewer, a coverage report, a deploy preview, a dependency bump, is
 * never suggested, and stays quiet as before.
 */

/** A bot as the settings and the thread name it: its account on the host, and what it is called. */
export interface ReviewerBot {
  /** Its account, as kept: in small letters, `coderabbitai[bot]`. */
  readonly login: string
  /** What it is called: CodeRabbit. */
  readonly name: string
}

/** The review and triage agents Althar knows by their accounts, and what each is called. */
const KNOWN: Readonly<Record<string, string>> = {
  'coderabbitai[bot]': 'CodeRabbit',
  'copilot-pull-request-reviewer[bot]': 'Copilot',
  'claude[bot]': 'Claude',
  'chatgpt-codex-connector[bot]': 'Codex',
  'cursor[bot]': 'Cursor Bugbot',
  'gemini-code-assist[bot]': 'Gemini Code Assist',
  'greptile-apps[bot]': 'Greptile',
  'sourcery-ai[bot]': 'Sourcery',
  'qodo-merge-pro[bot]': 'Qodo',
  'qodo-merge[bot]': 'Qodo',
  'codiumai-pr-agent-pro[bot]': 'Qodo',
  'ellipsis-dev[bot]': 'Ellipsis',
  'korbit-ai[bot]': 'Korbit',
  'graphite-app[bot]': 'Graphite',
  'devin-ai-integration[bot]': 'Devin',
  'bito-code-review[bot]': 'Bito',
  'amazon-q-developer[bot]': 'Amazon Q',
}

/**
 * Bots named for an agent that aren't reviewers: coding agents that open
 * pull requests of their own, whose comments say what they did.
 */
const NOT_REVIEWERS = new Set(['copilot-swe-agent[bot]', 'google-labs-jules[bot]'])

/** Words a bot that only reports or deploys is named with: codecov, cloudflare-workers-and-pages, vercel. */
const REPORTERS =
  /(^|[-_])(cov|codecov|coverage|coveralls|deploy|deployments?|preview|pages|vercel|netlify|cloudflare|render|railway|dependabot|renovate|changeset|release|stale|actions|mergify|sonar|snyk|socket|lint|lighthouse|percy|chromatic|storybook|size|bundle)([-_]|$)/

/** A login as kept, in small letters. */
export const botLogin = (login: string) => login.trim().toLowerCase()

/** A bot's name from its account, where Althar doesn't know it: claude-review[bot] reads Claude review. */
const nameFrom = (login: string) => {
  const words = login
    .replace(/\[bot\]$/, '')
    .split(/[-_]+/)
    .filter((word) => word !== '')
  const said = words.join(' ')
  return said === '' ? login : `${said.charAt(0).toUpperCase()}${said.slice(1)}`
}

/**
 * The review or triage agent a bot's account is, where Althar recognises it
 * as one: one it knows by name, or a bot named for an agent (claude-review[bot])
 * that isn't a coding agent or named for reporting or deploying. Null for
 * every other account.
 */
export const reviewerBot = (login: string): ReviewerBot | null => {
  const said = botLogin(login)
  const known = KNOWN[said]
  if (known !== undefined) return { login: said, name: known }
  if (!said.endsWith('[bot]') || NOT_REVIEWERS.has(said)) return null
  const bare = said.slice(0, -'[bot]'.length)
  if (REPORTERS.test(bare)) return null
  return agentBot(said, []) ? { login: said, name: nameFrom(said) } : null
}

/** What a bot is called, recognised or not: as `reviewerBot` names it, else from its account. */
export const botName = (login: string) => reviewerBot(login)?.name ?? nameFrom(botLogin(login))

/** Whether a project's trusted bots, as its rules keep them, have this one. */
export const trusts = (trusted: ReadonlyArray<string>, login: string) => trusted.some((each) => botLogin(each) === botLogin(login))
