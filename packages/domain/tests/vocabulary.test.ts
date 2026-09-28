import { assert, describe, it } from '@effect/vitest'
import { Predicate, Schema } from 'effect'

import * as Vocabulary from '../src/vocabulary'

const vocabularies = Object.entries(Vocabulary).flatMap(([name, value]) =>
  Schema.isSchema(value) && 'literals' in value && Array.isArray(value.literals)
    ? [{ name, words: value.literals.filter(Predicate.isString), is: Schema.is(value) }]
    : [],
)

describe('vocabulary', () => {
  it('has a list for every vocabulary', () => {
    assert.isAbove(vocabularies.length, 30)
  })

  for (const { name, words, is } of vocabularies) {
    it(`${name} holds distinct snake_case words, and nothing else`, () => {
      assert.isAbove(words.length, 1)
      assert.strictEqual(new Set(words).size, words.length)
      for (const word of words) {
        assert.match(word, /^[a-z]+(_[a-z]+)*$/)
        assert.isTrue(is(word))
      }
      assert.isFalse(is('not_a_word_in_any_list'))
    })
  }
})
