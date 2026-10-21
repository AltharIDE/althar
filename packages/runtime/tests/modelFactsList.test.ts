import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { factsIn, ModelFacts } from '../src/ModelFacts'
import { runtime, until } from './support'

/*
 * What is known of models, from the list Althar reads (ADR-015): the maker's
 * own listing over a reseller's of the same model, and a list that comes
 * back empty, which leaves the copy from last time as it was.
 */

const scored = (id: string, intelligence: number | null) => ({
  id,
  benchmarks: { artificial_analysis: { intelligence_index: intelligence, coding_index: null, agentic_index: null } },
  pricing: { prompt: '0.000001', completion: '0.000002' },
  context_length: 200_000,
})

describe('the list of models', () => {
  it('takes the maker’s listing of a model over a reseller’s, by its having scores, in either order', () => {
    const resellerFirst = factsIn({ data: [scored('reseller/large-model', null), scored('fake/large-model', 60)] })
    assert.strictEqual(resellerFirst.get('large-model')?.slug, 'fake/large-model')
    const makerFirst = factsIn({ data: [scored('fake/large-model', 60), scored('reseller/large-model', null)] })
    assert.strictEqual(makerFirst.get('large-model')?.slug, 'fake/large-model')
    // Two without scores: the first stays.
    assert.strictEqual(
      factsIn({ data: [scored('one/small-model', null), scored('two/small-model', null)] }).get('small-model')?.slug,
      'one/small-model',
    )
  })

  it.live('that comes back with no models leaves the copy from last time as it was', () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'althar-facts-')), 'model-facts.json')
    const before = { data: [scored('fake/large', 60)] }
    writeFileSync(cache, JSON.stringify(before))
    const asked: Array<string> = []
    const fetch = async (url: string) => {
      asked.push(url)
      return Response.json({ data: [] })
    }
    return Effect.gen(function* () {
      const facts = yield* ModelFacts
      yield* until(
        Effect.sync(() => asked),
        (urls) => urls.length > 0,
      )
      // Read once more after the answer: still the copy's.
      yield* Effect.sleep('50 millis')
      assert.strictEqual(facts.of({ id: 'codex', name: 'Fake codex' }, { id: 'large', name: 'Large' })?.intelligence, 60)
      assert.strictEqual(readFileSync(cache, 'utf8'), JSON.stringify(before))
    }).pipe(Effect.provide(runtime(':memory:', {}, { modelFacts: { url: 'https://openrouter.test/models', cache, fetch } })))
  })
})
