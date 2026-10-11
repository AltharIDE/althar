import type { AttentionRequest, FieldAnswer, QuestionField } from '@althar/contracts'
import type { QuestionAnswer, QuestionPart } from '@althar/ui'

/*
 * An agent's question (DEV-13) between the runtime's terms and the kit's: its
 * fields as the parts the kit asks, the person's picks as the answers the
 * runtime takes, and the question in a line for the places that list it.
 */

type AskedQuestion = NonNullable<AttentionRequest['question']>

export const questionText = {
  /** Why a question no longer waits. */
  withdrawn: {
    turn: 'The agent went on without an answer.',
    task: 'The task stopped.',
  },
  answer: 'Answer',
  /** Under a question in a list, where the agent said nothing first: who asks, and where. */
  asks: (model: string, where: string | null) => (where === null ? `${model} asks, as the coordinator` : `${model} asks, in ${where}`),
  /** Under a question in a list: the others asked with it. */
  more: (n: number) => (n === 1 ? 'and 1 more question' : `and ${n} more questions`),
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

/** Under a question's line in a list, where it asks several at once: how many more wait with the first. */
export const moreOf = (question: { readonly fields: ReadonlyArray<QuestionField> }): string | undefined =>
  question.fields.length > 1 ? questionText.more(question.fields.length - 1) : undefined

/**
 * The line under a question in a list: why the agent asks, in what it said
 * just before; else who asks and where; else how many more it asks with it.
 */
export const briefOf = (
  call: { readonly taskTitle: string | null; readonly question?: AskedQuestion | undefined },
  modelName: (agentId: string, model: string | null) => string,
): string | undefined => {
  const question = call.question
  if (question === undefined) return undefined
  if (question.why !== undefined) return question.why
  if (question.askedBy !== undefined) return questionText.asks(modelName(question.askedBy.agentId, question.askedBy.model), call.taskTitle)
  return moreOf(question)
}
