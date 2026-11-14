import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import { Deferred, Effect, Exit, Scope } from 'effect'

import type { McpServer } from '../AgentConnection'
import { spawnOwned } from '../process'
import type { OwnedProcess } from '../process'
import type { LaunchSpec } from '../registry'
import type { StopReport } from '../processTrees'
import { cleanUp } from '../removal'

export interface NativeTool {
  readonly name: string
  readonly modelName?: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly kind: 'read' | 'edit' | 'execute' | 'search' | 'other'
  readonly path?: (input: Record<string, unknown>) => Promise<string>
  readonly writes?: boolean
  run(input: Record<string, unknown>, signal: AbortSignal): Promise<string | NativeToolResult>
}

export interface NativeToolResult {
  readonly text: string
  readonly images: ReadonlyArray<{ readonly data: string; readonly mimeType: string }>
  readonly terminal?: { readonly code: number | null; readonly signal: string | null }
}

/** The runtime records children before launch and keeps their OS identity for crash reconciliation. */
export interface NativeProcessHooks {
  starting(command: string): Promise<string>
  started(id: string, process: Pick<OwnedProcess, 'pid' | 'osStartedAt' | 'environmentDigest'>): Promise<void>
  stopped(id: string, report?: StopReport): Promise<void>
}

const spawnNative = (spec: LaunchSpec, cwd: string, hooks?: NativeProcessHooks) =>
  Effect.gen(function* () {
    const id = hooks ? yield* Effect.tryPromise({ try: () => hooks.starting(spec.command), catch: (error) => error }) : undefined
    let child: OwnedProcess | undefined
    // Registered first: the owned process is stopped before its final state is recorded.
    if (hooks && id)
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const report = child ? yield* Deferred.await(child.stopped) : undefined
          yield* Effect.tryPromise({ try: () => hooks.stopped(id, report), catch: (error) => error }).pipe(
            Effect.catch(() => Effect.logWarning('Could not record a native agent child’s final state.')),
          )
        }),
      )
    child = yield* spawnOwned(spec, cwd, { background: true })
    if (hooks && id) {
      const launched = child
      yield* Effect.tryPromise({ try: () => hooks.started(id, launched), catch: (error) => error })
    }
    return child
  })

const string = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]
  if (typeof value !== 'string') throw new Error(`Expected ${key} to be text.`)
  return value
}
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const text = { type: 'string' }
const LIMIT = 64_000
export const bounded = (value: string) =>
  value.length <= LIMIT ? value : `${value.slice(0, LIMIT)}\n[Output truncated; request a smaller range.]`

const atomicWrite = async (path: string, content: string, signal: AbortSignal) => {
  signal.throwIfAborted()
  if (content.length > 4_000_000) throw new Error('This file is too large for a single edit.')
  const temporary = join(dirname(path), `.althar-${randomUUID()}.tmp`)
  const mode = await stat(path).then(
    (value) => value.mode & 0o777,
    () => 0o666,
  )
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(temporary, content, { encoding: 'utf8', signal, flag: 'wx', mode })
    signal.throwIfAborted()
    await rename(temporary, path)
  } finally {
    await Effect.runPromise(cleanUp(temporary, 'a native agent’s temporary edit'))
  }
}

/** Resolve symlinks before asking permission, including the parent of a file being created. */
export const nativePath = async (cwd: string, input: string): Promise<string> => {
  const path = isAbsolute(input) ? resolve(input) : resolve(cwd, input)
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return join(await nativePath(cwd, dirname(path)), basename(path))
  }
}

