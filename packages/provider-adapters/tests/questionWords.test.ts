import { assert, describe, it } from '@effect/vitest'

import { answerWords, type Question, questionContent, questionFields } from '../src/questions'

/*
 * Forms that give less than Claude Code's and Codex's do: options without a
 * value or a title, several picks with nothing to pick from. And what the
 * person said, question by question, for an agent told afterwards.
 */

describe('questions, said back', () => {
  it('leaves out an option without a value, and names one without a title by its value', () => {
    const [field] = questionFields(
      {
        properties: {
          region: {
            type: 'string',
            title: 'Which region should it deploy to?',
            anyOf: [{ const: 'eu-west-1' }, { title: 'No value' }, { const: 7, title: 'A number' }, 'stray'],
          },
        },
      },
      'One thing.',
    )
    assert.deepStrictEqual(field?.options, [{ value: 'eu-west-1', label: 'eu-west-1' }])
  })

  it('offers nothing to pick for several picks that say nothing of their options', () => {
    const [field] = questionFields({ properties: { checks: { type: 'array', description: 'Which checks?' } } }, 'One thing.')
    assert.deepInclude(field, { type: 'choice', options: [], multiple: true })
  })

  it('says what the person answered to each question, and which they left', () => {
    const question: Question = {
      message: 'A few things first.',
      fields: questionFields(
        {
          properties: {
            db: { type: 'string', description: 'Which database?', oneOf: [{ const: 'pg', title: 'Postgres' }] },
            db_custom: { type: 'string', title: 'Other' },
            name: { type: 'string', description: 'What name?' },
            seed: { type: 'boolean', description: 'Seed it?' },
          },
        },
        'A few things first.',
      ),
    }
    const answers = { db: { values: ['pg'], words: 'kept local' }, name: { values: [], words: '  ' } }
    assert.deepStrictEqual(answerWords(question.fields, answers), [
      'Which database? Postgres, kept local',
      'What name? (no answer)',
      'Seed it? (no answer)',
    ])
    // A question with nothing said at all goes to the agent as nothing.
    assert.deepStrictEqual(questionContent(question, answers), { db: 'pg', db_custom: 'kept local' })
  })
})
