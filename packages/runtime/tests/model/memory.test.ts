import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Effect } from 'effect'
import { memoryEmbeddings } from '../../src/memoryEmbeddings'
import { semanticMemory } from '../../src/memoryVectors'
import { memoryBrief, searchMemory } from '../../src/memory'
import { addItem } from '../../src/threads'
import { Projects } from '../../src/Projects'
import * as Runtime from '../../src/Runtime'
import { runtime, task } from '../support'

const examples = [
  [
    'Serializing checkout writes still hangs. Lock inversion is unconfirmed. Next inspect acquire ordering.',
    'purchase flow freezes under concurrent requests',
  ],
  [
    'The login cookie expired immediately because server clock was ahead. Session persistence needs a clock-skew test.',
    'users get signed out right after authentication',
  ],
  [
    'Image uploads exhausted heap space. Streaming chunks reduced peak RAM; large attachments remain untested.',
    'prevent memory crashes when sending huge photos',
  ],
  ['Invoice rounding lost fractional cents. Integer minor units fixed the billing discrepancy.', 'customer charges differ by pennies'],
  [
    'Keyboard focus escapes the modal dialog. Tab navigation must stay within the overlay until dismissed.',
    'accessibility issue moving between popup controls',
  ],
  [
    'Worker retries delivered the same webhook twice. Deduplication must use the event identifier.',
    'avoid repeated notifications after background job failures',
  ],
  [
    'The migration removed a column still referenced by the previous application version. Rolling upgrades need backward-compatible schemas.',
    'database changes break old servers during deployment',
  ],
  [
    'The certificate expired, so TLS negotiation failed. Rotating the credential restored encrypted connections.',
    'secure transport stopped after the identity document became invalid',
  ],
] as const
const embed = memoryEmbeddings(process.env.ALTHAR_MEMORY_MODEL_CACHE ?? join(tmpdir(), 'althar-memory-model-cache'))

describe('real local semantic memory model', () => {
  it.live(
    'retrieves differently worded prior tasks among unrelated work without source hints',
    () =>
      Effect.gen(function* () {
        const { project } = yield* task('Semantic evaluation')
        const projects = yield* Projects
        const ids: string[] = []
        for (const [text] of examples) {
          const created = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: project.projectId,
            title: `Investigation ${ids.length}`,
          })
          yield* addItem({ projectId: project.projectId as ProjectId, threadId: created.threadId }, 'agent_message', { text })
          ids.push(created.threadId)
        }
        const started = Date.now()
        for (const [index, [, query]] of examples.entries()) {
          const selected = yield* semanticMemory(project.projectId, query, embed)
          assert.strictEqual(selected.threadIds[0], ids[index], `Wrong top result for ${query}`)
          assert.strictEqual(selected.pending, 0)
        }
        for (const query of ['Which telescope observed a distant supernova?', 'How long should sourdough rise?'])
          assert.deepStrictEqual((yield* semanticMemory(project.projectId, query, embed)).threadIds, [], query)
        assert.deepStrictEqual((yield* searchMemory(project.projectId, examples[0][1])).entries, [])
        const selected = yield* semanticMemory(project.projectId, examples[0][1], embed)
        const brief = yield* memoryBrief(project.projectId, examples[0][1], undefined, selected)
        assert.include(brief, 'Lock inversion is unconfirmed')
        process.stdout.write(
          `Real local model: ${examples.length}/${examples.length} top-1 retrievals, 2/2 unrelated-query abstentions; first indexing + queries ${Date.now() - started} ms`,
        )
      }).pipe(Effect.provide(runtime(join(mkdtempSync(join(tmpdir(), 'althar-memory-eval-')), 'state.db')))),
    120000,
  )
})
