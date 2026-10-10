/*
 * A question an agent asks the person, read from the form it sends (ACP
 * elicitation) into Althar's own terms, and the person's answer put back into
 * the form's. Agents shape their forms differently (docs/architecture/03):
 *
 * - Claude Code's AskUserQuestion sends one field per question, titled by a
 *   short header with the question as its description, its options as
 *   `oneOf` (or an array for several picks), and a `<field>_custom` field
 *   for an answer in the person's own words.
 * - Codex's request_user_input titles each field by its question with the
 *   header as its description, and adds `<field>_note` for the words.
 * - Other forms (an MCP server's, say) have plain strings, numbers, yes or
 *   no, and choices given as `enum`.
 *
 * A header is a short name (both agents cap it at a few words), so of a
 * field's title and description the question is the one that asks, or else
 * the longer.
 */

/** One option of a choice, by the value the agent wants back. */
export interface QuestionChoice {
  readonly value: string
  readonly label: string
  /** What the agent says it implies. */
  readonly note?: string | undefined
}

/** One thing the agent asks, as a field of its form. */
export interface QuestionField {
  /** The form's key for it. */
  readonly id: string
  readonly question: string
  /** A short name the agent gave it: "Database". */
  readonly header?: string | undefined
  /** A choice of the agent's options, words, a number, or yes or no. */
  readonly type: 'choice' | 'text' | 'number' | 'boolean'
  /** The options of a choice; Yes and No for yes or no. */
  readonly options: ReadonlyArray<QuestionChoice>
  /** Several options may be picked. */
  readonly multiple: boolean
  /** The form's field for an answer in the person's own words, beside a choice, where the agent gave one. */
  readonly wordsField?: string | undefined
  readonly required: boolean
}

/** A question the agent asks the person, such as Claude's AskUserQuestion, with what it asks field by field. */
export interface Question {
  readonly sessionId?: string
  /** The agent's tool call the question stands for, where it said. */
  readonly toolCallId?: string
  /** What the agent said with it. */
  readonly message: string
  readonly fields: ReadonlyArray<QuestionField>
}

export type QuestionContent = Readonly<Record<string, string | number | boolean | ReadonlyArray<string>>>

export type QuestionAnswer =
  | { readonly action: 'accept'; readonly content: QuestionContent }
  | { readonly action: 'decline' }
  | { readonly action: 'cancel' }

/** What the person said to one field: the options picked, by value, and any words of their own. */
export interface FieldAnswer {
  readonly values: ReadonlyArray<string>
  readonly words?: string | undefined
}

type Schema = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value)

const stringOf = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/** Options given as `oneOf` / `anyOf` (titled) or `enum` (bare values). */
const choicesOf = (schema: Schema): ReadonlyArray<QuestionChoice> | undefined => {
  const titled = Array.isArray(schema['oneOf']) ? schema['oneOf'] : Array.isArray(schema['anyOf']) ? schema['anyOf'] : undefined
  if (titled !== undefined)
    return titled.filter(isRecord).flatMap((option) => {
      const value = typeof option['const'] === 'string' ? option['const'] : undefined
      if (value === undefined) return []
      const note = stringOf(option['description'])
      return [{ value, label: stringOf(option['title']) ?? value, ...(note === undefined ? {} : { note }) }]
    })
  if (Array.isArray(schema['enum']))
    return schema['enum'].filter((value): value is string => typeof value === 'string').map((value) => ({ value, label: value }))
  return undefined
}

const asks = (text: string) => text.trimEnd().endsWith('?')

/** The question and its short name, from a field's title and description. */
const wordingOf = (id: string, schema: Schema, message: string, alone: boolean) => {
  const title = stringOf(schema['title'])
  const description = stringOf(schema['description'])
  if (title !== undefined && description !== undefined) {
    const titleAsks = asks(title) && !asks(description)
    const question = titleAsks || (!asks(description) && title.length > description.length) ? title : description
    return { question, header: question === title ? description : title }
  }
  // A lone field with no question of its own asks what the message asks.
  const only = title ?? description
  if (only === undefined) return { question: alone ? message : id }
  return alone && !asks(only) && asks(message) ? { question: message, header: only } : { question: only }
}

