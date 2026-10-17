import type { ReportItem } from '@althar/ui'

import type { AgentSignIn } from '../../../main/report/facts'
import type { ReportContext, ReportPreview } from '../../../main/report/bundle'
import type { ProblemAbout } from '../../data/services'
import { device } from '../../shared/device'

/*
 * Report a problem's words, and how what the person is reporting reads:
 * where in the window it was asked from (from what it is about and the
 * place in the window's address), and every item that goes with it, as See
 * what's sent lists them.
 */

export const text = {
  byMail: 'Althar saves the report in Downloads and opens a message in your mail app to send it with.',
  about: (what: string) => `About ${what}.`,
  update: 'an update that couldn’t move your data',
  /** A stuck step, as the report's about line has it: the stuck Implement step. */
  stuck: (step: string) => `the stuck ${step} step`,
  sent: { title: 'Report sent', line: 'It reached the people who make Althar.' },
  saved: (file: string) => ({ title: 'Report saved', line: `It’s in Downloads as ${file}. Attach it to the message in your mail app.` }),
  couldNotOpen: 'Althar couldn’t open a report.',
  item: {
    app: 'Althar',
    system: 'System',
    agents: 'Agents',
    screen: 'Screen',
    profile: 'Profile',
    install: 'Install id',
    screenshot: 'Screenshot',
    errors: 'Last errors',
  },
  value: {
    app: (version: string, electron: string) => `${version}, Electron ${electron}`,
    system: (os: string, arch: string) => `${os}, ${arch}`,
    noRuntime: 'Not read: the runtime didn’t answer',
    version: (version: string | null) => version ?? 'Version not known',
    adapter: (version: string) => `adapter ${version}`,
    signIn: {
      signed_in: 'signed in',
      signed_out: 'signed out',
      unknown: 'sign-in not known',
      not_installed: `not on ${device.this}`,
    } satisfies Record<AgentSignIn, string>,
    notHere: `Not on ${device.this}`,
    screenshot: 'This window, as it was',
    errors: (count: number) => (count === 0 ? 'None' : count === 1 ? 'One line' : `${count} lines`),
    log: (bytes: number) => `Its last ${bytes < 1_000 ? `${bytes} bytes` : `${Math.round(bytes / 1_000)} KB`}`,
    migrations: (count: number, last: string | null) =>
      count === 0 ? 'No migrations' : `${count} migration${count === 1 ? '' : 's'}${last === null ? '' : `, the last ${last}`}`,
  },
  screens: {
    home: 'Home',
    project: 'Project',
    rules: 'Rules',
    repositories: 'Repositories',
    task: 'Task',
    settings: 'Settings',
    update: 'Update',
    unknown: 'Unknown',
  } as Readonly<Record<string, string>>,
}

/** Where the window is, from the place in its address (the router keeps it in the hash): the screen and the ids it names. */
export const placeOf = (hash: string): Pick<ReportContext, 'screen' | 'projectId' | 'threadId'> => {
  const path = hash.replace(/^#/, '').split('?')[0] ?? ''
  const thread = /^\/threads\/([^/]+)/.exec(path)
  if (thread !== null) return { screen: 'task', projectId: null, threadId: decodeURIComponent(thread[1] ?? '') }
  const project = /^\/projects\/([^/]+)(?:\/(rules|repositories))?/.exec(path)
  if (project !== null) return { screen: project[2] ?? 'project', projectId: decodeURIComponent(project[1] ?? ''), threadId: null }
  if (/^\/settings(?:\/|$)/.test(path)) return { screen: 'settings', projectId: null, threadId: null }
  return { screen: 'home', projectId: null, threadId: null }
}

/** What the report says about where it was asked from. */
export const contextOf = (about: ProblemAbout, hash: string): ReportContext => {
  switch (about.kind) {
    case 'update':
      return { screen: 'update', projectId: null, taskId: null, threadId: null, about: `${text.update}: ${about.reason}` }
    case 'failed':
      return { screen: 'task', projectId: about.projectId, taskId: about.taskId, threadId: about.threadId, about: about.what }
    case 'asked':
      // The menu and the quick settings float over any screen, so it is where the window is: the Settings tab, a project, a task.
      return { ...placeOf(hash), taskId: null, about: null }
  }
}

/** The screen and its ids, as a line. */
const screenLine = (context: ReportContext) =>
  [text.screens[context.screen] ?? context.screen, context.taskId, context.threadId, context.projectId]
    .filter((part): part is string => part !== null)
    .join(', ')

/** Every item that goes, as See what's sent lists them; the switches decide which of the last ones go. */
export const itemsOf = (preview: ReportPreview): ReadonlyArray<ReportItem> => [
  { id: 'app', label: text.item.app, value: text.value.app(preview.app.version, preview.app.electron) },
  { id: 'system', label: text.item.system, value: text.value.system(preview.app.os, preview.app.arch) },
  ...(preview.agents === null
    ? [{ id: 'agents', label: text.item.agents, value: text.value.noRuntime }]
    : preview.agents.map((agent) => ({
        id: `agent-${agent.id}`,
        label: agent.name,
        value:
          agent.signIn === 'not_installed'
            ? text.value.notHere
            : [
                text.value.version(agent.version),
                ...(agent.adapter === null ? [] : [text.value.adapter(agent.adapter)]),
                text.value.signIn[agent.signIn],
              ].join(', '),
      }))),
  { id: 'screen', label: text.item.screen, value: screenLine(preview.context) },
  ...(preview.migrations === null
    ? []
    : [{ id: 'profile', label: text.item.profile, value: text.value.migrations(preview.migrations.count, preview.migrations.last) }]),
  { id: 'install', label: text.item.install, value: preview.installId },
  ...(preview.screenshot
    ? [{ id: 'screenshot', label: text.item.screenshot, value: text.value.screenshot, with: 'screenshot' as const }]
    : []),
  { id: 'errors', label: text.item.errors, value: text.value.errors(preview.errors), with: 'logs' as const },
  ...preview.logs.map((log) => ({
    id: `log-${log.name}`,
    label: `${log.name}.log`,
    value: text.value.log(log.bytes),
    with: 'logs' as const,
  })),
]
