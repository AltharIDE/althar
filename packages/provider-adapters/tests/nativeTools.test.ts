import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from '@effect/vitest'
import { removeTree, waitFor } from '@althar/testing'

import { bounded, nativeCommand, nativeMcp, nativePath, nativeTools } from '../src/native/tools'

const folders: string[] = []
const folder = async () => {
  const path = await mkdtemp(join(tmpdir(), 'althar-native-tools-'))
  folders.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => removeTree(path)))
})
const signal = () => new AbortController().signal

const mcpAnswer = (method: string) =>
  method === 'initialize'
    ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'native-fixture', version: '1' } }
    : method === 'tools/list'
      ? {
          tools: [
            {
              name: 'take_picture',
              description: 'Take a fixture picture',
              inputSchema: { type: 'object' },
              annotations: { readOnlyHint: true },
            },
          ],
        }
      : {
          content: [
            { type: 'text', text: 'Picture of the page.' },
            { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
          ],
        }

describe('Althar’s native tools', () => {
  it('reads byte ranges, lists directories, replaces one exact match, and leaves no edit temporary files', async () => {
    const cwd = await folder()
    const tools = nativeTools(cwd, {})
    const tool = (name: string) => {
      const found = tools.find((tool) => tool.name === name)
      if (!found) throw new Error(name)
      return found
    }
    await tool('write_file').run({ path: 'nested/note.txt', content: 'first\nsecond\n' }, signal())
    expect(await tool('read_file').run({ path: 'nested/note.txt', offset: 6, length: 6 }, signal())).toBe('second')
    expect(await tool('list_directory').run({ path: '.' }, signal())).toBe('nested/')
    await tool('edit_file').run({ path: 'nested/note.txt', old_text: 'second', new_text: 'changed' }, signal())
    expect(await readFile(join(cwd, 'nested/note.txt'), 'utf8')).toBe('first\nchanged\n')
    await expect(tool('edit_file').run({ path: 'nested/note.txt', old_text: '', new_text: 'bad' }, signal())).rejects.toThrow('exactly one')
    await expect(tool('edit_file').run({ path: 'nested/note.txt', old_text: 'missing', new_text: 'bad' }, signal())).rejects.toThrow(
      'exactly one',
    )
    await expect(tool('write_file').run({ path: 'nested/note.txt', content: 42 }, signal())).rejects.toThrow('content')
    expect(await readdir(join(cwd, 'nested'))).toEqual(['note.txt'])
  })

  it('does not replace the original when an edit was already cancelled', async () => {
    const cwd = await folder()
    const path = join(cwd, 'note.txt')
    await writeFile(path, 'original')
    const controller = new AbortController()
    controller.abort()
    const write = nativeTools(cwd, {}).find((tool) => tool.name === 'write_file')
    await expect(write?.run({ path, content: 'replacement' }, controller.signal)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('original')
  })

  it('rejects ambiguous edits and binary reads', async () => {
    const cwd = await folder()
    await writeFile(join(cwd, 'note.txt'), 'same same')
    await writeFile(join(cwd, 'binary'), new Uint8Array([0, 1, 2]))
    const tools = nativeTools(cwd, {})
    await expect(
      tools.find((tool) => tool.name === 'edit_file')?.run({ path: 'note.txt', old_text: 'same', new_text: 'changed' }, signal()),
    ).rejects.toThrow('exactly one')
    await expect(tools.find((tool) => tool.name === 'read_file')?.run({ path: 'binary' }, signal())).rejects.toThrow('binary')
    expect(await readFile(join(cwd, 'note.txt'), 'utf8')).toBe('same same')
  })

  it.skipIf(process.platform === 'win32')('asks about the resolved symlink target and keeps names in a new directory intact', async () => {
    const cwd = await folder()
    const outside = await folder()
    await writeFile(join(outside, 'note.txt'), 'outside')
    await symlink(outside, join(cwd, 'linked'))
    expect(await nativePath(cwd, 'linked/note.txt')).toBe(join(outside, 'note.txt'))
    expect(await nativePath(cwd, 'new/nested/file.txt')).toBe(join(cwd, 'new/nested/file.txt'))
  })

  it('collects shell output and the exit status from an owned process', async () => {
    const cwd = await folder()
    const command =
      process.platform === 'win32'
        ? 'echo native-out & echo native-err 1>&2 & exit /b 7'
        : 'printf native-out; printf native-err >&2; exit 7'
    const output = await nativeCommand(cwd, command, {}, signal())
    expect(output.text).toContain('native-out')
    expect(output.text).toContain('native-err')
    expect(output.terminal?.code).toBe(7)
  })

  it('records command ownership before it starts and finalizes it after the process stops', async () => {
    const cwd = await folder()
    const seen: string[] = []
    await nativeCommand(cwd, 'echo native', {}, signal(), {
      starting: async () => {
        seen.push('starting')
        return 'tracked-process'
      },
      started: async (id, child) => {
        expect(id).toBe('tracked-process')
        expect(child.pid).toBeGreaterThan(0)
        expect(child.environmentDigest).not.toBe('')
        seen.push('started')
      },
      stopped: async (id, report) => {
        expect(id).toBe('tracked-process')
        expect(report?.survivors).toBe(false)
        seen.push('stopped')
      },
    })
    expect(seen).toEqual(['starting', 'started', 'stopped'])
  })

  it('finalizes a failed stdio launch without leaving an active process record', async () => {
    const cwd = await folder()
    const seen: string[] = []
    await expect(
      nativeMcp([{ type: 'stdio', name: 'missing', command: 'althar-native-no-such-server', args: [], env: {} }], cwd, signal(), {
        starting: async () => 'tracked-process',
        started: async () => {
          seen.push('started')
        },
        stopped: async (id, report) => {
          expect(id).toBe('tracked-process')
          expect(report).toBeUndefined()
          seen.push('stopped')
        },
      }),
    ).rejects.toThrow()
    expect(seen).toEqual(['stopped'])
  })

  it('passes MCP text and images separately and closes an HTTP server connection', async () => {
    const cwd = await folder()
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      let data = ''
      for await (const chunk of request) data += String(chunk)
      const value = JSON.parse(data) as { id?: number; method: string }
      if (value.id === undefined) {
        response.writeHead(202).end()
        return
      }
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: mcpAnswer(value.method) }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test address')
    try {
      const mcp = await nativeMcp([{ type: 'http', name: 'fixture', url: `http://127.0.0.1:${address.port}`, headers: {} }], cwd, signal())
      try {
        const tool = mcp.tools[0]
        expect(tool?.name).toBe('mcp__fixture__take_picture')
        expect(tool?.modelName).toMatch(/^mcp_[a-f0-9]{32}$/)
        expect(tool?.writes).toBe(false)
        expect(await tool?.run({}, signal())).toEqual({
          text: 'Picture of the page.',
          images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
        })
      } finally {
        await mcp.close()
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('owns a stdio MCP process for its whole lifetime', async () => {
    const cwd = await folder()
    const script = join(cwd, 'server.cjs')
    const pidFile = join(cwd, 'server.pid')
    await writeFile(
      script,
      `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); let input = ''; process.stdin.on('data', chunk => { input += chunk; let at; while ((at = input.indexOf('\\n')) >= 0) { const line = input.slice(0, at); input = input.slice(at + 1); const value = JSON.parse(line); if (value.id === undefined) continue; const result = (${mcpAnswer.toString()})(value.method); process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:value.id, result}) + '\\n'); } });`,
    )
    const controller = new AbortController()
    const mcp = await nativeMcp(
      [{ type: 'stdio', name: 'fixture', command: process.execPath, args: [script], env: {} }],
      cwd,
      controller.signal,
    )
    const pid = Number(await readFile(pidFile, 'utf8'))
    expect(await mcp.tools[0]?.run({}, signal())).toMatchObject({ text: 'Picture of the page.' })
    await mcp.close()
    await waitFor(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    }, Boolean)
  })

  it('truncates long output, refuses edits too large for one change, and lists files without a slash', async () => {
    const cwd = await folder()
    expect(bounded('x'.repeat(70_000))).toMatch(/^x{64000}\n\[Output truncated/)
    const tools = nativeTools(cwd, {})
    const tool = (name: string) => {
      const found = tools.find((tool) => tool.name === name)
      if (!found) throw new Error(name)
      return found
    }
    const huge = 'x'.repeat(4_000_001)
    await expect(tool('write_file').run({ path: 'huge.txt', content: huge }, signal())).rejects.toThrow('too large')
    await writeFile(join(cwd, 'huge.txt'), huge)
    await expect(tool('edit_file').run({ path: 'huge.txt', old_text: 'x', new_text: 'y' }, signal())).rejects.toThrow('too large')
    expect(await tool('list_directory').run({ path: '.' }, signal())).toBe('huge.txt')
  })

  it.skipIf(process.platform === 'win32')('refuses a path under a file rather than guessing where it goes', async () => {
    const cwd = await folder()
    await writeFile(join(cwd, 'file.txt'), 'a file')
    await expect(nativePath(cwd, 'file.txt/inside')).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it.skipIf(process.platform === 'win32')('says which signal stopped a command', async () => {
    const output = await nativeCommand(await folder(), 'kill -9 $$', {}, signal())
    expect(output.terminal).toMatchObject({ code: null, signal: 'SIGKILL' })
    expect(output.text).toContain('[Exit SIGKILL]')
  })

  it('pages through MCP tools, and reads resources, structured results, failures and too many images', async () => {
    const cwd = await folder()
    const image = { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }
    const results: Record<string, unknown> = {
      described: {
        content: [{ type: 'resource', resource: { uri: 'file:///note', text: 'A note' } }],
        structuredContent: { count: 2 },
      },
      failing: { content: [{ type: 'text', text: 'It broke.' }], isError: true },
      silent: { content: [], isError: true },
      pictures: { content: [image, image, image, image, image] },
    }
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      let data = ''
      for await (const chunk of request) data += String(chunk)
      const value = JSON.parse(data) as { id?: number; method: string; params?: { cursor?: string; name?: string } }
      if (value.id === undefined) {
        response.writeHead(202).end()
        return
      }
      const result =
        value.method === 'tools/list'
          ? value.params?.cursor === 'next'
            ? { tools: ['failing', 'silent', 'pictures'].map((name) => ({ name, inputSchema: { type: 'object' } })) }
            : { tools: [{ name: 'described', description: 'Described', inputSchema: { type: 'object' } }], nextCursor: 'next' }
          : value.method === 'tools/call'
            ? results[value.params?.name ?? '']
            : mcpAnswer(value.method)
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test address')
    try {
      const mcp = await nativeMcp([{ type: 'http', name: 'paged', url: `http://127.0.0.1:${address.port}`, headers: {} }], cwd, signal())
      try {
        expect(mcp.tools.map((tool) => [tool.name, tool.description, tool.writes])).toEqual([
          ['mcp__paged__described', 'Described', true],
          ['mcp__paged__failing', 'failing', true],
          ['mcp__paged__silent', 'silent', true],
          ['mcp__paged__pictures', 'pictures', true],
        ])
        const run = (index: number) => mcp.tools[index]?.run({}, signal())
        expect(await run(0)).toEqual({
          text: `${JSON.stringify({ type: 'resource', resource: { uri: 'file:///note', text: 'A note' } })}\n{"count":2}`,
          images: [],
        })
        await expect(run(1)).rejects.toThrow('It broke.')
        await expect(run(2)).rejects.toThrow('reported a failure')
        await expect(run(3)).rejects.toThrow('too many or oversized images')
      } finally {
        await mcp.close()
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('gives a stdio MCP server the work file, and nothing else of the session’s environment', async () => {
    const cwd = await folder()
    const script = join(cwd, 'server.cjs')
    const seen = join(cwd, 'seen.json')
    await writeFile(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ work: process.env.ALTHAR_WORK, other: process.env.ALTHAR_OTHER ?? null })); let input = ''; process.stdin.on('data', chunk => { input += chunk; let at; while ((at = input.indexOf('\\n')) >= 0) { const line = input.slice(0, at); input = input.slice(at + 1); const value = JSON.parse(line); if (value.id === undefined) continue; const result = (${mcpAnswer.toString()})(value.method); process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:value.id, result}) + '\\n'); } });`,
    )
    const mcp = await nativeMcp(
      [{ type: 'stdio', name: 'fixture', command: process.execPath, args: [script], env: {} }],
      cwd,
      signal(),
      undefined,
      { ALTHAR_WORK: join(cwd, 'work.md'), ALTHAR_OTHER: 'kept out' },
    )
    try {
      expect(JSON.parse(await readFile(seen, 'utf8'))).toEqual({ work: join(cwd, 'work.md'), other: null })
    } finally {
      await mcp.close()
    }
  })
})