/** Each shell command is an owned process group; aborting the tool closes its scope and stops the whole tree. */
export const nativeCommand = (
  cwd: string,
  command: string,
  env: Readonly<Record<string, string>>,
  signal: AbortSignal,
  hooks?: NativeProcessHooks,
): Promise<NativeToolResult> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const shell =
          process.platform === 'win32'
            ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command], verbatim: true as const }
            : { command: '/bin/sh', args: ['-c', command] }
        const child = yield* spawnNative({ ...shell, env }, cwd, hooks)
        yield* Effect.promise(async () => {
          const writer = child.stdin.getWriter()
          try {
            await writer.close().catch(() => undefined)
          } finally {
            writer.releaseLock()
          }
        })
        const output = yield* Effect.tryPromise({
          try: async (abort) => {
            const reader = child.stdout.getReader()
            const decoder = new TextDecoder()
            let output = ''
            const stop = () => {
              void reader.cancel().catch(() => undefined)
            }
            abort.addEventListener('abort', stop, { once: true })
            try {
              for (;;) {
                const chunk = await reader.read()
                if (chunk.done) break
                output = bounded(output + decoder.decode(chunk.value, { stream: true }))
              }
              return output + decoder.decode()
            } finally {
              abort.removeEventListener('abort', stop)
              reader.releaseLock()
            }
          },
          catch: (error) => error,
        })
        const exit = yield* Deferred.await(child.exited)
        const stderr = child.stderrTail()
        return {
          text: bounded(`${output}${stderr === '' ? '' : `\n${stderr}`}\n[Exit ${exit.code ?? exit.signal ?? 'unknown'}]`),
          images: [],
          terminal: exit,
        }
      }),
    ),
    { signal },
  )

export const nativeTools = (cwd: string, env: Readonly<Record<string, string>>, hooks?: NativeProcessHooks): NativeTool[] => {
  const path = (input: Record<string, unknown>) => nativePath(cwd, string(input, 'path'))
  return [
    {
      name: 'read_file',
      description: 'Read a UTF-8 file. Offset and length are byte ranges; use them for a large file.',
      kind: 'read',
      path,
      inputSchema: schema(
        { path: text, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: LIMIT } },
        ['path'],
      ),
      run: async (input, signal) => {
        const file = await path(input)
        const offset = typeof input.offset === 'number' && Number.isSafeInteger(input.offset) ? Math.max(0, input.offset) : 0
        const length =
          typeof input.length === 'number' && Number.isSafeInteger(input.length) ? Math.max(1, Math.min(LIMIT, input.length)) : LIMIT
        signal.throwIfAborted()
        const handle = await open(file, 'r')
        try {
          const buffer = Buffer.alloc(length)
          const { bytesRead } = await handle.read(buffer, 0, length, offset)
          signal.throwIfAborted()
          if (buffer.subarray(0, bytesRead).includes(0)) throw new Error('This file contains binary data; use an image or artifact tool.')
          return buffer.toString('utf8', 0, bytesRead)
        } finally {
          await handle.close()
        }
      },
    },
    {
      name: 'list_directory',
      description: 'List a directory’s files and folders.',
      kind: 'read',
      path,
      inputSchema: schema({ path: text }, ['path']),
      run: async (input) =>
        bounded(
          (await readdir(await path(input), { withFileTypes: true }))
            .slice(0, 1000)
            .map((item) => `${item.name}${item.isDirectory() ? '/' : ''}`)
            .join('\n'),
        ),
    },
    {
      name: 'write_file',
      description: 'Create or replace a UTF-8 file. Read existing files first.',
      kind: 'edit',
      path,
      writes: true,
      inputSchema: schema({ path: text, content: text }, ['path', 'content']),
      run: async (input, signal) => {
        const file = await path(input)
        await atomicWrite(file, string(input, 'content'), signal)
        return `Wrote ${file}`
      },
    },
    {
      name: 'edit_file',
      description: 'Replace one exact occurrence in an existing UTF-8 file. Refuses ambiguous matches.',
      kind: 'edit',
      path,
      writes: true,
      inputSchema: schema({ path: text, old_text: text, new_text: text }, ['path', 'old_text', 'new_text']),
      run: async (input, signal) => {
        const file = await path(input)
        if ((await stat(file)).size > 4_000_000) throw new Error('This file is too large for a single edit.')
        const before = await readFile(file, { encoding: 'utf8', signal })
        const old = string(input, 'old_text')
        const at = before.indexOf(old)
        if (old === '' || at < 0 || before.indexOf(old, at + old.length) >= 0)
          throw new Error('The text must match exactly one place. Read the file again.')
        await atomicWrite(file, before.slice(0, at) + string(input, 'new_text') + before.slice(at + old.length), signal)
        return `Edited ${file}`
      },
    },
    {
      name: 'run_command',
      description:
        'Run a shell command in the session’s working directory. A command has its own shell; cd does not carry into the next call.',
      kind: 'execute',
      writes: true,
      inputSchema: schema({ command: text }, ['command']),
      run: (input, signal) => nativeCommand(cwd, string(input, 'command'), env, signal, hooks),
    },
  ]
}

