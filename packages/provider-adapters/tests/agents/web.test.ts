import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

import { assert, it } from '@effect/vitest'
import { Effect, Ref, Stream } from 'effect'

import { connect } from '../../src/AgentConnection'
import { agents } from '../../src/registry'

// Opt-in, signed-in probes: only public URLs, in an empty scratch repository.
for (const id of ['claude-code', 'codex', 'opencode'] as const) {
  it.live(`${id} searches and fetches a public page without a permission request`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const definition = agents[id]
        const cwd = mkdtempSync(join(tmpdir(), 'althar-public-web-'))
        writeFileSync(join(cwd, 'AGENTS.md'), 'This is an empty public web probe. Do not read files or run shell commands.\n')
        const options = { web: true }
        const spec = definition.launch(process.execPath)
        const own = definition.withoutOwnTools?.({ env: process.env, homeDir: homedir(), cwd }) ?? {}
        const asked = yield* Ref.make<string[]>([])
        const connection = yield* connect({
          transport: {
            _tag: 'Process',
            cwd,
            spec: { ...spec, env: { ...spec.env, ...own, ...definition.sessionEnv?.({ ...spec.env, ...own }, options) } },
          },
          permissions: definition.permissions,
          onPermission: (request) =>
            Ref.update(asked, (calls) => [...calls, request.title]).pipe(
              Effect.as({ decision: 'reject' as const, reason: 'This probe permits no permission requests.' }),
            ),
        })
        const session = yield* connection.newSession({
          cwd,
          mode: definition.modes.ask,
          modeOptionId: definition.options.mode,
          ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', options) }),
        })
        const events = yield* Stream.runCollect(
          session.prompt(
            'Use your native web search tool to search for IANA example domains. Then use your native web fetch or page-open tool to read https://example.com/. Do both operations, not just search. Do not use the shell or read local files. Reply with the page heading and one sentence from the page.',
          ),
        )
        const tools = events.filter((event) => event._tag === 'ToolCall')
        const text = events
          .filter((event) => event._tag === 'AgentMessage')
          .map((event) => event.text)
          .join('')
        process.stdout.write(
          `${id}: tools=${JSON.stringify(tools.map((event) => ({ title: event.title, kind: event.kind })))}; permission requests=${JSON.stringify(yield* Ref.get(asked))}; reply=${text.slice(-700)}\n`,
        )
        assert.isEmpty(yield* Ref.get(asked))
        const native = tools.filter((tool) => tool.kind === 'fetch' || tool.kind === 'search' || tool.title === 'websearch')
        assert.isAtLeast(native.length, 2, 'must actually search and open the page')
        assert.isTrue(
          events.some((event) => 'rawInput' in event && JSON.stringify(event.rawInput)?.includes('https://example.com')),
          'must call a tool with the public page URL',
        )
        assert.match(text, /Example Domain/i)
        assert.strictEqual(events.at(-1)?._tag, 'TurnEnded')
      }),
    ),
  )
}
