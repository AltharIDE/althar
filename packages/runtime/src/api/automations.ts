import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'

import { Automations } from '../Automations'
import type { ApiKit } from './kit'

/**
 * A project's automations: reading, making, changing, turning on, pausing, running and deleting them.
 * Undoing what the coordinator changed of one, and the switches for all of them.
 */
export const automationsHandlers = ({ actorId, api, cursorNow }: ApiKit) =>
  Effect.gen(function* () {
    const automations = yield* Automations
    return {
      GetAutomations: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const cursor = yield* cursorNow
            return { cursor, automations: yield* automations.list(projectId), allPaused: yield* automations.allPaused }
          }),
        ),
      GetAutomation: ({ automationId }) =>
        api(
          Effect.gen(function* () {
            const cursor = yield* cursorNow
            return { cursor, automation: yield* automations.read(automationId) }
          }),
        ),
      MakeAutomation: ({ projectId, definition, on }) =>
        api(
          Effect.map(
            automations.make({ projectId, definition, ...(on === undefined ? {} : { on }), actorId: actorId }),
            (automationId) => ({ automationId }),
          ),
        ),
      ChangeAutomation: ({ automationId, definition }) => api(automations.change(automationId, definition, actorId)),
      TurnOnAutomation: ({ automationId, itemId }) => api(automations.turnOn(automationId, actorId, itemId)),
      PauseAutomation: ({ automationId }) => api(automations.pause(automationId, actorId)),
      RunAutomationNow: ({ automationId, itemId }) => api(automations.runNow(automationId, actorId, itemId)),
      DeleteAutomation: ({ automationId }) => api(automations.remove(automationId, actorId)),
      UndoAutomationChange: ({ itemId }) => api(automations.undo(itemId, actorId)),
      SetAutomationPostsReviews: ({ automationId, on }) => api(automations.setPostsReviews(automationId, on, actorId)),
      SetAutomationsPaused: ({ paused }) => api(automations.setAllPaused(paused)),
    } satisfies Partial<ApiHandlers>
  })
