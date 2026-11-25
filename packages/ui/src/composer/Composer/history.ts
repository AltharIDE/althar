/*
 * What Undo and Redo do in a composer, beside what the field does with its
 * own words: an attachment taken off (an image, a file, a comment) is a step
 * of the same history, in the order it happened. The field keeps its words'
 * steps itself, and the browser never says how many it has; so each
 * attachment step remembers the words as they were when it was taken, and
 * it is the last step once the words are back to that. Before then, Undo is
 * the field's own. Where the field has none of its own left, as after words
 * were put in it rather than typed, the attachment's step is taken anyway
 * (`last`), so it is never out of reach.
 *
 * The steps hold what they put back (the image itself, its bytes and its
 * crop), in the window's memory only, for as long as its draft is kept.
 */

/** A step a composer can take back and do again, beside its field's own: an attachment taken off, and how to put it back. */
export interface ComposerStep {
  /** Puts it back where it was, as it was. */
  readonly undo: () => void
  /** Takes it off again. */
  readonly redo: () => void
}

/** A composer's history of attachment steps, merged with its field's own (`Composer`'s `history`). */
export interface ComposerHistory {
  /** An attachment taken off, with the words as they were: a step of its own, after which nothing is left to redo. */
  push: (step: ComposerStep, words: string) => void
  /** The person changed the words: what was undone, the attachments' and the field's own alike, can't be redone. */
  edited: () => void
  /** The field undid or redid words of its own. */
  native: (kind: 'undo' | 'redo') => void
  /**
   * Undo, with the words as they are. True where it was this history's to do, and done: the field must not do its own
   * then. With `last`, the field had nothing of its own to undo.
   */
  undo: (words: string, last?: boolean) => boolean
  /** Redo, as Undo is; true too where the field's own steps to redo are older than an attachment taken off since, which hold them back. */
  redo: (words: string, last?: boolean) => boolean
  /** Forgets every step, as its message is sent. */
  clear: () => void
}

/** How many attachment steps are kept, each way. */
const KEPT = 50

interface Taken {
  readonly step: ComposerStep
  /** The words as they stood when it was done or undone: it is the next step once they stand so again. */
  readonly words: string
}

export const createComposerHistory = (): ComposerHistory => {
  const undoing: Taken[] = []
  const redoing: Taken[] = []
  /*
   * How many of the field's own steps it may redo, where an attachment was taken off since its words last changed: those
   * it undid before then are of an older history. Null where every one it has is its to redo.
   */
  let fieldRedo: number | null = null
  const keep = (stack: Taken[], taken: Taken) => {
    stack.push(taken)
    if (stack.length > KEPT) stack.shift()
  }
  return {
    push: (step, words) => {
      keep(undoing, { step, words })
      redoing.length = 0
      fieldRedo = 0
    },
    edited: () => {
      redoing.length = 0
      fieldRedo = null
    },
    native: (kind) => {
      if (fieldRedo !== null) fieldRedo = Math.max(0, fieldRedo + (kind === 'undo' ? 1 : -1))
    },
    undo: (words, last = false) => {
      const top = undoing.at(-1)
      if (top === undefined || (top.words !== words && !last)) return false
      undoing.pop()
      top.step.undo()
      keep(redoing, { step: top.step, words })
      return true
    },
    redo: (words, last = false) => {
      const top = redoing.at(-1)
      const fieldHasNone = fieldRedo === 0
      if (top !== undefined && (top.words === words || last || fieldHasNone)) {
        redoing.pop()
        top.step.redo()
        keep(undoing, { step: top.step, words })
        return true
      }
      return fieldHasNone
    },
    clear: () => {
      undoing.length = 0
      redoing.length = 0
      fieldRedo = null
    },
  }
}