/** The fields a form asks for, in its order, each word field beside the choice it belongs to. */
export const questionFields = (requestedSchema: unknown, message: string): ReadonlyArray<QuestionField> => {
  const schema = isRecord(requestedSchema) ? requestedSchema : {}
  const properties = isRecord(schema['properties']) ? schema['properties'] : {}
  const required = Array.isArray(schema['required']) ? schema['required'].filter((key): key is string => typeof key === 'string') : []
  const entries = Object.entries(properties).filter((entry): entry is [string, Schema] => isRecord(entry[1]))
  const plainText = (property: Schema) => property['type'] === 'string' && choicesOf(property) === undefined
  // `<field>_custom` (Claude) or `<field>_note` (Codex) beside a choice is that choice's words.
  const wordsFor = new Map<string, string>()
  for (const [key, property] of entries) {
    const match = /^(.+)_(custom|note)$/.exec(key)
    const owner = match?.[1]
    if (owner === undefined || !plainText(property)) continue
    const of = properties[owner]
    if (isRecord(of) && (choicesOf(of) !== undefined || isRecord(of['items']))) wordsFor.set(owner, key)
  }
  const words = new Set(wordsFor.values())
  const asked = entries.filter(([key]) => !words.has(key))
  return asked.flatMap(([id, property]): ReadonlyArray<QuestionField> => {
    const wording = wordingOf(id, property, message, asked.length === 1)
    const words = wordsFor.get(id)
    const base = {
      id,
      question: wording.question,
      ...(wording.header === undefined ? {} : { header: wording.header }),
      required: required.includes(id),
      ...(words === undefined ? {} : { wordsField: words }),
    }
    const type = property['type']
    if (type === 'array') {
      const items = isRecord(property['items']) ? property['items'] : {}
      return [{ ...base, type: 'choice', options: choicesOf(items) ?? [], multiple: true }]
    }
    if (type === 'boolean')
      return [
        {
          ...base,
          type: 'boolean',
          options: [
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ],
          multiple: false,
        },
      ]
    if (type === 'number' || type === 'integer') return [{ ...base, type: 'number', options: [], multiple: false }]
    if (type === 'string') {
      const choices = choicesOf(property)
      return [
        choices === undefined
          ? { ...base, type: 'text', options: [], multiple: false }
          : { ...base, type: 'choice', options: choices, multiple: false },
      ]
    }
    // A kind of field Althar can't ask; the agent gets nothing for it.
    return []
  })
}

/** Whether the person may answer a field in their own words. */
export const takesWords = (field: QuestionField) => field.type === 'text' || field.type === 'number' || field.wordsField !== undefined

/**
 * The form's content for the person's answers, by field: the options picked
 * by their values, the words in the field for them, a number as a number,
 * yes or no as true or false. A field with nothing said is left out.
 */
export const questionContent = (question: Question, answers: Readonly<Record<string, FieldAnswer>>): QuestionContent => {
  const content: Record<string, string | number | boolean | ReadonlyArray<string>> = {}
  for (const field of question.fields) {
    const said = answers[field.id]
    if (said === undefined) continue
    const values = said.values.filter((value) => field.options.some((option) => option.value === value))
    const words = said.words?.trim() ?? ''
    if (field.type === 'boolean') {
      if (values[0] !== undefined) content[field.id] = values[0] === 'true'
      continue
    }
    if (field.type === 'number') {
      const number = Number(words)
      if (words !== '' && Number.isFinite(number)) content[field.id] = number
      continue
    }
    if (field.type === 'text') {
      if (words !== '') content[field.id] = words
      continue
    }
    if (field.multiple) {
      if (values.length > 0) content[field.id] = values
    } else if (values[0] !== undefined) content[field.id] = values[0]
    if (words !== '' && field.wordsField !== undefined) content[field.wordsField] = words
  }
  return content
}

/** What the person said, in words, field by field: for the thread, and for an agent told afterwards. */
export const saidOf = (field: QuestionField, said: FieldAnswer): string => {
  const labels = said.values.flatMap((value) => {
    const option = field.options.find((choice) => choice.value === value)
    return option === undefined ? [] : [option.label]
  })
  const words = said.words?.trim() ?? ''
  return [...labels, ...(words === '' ? [] : [words])].join(', ')
}
