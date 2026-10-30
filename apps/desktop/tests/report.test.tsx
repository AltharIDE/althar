import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Opened, ReportPreview, Sent } from '../src/main/report/bundle'
import type { ProblemAbout, ReportHost } from '../src/renderer/data/services'
import { ReportDialog } from '../src/renderer/features/report/ReportDialog'
import { contextOf, itemsOf, placeOf } from '../src/renderer/features/report/reportWords'
import { keepWindowErrors } from '../src/renderer/shared/windowErrors'
import { fakeHost } from './fixtures'

const previewed: ReportPreview = {
  app: { version: '0.4.0', electron: '44.5.0', os: 'macOS 26.5', arch: 'arm64' },
  installId: '3f0c9a52-6b1e-4f7d-9a0e-2c5b8d71e4aa',
  context: { screen: 'task', projectId: 'proj_1', taskId: 'task_1', threadId: 'thr_1', about: null },
  agents: [
    { id: 'claude-code', name: 'Claude Code', version: '2.1.263', adapter: '0.88.0', signIn: 'signed_in' },
    { id: 'opencode', name: 'OpenCode', version: null, adapter: null, signIn: 'not_installed' },
  ],
  migrations: { count: 18, last: 'questions' },
  screenshot: true,
  errors: 3,
  logs: [{ name: 'runtime', bytes: 41_200 }],
}

/** The main process's side of a report, faked: opening, what goes, and sending, each as a test says. */
const reportHost = (overrides: Partial<ReportHost> = {}, opened: Partial<Opened> = {}) => {
  const asked = new Set<(about: ProblemAbout) => void>()
  const host: ReportHost = {
    open: vi.fn(async () => ({
      reportId: 'r1',
      screenshot: 'data:image/png;base64,iVBORw0KGgo=',
      email: null,
      via: 'send' as const,
      ...opened,
    })),
    preview: vi.fn(async () => previewed),
    send: vi.fn(async (): Promise<Sent> => ({ kind: 'sent' })),
    close: vi.fn(),
    onAsked: (listener) => {
      asked.add(listener)
      return () => void asked.delete(listener)
    },
    ...overrides,
  }
  const ask = (about: ProblemAbout) =>
    act(async () => {
      for (const listener of asked) listener(about)
    })
  return { host, ask }
}

