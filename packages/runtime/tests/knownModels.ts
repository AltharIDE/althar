import { until } from '@althar/testing/effect'
import { Effect } from 'effect'

import { Models } from '../src/Models'

/** Fixtures that name a model first let the agent finish listing what it offers. */
export const knownModels = Effect.flatMap(Models, (models) => until(models.catalog, (all) => all.every((agent) => !agent.probing)))
