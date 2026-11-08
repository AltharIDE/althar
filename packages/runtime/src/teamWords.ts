import type { ModelNamer } from './coordinatorNews'
import type { TeamChanged } from './Runs'

/*
 * What a change of a task's team says in its thread, after who made it: "changed the review to GPT-6.1 Terra". A caller puts
 * You, The coordinator or the lead before each.
 */

export interface TeamLine {
  readonly verb: 'changed' | 'removed'
  /** What it did it to: the lead to Opus 5.5, the review to GPT-6.1 Terra, the review. */
  readonly thing: string
  /** When it takes effect, where that isn't at once. */
  readonly note?: string
}

/** Each change, in the order the dialog lists them: the lead, then the review. */
export const teamChanges = (changed: TeamChanged, named: ModelNamer): ReadonlyArray<TeamLine> => {
  const lines: Array<TeamLine> = []
  const { lead, review } = changed
  if (lead !== undefined) {
    // Only its effort moved: the model it is on is the one it had.
    const sameModel = lead.step.agentId === lead.was.agentId && (lead.step.model ?? null) === (lead.was.model ?? null)
    lines.push({
      verb: 'changed',
      thing: sameModel ? `the lead’s effort to ${lead.step.effort ?? 'its default'}` : `the lead to ${named(lead.step)}`,
      ...(lead.when === 'next_turn' ? { note: 'It takes over from its next turn.' } : {}),
    })
  }
  if (review !== undefined)
    lines.push(
      review.step === null
        ? { verb: 'removed', thing: 'the review' }
        : {
            verb: 'changed',
            thing: `the review to ${named(review.step)}`,
            ...(review.when === 'next_round' ? { note: 'It starts from the next round.' } : {}),
          },
    )
  return lines
}

/** A change as a sentence after its subject: "changed the review to GPT-6.1 Terra. It starts from the next round." */
export const teamLine = (line: TeamLine) => `${line.verb} ${line.thing}${line.note === undefined ? '' : `. ${line.note}`}`