/** MCP stdio uses the same owned process groups as agent and shell processes. */
const stdio = async (
  server: Extract<McpServer, { command: string }>,
  cwd: string,
  hooks?: NativeProcessHooks,
  env: Readonly<Record<string, string>> = {},
) => {
  const scope = Effect.runSync(Scope.make())
  const child = await Effect.runPromise(
    spawnNative(
      { command: server.command, args: server.args, env: { ...server.env, ...(env.ALTHAR_WORK ? { ALTHAR_WORK: env.ALTHAR_WORK } : {}) } },
      cwd,
      hooks,
    ).pipe(Scope.provide(scope)),
  ).catch(async (error: unknown) => {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    throw error
  })
  const writer = child.stdin.getWriter()
  let stopped = false
  const transport: Transport = {
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    start: async () => {
      const read = async () => {
        const reader = child.stdout.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            pending += decoder.decode(chunk.value, { stream: true })
            if (pending.length > 4_000_000) throw new Error('MCP response exceeded the message limit.')
            let end = pending.indexOf('\n')
            while (end >= 0) {
              const line = pending.slice(0, end).trim()
              pending = pending.slice(end + 1)
              if (line !== '') transport.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(line)))
              end = pending.indexOf('\n')
            }
          }
        } catch (error) {
          if (!stopped) transport.onerror?.(error instanceof Error ? error : new Error('MCP transport failed.'))
        } finally {
          reader.releaseLock()
          await transport.close()
          transport.onclose?.()
        }
      }
      void read()
    },
    send: async (message) => {
      await writer.write(new TextEncoder().encode(`${JSON.stringify(message)}\n`))
    },
    close: async () => {
      if (stopped) return
      stopped = true
      await Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
  return transport
}

export const nativeMcp = async (
  servers: ReadonlyArray<McpServer>,
  cwd: string,
  signal: AbortSignal,
  hooks?: NativeProcessHooks,
  env: Readonly<Record<string, string>> = {},
) => {
  const clients: Client[] = []
  const tools: NativeTool[] = []
  const close = async () => {
    await Promise.allSettled(clients.map((client) => client.close()))
  }
  signal.addEventListener(
    'abort',
    () => {
      void close()
    },
    { once: true },
  )
  try {
    for (const server of servers) {
      signal.throwIfAborted()
      const client = new Client({ name: 'Althar', version: '1' })
      clients.push(client)
      const transport =
        'command' in server
          ? await stdio(server, cwd, hooks, env)
          : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } })
      await client.connect(transport, { signal })
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor === undefined ? {} : { cursor }, { signal })
        for (const tool of page.tools)
          tools.push({
            name: `mcp__${server.name}__${tool.name}`,
            modelName: `mcp_${createHash('sha256').update(`${server.name}\0${tool.name}`).digest('hex').slice(0, 32)}`,
            description: tool.description ?? tool.name,
            inputSchema: tool.inputSchema,
            kind: 'other',
            writes: tool.annotations?.readOnlyHint !== true,
            run: async (input, abort) => {
              const result = await client.callTool({ name: tool.name, arguments: input }, undefined, { signal: abort })
              const text: string[] = []
              const images: Array<{ data: string; mimeType: string }> = []
              for (const raw of Array.isArray(result.content) ? result.content : []) {
                if (typeof raw !== 'object' || raw === null) continue
                const item = raw as Record<string, unknown>
                if (item.type === 'text' && typeof item.text === 'string') text.push(item.text)
                else if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string') {
                  if (item.data.length > 28_000_000 || images.length >= 4)
                    throw new Error('This tool returned too many or oversized images.')
                  images.push({ data: item.data, mimeType: item.mimeType })
                } else text.push(JSON.stringify(item))
              }
              if (result.structuredContent !== undefined) text.push(JSON.stringify(result.structuredContent))
              const output = bounded(text.join('\n'))
              if (result.isError === true) throw new Error(output || 'The MCP tool reported a failure.')
              return { text: output, images }
            },
          })
        cursor = page.nextCursor
      } while (cursor !== undefined)
    }
    return { tools, close }
  } catch (error) {
    await close()
    throw error
  }
}
