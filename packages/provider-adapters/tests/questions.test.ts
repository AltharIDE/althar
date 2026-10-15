import { assert, describe, it } from '@effect/vitest'

import { type Question, questionContent, questionFields, saidOf, takesWords } from '../src/questions'

describe('questions', () => {
  it("reads Codex's form: the question as the title, the header as the description, and a note for the person's words", () => {
    const fields = questionFields(
      {
        type: 'object',
        properties: {
          storage: {
            type: 'string',
            title: 'Where should uploads be kept?',
            description: 'Storage',
            oneOf: [
              { const: 'S3', title: 'S3' },
              { const: 'Disk', title: 'Disk', description: 'on the app server' },
              { const: 'None of the above', title: 'None of the above' },
            ],
          },
          storage_note: { type: 'string' },
        },
        required: ['storage'],
      },
      'Codex needs your input to continue.',
    )
    assert.deepStrictEqual(fields, [
      {
        id: 'storage',
        question: 'Where should uploads be kept?',
        header: 'Storage',
        required: true,
        wordsField: 'storage_note',
        type: 'choice',
        options: [
          { value: 'S3', label: 'S3' },
          { value: 'Disk', label: 'Disk', note: 'on the app server' },
          { value: 'None of the above', label: 'None of the above' },
        ],
        multiple: false,
      },
    ])
  })

  it('reads plain words, numbers and yes or no, and leaves out what it cannot ask', () => {
    const fields = questionFields(
      {
        properties: {
          name: { type: 'string', title: 'What should the branch be called?' },
          retries: { type: 'integer', description: 'How many retries?' },
          seed: { type: 'boolean', title: 'Seed', description: 'Seed the database first?' },
          shape: { type: 'object' },
          stray: 'not a field',
        },
      },
      'A few things first.',
    )
    assert.deepStrictEqual(
      fields.map((field) => [field.id, field.type, field.question, field.header ?? null, field.required, takesWords(field)]),
      [
        ['name', 'text', 'What should the branch be called?', null, false, true],
        ['retries', 'number', 'How many retries?', null, false, true],
        ['seed', 'boolean', 'Seed the database first?', 'Seed', false, false],
      ],
    )
    assert.deepStrictEqual(fields[2]?.options, [
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ])
  })

  it('asks what the message asks when a lone field has no question of its own', () => {
    assert.deepStrictEqual(
      questionFields({ properties: { choice: { type: 'string', title: 'Region', enum: ['eu', 'us'] } } }, 'Which region?').map((field) => [
        field.question,
        field.header,
      ]),
      [['Which region?', 'Region']],
    )
    assert.strictEqual(questionFields({ properties: { choice: { type: 'string' } } }, 'Which region?')[0]?.question, 'Which region?')
    // With several, a field with no words of its own is named by its key.
    assert.deepStrictEqual(
      questionFields({ properties: { a: { type: 'string' }, b: { type: 'string', title: 'Bee' } } }, 'Two things.').map(
        (field) => field.question,
      ),
      ['a', 'Bee'],
    )
    // Of a title and a description, neither asking, the longer is the question.
    assert.strictEqual(
      questionFields({ properties: { a: { type: 'string', title: 'Cache', description: 'The cache backend to use' } } }, '')[0]?.question,
      'The cache backend to use',
    )
    assert.deepStrictEqual(questionFields(null, 'Nothing'), [])
  })

  it("keeps a words field apart only beside a choice: a lone '_note' is a question of its own", () => {
    const fields = questionFields(
      { properties: { release_note: { type: 'string', title: 'What should the release note say?' } } },
      'One thing.',
    )
    assert.deepStrictEqual(
      fields.map((field) => [field.id, field.type]),
      [['release_note', 'text']],
    )
  })

  it("puts the person's answers in the form's fields, and says them in words", () => {
    const question: Question = {
      message: 'A few things first.',
      fields: questionFields(
        {
          properties: {
            db: { type: 'string', description: 'Which database?', oneOf: [{ const: 'pg', title: 'Postgres' }] },
            db_custom: { type: 'string', title: 'Other' },
            checks: { type: 'array', description: 'Which checks?', items: { enum: ['unit', 'lint'] } },
            retries: { type: 'number', description: 'How many retries?' },
            seed: { type: 'boolean', description: 'Seed it?' },
            name: { type: 'string', description: 'What name?' },
          },
        },
        'A few things first.',
      ),
    }
    assert.deepStrictEqual(
      questionContent(question, {
        db: { values: ['pg', 'made up'], words: ' and keep it local ' },
        checks: { values: ['unit', 'lint'] },
        retries: { values: [], words: '3' },
        seed: { values: ['false'] },
        name: { values: [], words: 'cache-db' },
      }),
      { db: 'pg', db_custom: 'and keep it local', checks: ['unit', 'lint'], retries: 3, seed: false, name: 'cache-db' },
    )
    // Nothing said, nothing sent: no picks, no words, a number that isn't one.
    assert.deepStrictEqual(
      questionContent(question, {
        db: { values: [] },
        checks: { values: [] },
        retries: { values: [], words: 'three' },
        seed: { values: [] },
        name: { values: [], words: '  ' },
      }),
      {},
    )
    const [db, checks] = question.fields
    assert.strictEqual(db && saidOf(db, { values: ['pg'], words: 'and keep it local' }), 'Postgres, and keep it local')
    assert.strictEqual(checks && saidOf(checks, { values: ['unit', 'gone'] }), 'unit')
  })
})
