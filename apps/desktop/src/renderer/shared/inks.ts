import { ProjectInk as Inks } from '@althar/contracts'
import { ProjectInk } from '@althar/ui'

/*
 * A project's ink as the contract has it, a word, and as the kit draws it,
 * an enum of the same words.
 */

/** The kit's ink for the contract's. */
export const kitInk = (ink: Inks): ProjectInk => Object.values(ProjectInk).find((one) => one === ink) ?? ProjectInk.Clay

/** The contract's ink for the kit's. */
export const contractInk = (ink: ProjectInk): Inks => Inks.literals.find((one) => one === ink) ?? 'clay'