describe('where a report is asked from', () => {
  it('reads the screen and its ids from the window’s address', () => {
    expect(placeOf('#/threads/thr_1')).toEqual({ screen: 'task', projectId: null, threadId: 'thr_1' })
    expect(placeOf('#/projects/proj_1')).toEqual({ screen: 'project', projectId: 'proj_1', threadId: null })
    expect(placeOf('#/projects/proj_1/rules')).toEqual({ screen: 'rules', projectId: 'proj_1', threadId: null })
    expect(placeOf('#/settings/about')).toEqual({ screen: 'settings', projectId: null, threadId: null })
    expect(placeOf('#/')).toEqual({ screen: 'home', projectId: null, threadId: null })
    expect(placeOf('')).toEqual({ screen: 'home', projectId: null, threadId: null })
  })

  it('says what it is about: the place for the menu, Settings, a stuck step by its task, or an update that couldn’t move the data', () => {
    expect(contextOf({ kind: 'asked', from: 'menu' }, '#/threads/thr_1')).toEqual({
      screen: 'task',
      projectId: null,
      taskId: null,
      threadId: 'thr_1',
      about: null,
    })
    // From the quick settings, over a task, it is the task; from the Settings tab, Settings.
    expect(contextOf({ kind: 'asked', from: 'settings' }, '#/threads/thr_1').screen).toBe('task')
    expect(contextOf({ kind: 'asked', from: 'settings' }, '#/settings/about').screen).toBe('settings')
    expect(
      contextOf({ kind: 'failed', taskId: 'task_1', projectId: 'proj_1', threadId: 'thr_1', what: 'the stuck Implement step' }, '#/'),
    ).toEqual({ screen: 'task', projectId: 'proj_1', taskId: 'task_1', threadId: 'thr_1', about: 'the stuck Implement step' })
    expect(contextOf({ kind: 'update', reason: 'no such table' }, '#/')).toMatchObject({
      screen: 'update',
      about: 'an update that couldn’t move your data: no such table',
    })
  })

  it('lists every item that goes, each saying what it is', () => {
    expect(itemsOf(previewed).map((item) => [item.label, item.value, item.with ?? ''])).toEqual([
      ['Althar', '0.4.0, Electron 44.5.0', ''],
      ['System', 'macOS 26.5, arm64', ''],
      ['Claude Code', '2.1.263, adapter 0.88.0, signed in', ''],
      ['OpenCode', 'Not on this Mac', ''],
      ['Screen', 'Task, task_1, thr_1, proj_1', ''],
      ['Profile', '18 migrations, the last questions', ''],
      ['Install id', '3f0c9a52-6b1e-4f7d-9a0e-2c5b8d71e4aa', ''],
      ['Screenshot', 'This window, as it was', 'screenshot'],
      ['Last errors', '3 lines', 'logs'],
      ['runtime.log', 'Its last 41 KB', 'logs'],
    ])
    expect(itemsOf({ ...previewed, agents: null, migrations: null, screenshot: false }).map((item) => item.label)).toEqual([
      'Althar',
      'System',
      'Agents',
      'Screen',
      'Install id',
      'Last errors',
      'runtime.log',
    ])
  })

  it('says what isn’t known, and counts in words, as the items go', () => {
    const items = itemsOf({
      ...previewed,
      context: { screen: 'elsewhere', projectId: null, taskId: null, threadId: null, about: null },
      agents: [{ id: 'codex', name: 'Codex', version: null, adapter: null, signIn: 'unknown' }],
      migrations: { count: 1, last: null },
      errors: 1,
      logs: [{ name: 'main', bytes: 640 }],
    })
    expect(items.map((item) => [item.label, item.value])).toEqual([
      ['Althar', '0.4.0, Electron 44.5.0'],
      ['System', 'macOS 26.5, arm64'],
      ['Codex', 'Version not known, sign-in not known'],
      ['Screen', 'elsewhere'],
      ['Profile', '1 migration'],
      ['Install id', '3f0c9a52-6b1e-4f7d-9a0e-2c5b8d71e4aa'],
      ['Screenshot', 'This window, as it was'],
      ['Last errors', 'One line'],
      ['main.log', 'Its last 640 bytes'],
    ])
    const none = itemsOf({ ...previewed, migrations: { count: 0, last: null }, errors: 0 })
    expect(none.find((item) => item.id === 'profile')?.value).toBe('No migrations')
    expect(none.find((item) => item.id === 'errors')?.value).toBe('None')
  })

  it('reads a project’s repositories, and ids the address encodes', () => {
    expect(placeOf('#/projects/proj%201/repositories')).toEqual({ screen: 'repositories', projectId: 'proj 1', threadId: null })
    expect(placeOf('#/threads/thr%2F1?open=1')).toEqual({ screen: 'task', projectId: null, threadId: 'thr/1' })
  })
})

describe('how the items read in the smaller cases', () => {
  it('words the counts, sizes, versions and sign-ins as each is', () => {
    const value = (preview: ReportPreview, id: string) => itemsOf(preview).find((item) => item.id === id)?.value
    expect(value({ ...previewed, errors: 0 }, 'errors')).toBe('None')
    expect(value({ ...previewed, errors: 1 }, 'errors')).toBe('One line')
    expect(value({ ...previewed, logs: [{ name: 'main', bytes: 512 }] }, 'log-main')).toBe('Its last 512 bytes')
    expect(value({ ...previewed, migrations: { count: 0, last: null } }, 'profile')).toBe('No migrations')
    expect(value({ ...previewed, migrations: { count: 1, last: null } }, 'profile')).toBe('1 migration')
    expect(value({ ...previewed, context: { ...previewed.context, screen: 'elsewhere', taskId: null } }, 'screen')).toBe(
      'elsewhere, thr_1, proj_1',
    )
    const agents = (signIn: 'signed_out' | 'unknown'): ReportPreview => ({
      ...previewed,
      agents: [{ id: 'codex', name: 'Codex', version: null, adapter: null, signIn }],
    })
    expect(value(agents('signed_out'), 'agent-codex')).toBe('Version not known, signed out')
    expect(value(agents('unknown'), 'agent-codex')).toBe('Version not known, sign-in not known')
  })

  it('reads a project’s screens from the address, and a settings address with nothing after it', () => {
    expect(placeOf('#/projects/proj_1/repositories?tab=1')).toEqual({ screen: 'repositories', projectId: 'proj_1', threadId: null })
    expect(placeOf('#/settings')).toEqual({ screen: 'settings', projectId: null, threadId: null })
  })
})

