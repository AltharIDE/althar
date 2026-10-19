// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import { masker } from '../src/logs/mask'
import { assemble, contextOf, type Gathered, lastErrors, preview, readable } from '../src/main/report/bundle'
import { form, mailto, NotDelivered, post, reportAddress, save, zipName } from '../src/main/report/deliver'
import { factsIn, remoteNames, type RuntimeFacts } from '../src/main/report/facts'
import { zip } from '../src/main/report/zip'

const facts: RuntimeFacts = {
  agents: [{ id: 'claude-code', name: 'Claude Code', version: '2.1.263', adapter: '0.88.0', signIn: 'signed_in' }],
  migrations: [
    { id: 1, name: 'initial' },
    { id: 18, name: 'questions' },
  ],
  projects: ['Meridian', 'meridian'],
  repositories: ['meridian-api'],
  thread: { taskId: 'task_1', projectId: 'proj_1' },
  turns: [
    {
      id: 'turn_9',
      threadId: 'thr_1',
      taskId: 'task_1',
      agent: 'claude-code',
      state: 'failed',
      errorClass: 'agent_exited',
      endedAt: '2026-10-11T12:00:05.000Z',
    },
    {
      id: 'turn_8',
      threadId: 'thr_1',
      taskId: 'task_1',
      agent: 'claude-code',
      state: 'completed',
      errorClass: null,
      endedAt: '2026-10-11T11:59:00.000Z',
    },
  ],
}

const gathered = (overrides: Partial<Gathered> = {}): Gathered => ({
  installId: '3f0c9a52-6b1e-4f7d-9a0e-2c5b8d71e4aa',
  app: { version: '0.4.0', electron: '44.5.0', os: 'macOS 26.5', arch: 'arm64' },
  context: {
    screen: 'task',
    projectId: null,
    taskId: null,
    threadId: 'thr_1',
    about: 'the stuck Implement step in\n/Users/dana/Althar/meridian',
  },
  runtime: facts,
  logs: [
    {
      name: 'runtime',
      text:
        '2026-10-11T12:00:00.000Z level=INFO message="Turn started" turn=turn_9\n' +
        '2026-10-11T12:00:04.000Z level=WARN message="Turn ended" state=failed cwd=/Users/dana/Althar/meridian/fix/meridian-api\n',
    },
    { name: 'agents', text: '2026-10-11T12:00:03.000Z claude-code[7] Error: spawn EPIPE token=ghp_abcdefghijklmnopqrstuvwxyz0123\n' },
    { name: 'main', text: '2026-10-11T11:00:00.000Z level=INFO message="Althar started"\n' },
  ],
  screenshot: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'image/png' },
  mask: masker({ home: '/Users/dana', user: 'dana', names: { project: facts.projects, repository: facts.repositories } }),
  ...overrides,
})

