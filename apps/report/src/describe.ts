import type { Agent, Report } from './report'

/*
 * The issue's title and description, from a checked report. The person's
 * text comes first, in full and as they wrote it (Markdown, if they used
 * any). Below a rule, the facts the app sent, one plain line each, then the
 * screenshot, a link to the logs and the last errors. Every value from the
 * app is escaped or put in a code span, so it can't turn into markup, and a
 * part the report doesn't have leaves no line behind.
 */

const TITLE_MAX = 80
export const FALLBACK_TITLE = 'Report from the app'

/**
 * The first line with words in it, at most 80 characters: cut at the last
 * space that keeps at least half of it, or else mid-word, and marked "…".
 */
export const titleOf = (text: string): string => {
  const line = text
    .split(/\r\n|\r|\n/)
    .map((each) => each.replace(/\s+/g, ' ').trim())
    .find((each) => each !== '')
  if (line === undefined) return FALLBACK_TITLE
  const chars = Array.from(line)
  if (chars.length <= TITLE_MAX) return line
  const room = chars.slice(0, TITLE_MAX - 1).join('')
  const space = room.lastIndexOf(' ')
  return `${space >= TITLE_MAX / 2 ? room.slice(0, space) : room}…`
}

/** Text that reads as itself in Markdown: anything that could start markup is escaped. */
export const escape = (text: string): string => text.replace(/[\\`*_[\]<>!|~#&]/g, '\\$&')

/** An address for a Markdown link: brackets percent-encoded, so the link can't end early. */
const linkOf = (url: string): string => url.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll(' ', '%20')

/** A fenced block that holds `text` whatever backticks it has: the fence is longer than any run inside. */
const fenced = (text: string): string => {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (run) => run[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}text\n${text}\n${fence}`
}

const SIGN_IN_WORDS: Record<Agent['signIn'], string> = {
  signed_in: 'signed in',
  signed_out: 'signed out',
  unknown: 'sign-in unknown',
  not_installed: 'not installed',
}

const agentLine = (agent: Agent): string =>
  [
    agent.version === null ? escape(agent.name) : `${escape(agent.name)} ${escape(agent.version)}`,
    ...(agent.adapter === null ? [] : [`adapter ${escape(agent.adapter)}`]),
    SIGN_IN_WORDS[agent.signIn],
  ].join(', ')

const migrationsLine = ({ count, last }: Report['migrations']): string => {
  const counted = count === 1 ? '1 migration' : `${count} migrations`
  return last === null ? counted : `${counted}, the last ${escape(last)}`
}

/** Where the person was: the screen, and the project, task and thread by id. */
const screenLine = ({ screen, projectId, taskId, threadId }: Report['context']): string =>
  [
    `Screen: ${escape(screen)}`,
    ...(projectId === null ? [] : [`project \`${projectId}\``]),
    ...(taskId === null ? [] : [`task \`${taskId}\``]),
    ...(threadId === null ? [] : [`thread \`${threadId}\``]),
  ].join(', ')

export interface Assets {
  /** The screenshot's address in Linear, or null when there is none. */
  readonly screenshot: string | null
  readonly logs: string | null
}

export const describe = (report: Report, assets: Assets): string => {
  const { app, context } = report
  const facts = [
    `App ${escape(app.version)} on ${escape(app.os)} (${app.arch}), Electron ${escape(app.electron)}`,
    screenLine(context),
    ...(context.about === null ? [] : [`About: ${escape(context.about)}`]),
    `Install: \`${report.installId}\``,
    ...(report.email === null ? [] : [`Reply to: ${escape(report.email)}`]),
    ...report.agents.map(agentLine),
    migrationsLine(report.migrations),
  ]
  return [
    report.text,
    '---',
    facts.map((fact) => `- ${fact}`).join('\n'),
    ...(assets.screenshot === null ? [] : [`![Screenshot](${linkOf(assets.screenshot)})`]),
    ...(assets.logs === null ? [] : [`[logs.txt](${linkOf(assets.logs)})`]),
    ...(report.errors.length === 0 ? [] : ['Last errors:', fenced(report.errors.join('\n'))]),
  ].join('\n\n')
}