describe('Report a problem', () => {
  it('opens where it is asked from, after the window’s picture is taken, and sends what the person wrote', async () => {
    window.location.hash = '#/threads/thr_1'
    const { host, ask } = reportHost()
    render(<ReportDialog host={fakeHost({ report: host })} />)
    await ask({ kind: 'asked', from: 'menu' })
    const box = await screen.findByRole('textbox', { name: 'What happened?' })
    expect(host.open).toHaveBeenCalledWith({ screen: 'task', projectId: null, taskId: null, threadId: 'thr_1', about: null })
    expect(screen.getByRole('img', { name: 'Screenshot of this window' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'See what’s sent' }))
    expect(await screen.findByText('2.1.263, adapter 0.88.0, signed in')).toBeTruthy()

    await userEvent.type(box, 'The review never started')
    await userEvent.click(screen.getByRole('switch', { name: 'Include logs' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Email, if you’d like a reply' }), 'dana@example.com')
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }))
    expect(host.send).toHaveBeenCalledWith('r1', {
      text: 'The review never started',
      email: 'dana@example.com',
      screenshot: true,
      logs: false,
    })
    expect(await screen.findByRole('heading', { name: 'Report sent' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(host.close).toHaveBeenCalledWith('r1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says it goes by mail first, and where it was saved after', async () => {
    const { host, ask } = reportHost(
      { send: vi.fn(async (): Promise<Sent> => ({ kind: 'saved', file: 'althar-report-2026-10-11-1405.zip' })) },
      { via: 'mail', email: 'dana@example.com' },
    )
    render(<ReportDialog host={fakeHost({ report: host })} />)
    await ask({ kind: 'failed', taskId: 'task_1', projectId: 'proj_1', threadId: 'thr_1', what: 'the stuck Implement step' })
    expect(await screen.findByText(/About the stuck Implement step\. Althar saves the report in Downloads/)).toBeTruthy()
    // The email given last time is there again.
    expect(screen.getByRole('textbox', { name: 'Email, if you’d like a reply' })).toHaveProperty('value', 'dana@example.com')
    await userEvent.type(screen.getByRole('textbox', { name: 'What happened?' }), 'Stuck')
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }))
    expect(await screen.findByText(/It’s in Downloads as althar-report-2026-10-11-1405\.zip/)).toBeTruthy()
  })

  it('keeps what was written when it didn’t go, and says why', async () => {
    const { host, ask } = reportHost({
      send: vi.fn(async (): Promise<Sent> => ({ kind: 'failed', reason: 'Althar couldn’t reach its reports service.' })),
    })
    render(<ReportDialog host={fakeHost({ report: host })} />)
    await ask({ kind: 'asked', from: 'settings' })
    const box = await screen.findByRole('textbox', { name: 'What happened?' })
    await userEvent.type(box, 'Nothing opened')
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Althar couldn’t reach its reports service.')
    expect(box).toHaveProperty('value', 'Nothing opened')
  })

  it('opens one report at a time, and none when the window’s picture can’t be asked for', async () => {
    const { host, ask } = reportHost()
    const first = render(<ReportDialog host={fakeHost({ report: host })} />)
    await ask({ kind: 'asked', from: 'menu' })
    await ask({ kind: 'asked', from: 'menu' })
    await screen.findByRole('textbox', { name: 'What happened?' })
    expect(host.open).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    first.unmount()

    const failing = reportHost({ open: vi.fn(async () => Promise.reject(new Error('not ours'))) })
    render(<ReportDialog host={fakeHost({ report: failing.host })} />)
    await failing.ask({ kind: 'asked', from: 'menu' })
    await waitFor(() => expect(failing.host.open).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
    // And it can be asked again.
    await failing.ask({ kind: 'asked', from: 'menu' })
    await waitFor(() => expect(failing.host.open).toHaveBeenCalledTimes(2))
  })

  it('says it is about an update, with no picture, and lists nothing more when what goes can’t be read', async () => {
    const { host, ask } = reportHost({ preview: vi.fn(async () => Promise.reject(new Error('gone'))) }, { screenshot: null })
    render(<ReportDialog host={fakeHost({ report: host })} />)
    await ask({ kind: 'update', reason: 'migration 0033 failed' })
    expect(await screen.findByText('About an update that couldn’t move your data.')).toBeTruthy()
    expect(host.open).toHaveBeenCalledWith(
      expect.objectContaining({ screen: 'update', about: 'an update that couldn’t move your data: migration 0033 failed' }),
    )
    await waitFor(() => expect(host.preview).toHaveBeenCalledWith('r1'))
    expect(screen.queryByRole('img', { name: 'Screenshot of this window' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'See what’s sent' }))
    expect(screen.queryByText('2.1.263, adapter 0.88.0, signed in')).toBeNull()
  })

  it('says it couldn’t send when sending throws, and keeps a late answer off a report that closed', async () => {
    const thrown = reportHost({ send: vi.fn(async (): Promise<Sent> => Promise.reject(new Error('main went away'))) })
    const first = render(<ReportDialog host={fakeHost({ report: thrown.host })} />)
    await thrown.ask({ kind: 'asked', from: 'menu' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'What happened?' }), 'Blank window')
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Althar couldn’t send the report.')
    first.unmount()

    let answer: (sent: Sent) => void = () => {}
    let readPreview: (preview: ReportPreview) => void = () => {}
    const late = reportHost({
      send: vi.fn(() => new Promise<Sent>((resolve) => (answer = resolve))),
      preview: vi.fn(() => new Promise<ReportPreview>((resolve) => (readPreview = resolve))),
    })
    render(<ReportDialog host={fakeHost({ report: late.host })} />)
    await late.ask({ kind: 'asked', from: 'menu' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'What happened?' }), 'Slow')
    await userEvent.click(screen.getByRole('button', { name: /^Send/ }))
    // Cancelled while it sends: what comes back after belongs to no report on screen.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(late.host.close).toHaveBeenCalledWith('r1')
    await act(async () => {
      answer({ kind: 'sent' })
      readPreview(previewed)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Report sent' })).toBeNull()
  })
})

describe('what the window doesn’t handle', () => {
  it('goes to main’s log: an uncaught error with where it was thrown, and a rejection nobody caught', () => {
    const logError = vi.fn()
    const target = new EventTarget() as Window
    keepWindowErrors({ logError }, target)
    const thrown = new Error('It broke')
    target.dispatchEvent(
      new ErrorEvent('error', { message: 'Uncaught Error: It broke', error: thrown, filename: 'index.js', lineno: 3, colno: 7 }),
    )
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: 'no answer' })
    target.dispatchEvent(rejection)
    expect(logError.mock.calls).toEqual([
      [{ kind: 'error', message: 'Uncaught Error: It broke', stack: thrown.stack, source: 'index.js:3:7' }],
      [{ kind: 'rejection', message: 'no answer', stack: '' }],
    ])
    // An error that isn't an Error, a stack it doesn't have, and a rejection that is an Error.
    logError.mockClear()
    target.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0 }))
    const bare = Object.assign(new Error('No stack'), { stack: undefined })
    target.dispatchEvent(new ErrorEvent('error', { message: 'bare', error: bare }))
    const failure = new Error('Rejected')
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: failure }))
    const bareRejection = Object.assign(new Error('Also none'), { stack: undefined })
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: bareRejection }))
    expect(logError.mock.calls.map(([line]) => [line.kind, line.message, line.stack])).toEqual([
      ['error', 'Script error.', ''],
      ['error', 'bare', ''],
      ['rejection', 'Rejected', failure.stack],
      ['rejection', 'Also none', ''],
    ])
    // Where the host keeps no log, nothing listens.
    expect(() => keepWindowErrors({}, target)).not.toThrow()
  })

  it('logs what was thrown that isn’t an Error, an Error with no stack, and a rejected Error', () => {
    const logError = vi.fn()
    const target = new EventTarget() as Window
    keepWindowErrors({ logError }, target)
    target.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', error: 'a string', filename: '', lineno: 0, colno: 0 }))
    const bare = Object.assign(new Error('No stack'), { stack: undefined })
    target.dispatchEvent(
      new ErrorEvent('error', { message: 'Uncaught Error: No stack', error: bare, filename: 'a.js', lineno: 1, colno: 2 }),
    )
    const refused = new Error('Refused')
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: refused }))
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: Object.assign(new Error('Bare'), { stack: undefined }) }))
    expect(logError.mock.calls).toEqual([
      [{ kind: 'error', message: 'Script error.', stack: '', source: ':0:0' }],
      [{ kind: 'error', message: 'Uncaught Error: No stack', stack: '', source: 'a.js:1:2' }],
      [{ kind: 'rejection', message: 'Refused', stack: refused.stack }],
      [{ kind: 'rejection', message: 'Bare', stack: '' }],
    ])
  })
})