describe('a report, put together', () => {
  it('fills the task and project from the thread, and hides what it is about as it hides the logs, on one line', () => {
    expect(contextOf(gathered())).toEqual({
      screen: 'task',
      projectId: 'proj_1',
      taskId: 'task_1',
      threadId: 'thr_1',
      about: 'the stuck Implement step in ~/…/[project-1]',
    })
  })

  it('goes as the person chose: with or without the screenshot and logs, masked, keys gone', () => {
    const all = assemble(gathered(), { text: 'It stopped', email: 'dana@example.com', screenshot: true, logs: true })
    expect(all.json).toMatchObject({
      version: 1,
      text: 'It stopped',
      email: 'dana@example.com',
      agents: facts.agents,
      migrations: { count: 2, last: '0018_questions' },
    })
    expect(all.screenshot?.type).toBe('image/png')
    expect(all.logs).toContain('===== runtime.log')
    expect(all.logs).toContain('cwd=~/…/[repository-1]')
    expect(all.logs).not.toMatch(/dana|meridian|ghp_/i)
    // The last errors: what logged a warning or error, an agent's line that says error, and the turn that ended in one, in time order.
    expect(all.json.errors).toEqual([
      '2026-10-11T12:00:03.000Z agents: claude-code[7] Error: spawn EPIPE token=[secret]',
      '2026-10-11T12:00:04.000Z runtime: level=WARN message="Turn ended" state=failed cwd=~/…/[repository-1]',
      '2026-10-11T12:00:05.000Z turn: turn_9 on thr_1 (task_1) claude-code failed agent_exited',
    ])

    const bare = assemble(gathered(), { text: 'It stopped', email: null, screenshot: false, logs: false })
    expect(bare.screenshot).toBeNull()
    expect(bare.logs).toBeNull()
    expect(bare.json.errors).toEqual([])
  })

  it('says what it can without the runtime', () => {
    const shown = preview(gathered({ runtime: null }))
    expect(shown.agents).toBeNull()
    expect(shown.migrations).toBeNull()
    expect(shown.context.taskId).toBeNull()
    expect(shown.logs.map((log) => log.name)).toEqual(['runtime', 'agents', 'main'])
    expect(assemble(gathered({ runtime: null }), { text: 'x', email: null, screenshot: false, logs: true }).json.migrations).toEqual({
      count: 0,
      last: null,
    })
  })

  it('reads as a person would, for the file saved to mail', () => {
    const text = readable(assemble(gathered(), { text: 'It stopped', email: 'dana@example.com', screenshot: false, logs: true }))
    expect(text).toContain('It stopped')
    expect(text).toContain('Reply to: dana@example.com')
    expect(text).toContain('Claude Code: 2.1.263, adapter 0.88.0, signed in')
    expect(text).toContain('Migrations: 2, the last 0018_questions')
  })

  it('takes only the last errors there is room for, each cut to a line the Worker takes', () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `2026-10-11T12:00:${String(i).padStart(2, '0')}.000Z level=ERROR message="${'x'.repeat(600)}"`,
    )
    const errors = lastErrors([{ name: 'main', text: long.join('\n') }], [])
    expect(errors).toHaveLength(40)
    expect(errors.every((line) => line.length <= 500)).toBe(true)
    expect(errors.at(-1)?.startsWith('2026-10-11T12:00:59.000Z main:')).toBe(true)
  })

  it('names as many agents as the Worker takes, those on this computer first', () => {
    const missing = Array.from({ length: 12 }, (_, at) => ({
      id: `agent-${at}`,
      name: `Agent ${at}`,
      version: null,
      adapter: null,
      signIn: 'not_installed' as const,
    }))
    const here = { id: 'kimi', name: 'Kimi CLI', version: '1.52.0', adapter: null, signIn: 'signed_out' as const }
    // Without the runtime, an agent that says its version is on this computer.
    const said = { id: 'grok', name: 'Grok Build', version: '1.0.63', adapter: null, signIn: 'unknown' as const }
    const { json } = assemble(gathered({ runtime: { ...facts, agents: [...missing, here, ...facts.agents, said] } }), {
      text: 'It froze.',
      email: null,
      screenshot: false,
      logs: false,
    })
    expect(json.agents).toHaveLength(10)
    expect(json.agents.slice(0, 3).map((agent) => agent.id)).toEqual(['kimi', 'claude-code', 'grok'])
    expect(json.agents.slice(3).every((agent) => agent.signIn === 'not_installed')).toBe(true)
  })
})

describe('the runtime’s facts', () => {
  it('are taken as far as they are what they should be', () => {
    expect(factsIn(facts)).toEqual(facts)
    expect(factsIn(null)).toBeNull()
    const odd = factsIn({
      agents: [{ id: 'x', name: 'X', version: 3, adapter: null, signIn: 'signed_in' }, facts.agents[0]],
      migrations: 'all',
      thread: { projectId: 7 },
    })
    expect(odd?.agents).toEqual(facts.agents)
    expect(odd?.migrations).toEqual([])
    expect(odd?.thread).toBeNull()
  })

  it('name a repository by the owner and name in its remotes', () => {
    expect(remoteNames('git@github.com:acme/meridian-api.git')).toEqual(['acme', 'meridian-api'])
    expect(remoteNames('https://gitlab.example.com/group/meridian/')).toEqual(['group', 'meridian'])
    expect(remoteNames('nonsense')).toEqual([])
  })
})

