import { HalftoneMark } from '@althar/ui'

/** The coordinator's signature on its turns, in its conversation and in its asides: its name, with Althar's mark. */
export const coordinatorSigned = { voice: 'Coordinator', mark: <HalftoneMark size={15} rise={false} /> } as const
