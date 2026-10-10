import type { FieldAnswer, QuestionField } from '@althar/contracts'
import type { QuestionAnswer, QuestionPart } from '@althar/ui'

/*
 * An agent's question (DEV-13) between the runtime's terms and the kit's: its
 * fields as the parts the kit asks, the person's picks as the answers the
 * runtime takes, and the question in a line for the places that list it.
 */

export const questionText = {
  /** Why a question no longer waits. */
  withdrawn: {
    turn: 'The agent went on without an answer.',
    task: 'The task stopped.',
  },
  answer: 'Answer',
  /** Between a question's options, in a line. */
  or: '  or  ',
}

/** Whether a field takes an answer in the person's own words. */
const takesWords = (field: QuestionField) => field.type === 'text' || field.type === 'number' || field.wordsField !== undefined

/** The fields an agent asks, as the kit's parts: its options by the values the agent wants back. */
export const partsOf = (fields: ReadonlyArray<QuestionField>): ReadonlyArray<QuestionPart> =>
  fields.map((field) => ({
    id: field.id,
    question: field.question,
    ...(field.header === undefined ? {} : { header: field.header }),
    options: field.options.map((option) => ({
      id: option.value,
      label: option.label,
      ...(option.note === undefined ? {} : { note: option.note }),
    })),
    ...(field.multiple ? { multiple: true } : {}),
    words: takesWords(field),
  }))

/** What the person picked in the kit, as the runtime takes it. */
export const answersOf = (answer: QuestionAnswer): Readonly<Record<string, FieldAnswer>> =>
  Object.fromEntries(
    Object.entries(answer).map(([id, pick]) => [
      id,
      { values: [...pick.optionIds], ...(pick.words === undefined || pick.words.trim() === '' ? {} : { words: pick.words.trim() }) },
    ]),
  )

/** What the person said, as the runtime kept it, for the kit's answered question. */
export const pickedOf = (answers: Readonly<Record<string, FieldAnswer>>): QuestionAnswer =>
  Object.fromEntries(
    Object.entries(answers).map(([id, said]) => [
      id,
      { optionIds: said.values, ...(said.words === undefined ? {} : { words: said.words }) },
    ]),
  )

/** The question in a line, for a list: what it asks, by its options where it has a handful, or by what each of several asks. */
export const briefOf = (question: { readonly fields: ReadonlyArray<QuestionField> }): string | undefined => {
  const [only, ...more] = question.fields
  if (only === undefined) return undefined
  if (more.length > 0) return question.fields.map((field) => field.header ?? field.question).join(' · ')
  return only.options.length > 0 ? only.options.map((option) => option.label).join(questionText.or) : undefined
}