describe('where a report goes', () => {
  it('posts only to https, or to a local Worker for wrangler dev, at its /reports', () => {
    expect(reportAddress('https://althar-report.example.workers.dev')).toBe('https://althar-report.example.workers.dev/reports')
    expect(reportAddress('https://reports.example.com/in')).toBe('https://reports.example.com/in')
    expect(reportAddress('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787/reports')
    expect(reportAddress('http://reports.example.com')).toBeNull()
    expect(reportAddress('')).toBeNull()
    expect(reportAddress(undefined)).toBeNull()
    expect(reportAddress('not a url')).toBeNull()
  })

  it('posts the Worker’s form: the report, the screenshot and the logs', async () => {
    const report = assemble(gathered(), { text: 'It stopped', email: null, screenshot: true, logs: true })
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ok: true }, { status: 201 }))
    expect(await post('https://r.example/reports', report, fetch)).toEqual({ kind: 'sent' })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://r.example/reports')
    const sent = await new Request('https://r.example', { method: 'POST', headers: init?.headers, body: init?.body ?? null }).formData()
    const json = sent.get('report')
    expect(typeof json === 'string' ? JSON.parse(json) : null).toEqual(report.json)
    const screenshot = sent.get('screenshot')
    expect(screenshot instanceof File && screenshot.name === 'screenshot.png' && screenshot.type === 'image/png').toBe(true)
    const logs = sent.get('logs')
    expect(logs instanceof File && (await logs.text()) === report.logs).toBe(true)
    // Left out, they aren't in the form.
    const bare = await form(assemble(gathered(), { text: 'x', email: null, screenshot: false, logs: false }))
    const parsed = await new Request('https://r.example', {
      method: 'POST',
      headers: { 'content-type': bare.type },
      body: bare.body,
    }).formData()
    expect([...parsed.keys()]).toEqual(['report'])
  })

  it('says why it didn’t go: too many, refused, or not reached', async () => {
    const report = assemble(gathered(), { text: 'x', email: null, screenshot: false, logs: false })
    await expect(post('https://r.example', report, async () => new Response(null, { status: 429 }))).rejects.toThrow(/Too many reports/)
    await expect(
      post('https://r.example', report, async () => Response.json({ ok: false, error: 'The text is empty.' }, { status: 400 })),
    ).rejects.toThrow(/didn’t take it\. The text is empty\./)
    const unreached = post('https://r.example', report, async () => {
      throw new TypeError('fetch failed')
    })
    await expect(unreached).rejects.toBeInstanceOf(NotDelivered)
    await expect(unreached).rejects.toThrow('Althar couldn’t reach its reports service.')
  })

  it('saves a zip beside the others in Downloads, under a name nothing has, for the mail', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-downloads-'))
    const at = new Date(2026, 9, 11, 14, 5)
    expect(zipName(folder, at)).toBe('althar-report-2026-10-11-1405.zip')
    writeFileSync(join(folder, 'althar-report-2026-10-11-1405.zip'), '')
    expect(zipName(folder, at)).toBe('althar-report-2026-10-11-1405-2.zip')
    const report = assemble(gathered(), { text: 'It stopped', email: null, screenshot: true, logs: true })
    const name = await save(folder, report, at)
    expect(name).toBe('althar-report-2026-10-11-1405-2.zip')
    const bytes = readFileSync(join(folder, name))
    // Its first file is the report as a person reads it, deflated.
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50)
    const nameLength = bytes.readUInt16LE(26)
    expect(bytes.subarray(30, 30 + nameLength).toString()).toBe('report.txt')
    const packed = bytes.readUInt32LE(18)
    expect(inflateRawSync(bytes.subarray(30 + nameLength, 30 + nameLength + packed)).toString()).toBe(readable(report))
    // And the directory every unzipper reads lists all four.
    const end = bytes.length - 22
    expect(bytes.readUInt32LE(end)).toBe(0x06054b50)
    expect(bytes.readUInt16LE(end + 10)).toBe(4)
    const mail = new URL(mailto('reports@althar.ai', report, name))
    expect(mail.protocol).toBe('mailto:')
    expect(decodeURIComponent(mail.search)).toContain(`in Downloads as ${name}`)
    expect(decodeURIComponent(mail.search)).toContain('subject=Althar: It stopped')
  })

  it('zips what it is given', () => {
    const bytes = zip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }])
    expect(bytes.readUInt16LE(bytes.length - 22 + 8)).toBe(1)
  })
})
