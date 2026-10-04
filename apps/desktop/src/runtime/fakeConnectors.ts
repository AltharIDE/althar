import { products } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { Connectors } from '@althar/runtime'
import { Layer } from 'effect'

/*
 * A code host for the end-to-end tests: GitHub, answered by the connectors'
 * fake service in the runtime's own process, on an instance at
 * https://github.test, which no network reaches. Its repository is
 * meridian/api, with one issue; what is pushed to it goes to the bare
 * repository ALTHAR_FAKE_REMOTE names. A pasted token connects it. Loaded
 * only when ALTHAR_FAKE_AGENTS is set.
 */

export const HOST = 'https://github.test'

const github = makeFakeService({ pushUrl: () => process.env.ALTHAR_FAKE_REMOTE ?? '' })
github.addRepository(['meridian', 'api'])
github.addIssue({ ref: 'meridian/api#12', title: 'Checkout gives up after one try', body: 'It should retry.' })

export const fakeConnectors = Layer.succeed(
  Connectors,
  Connectors.of({
    products: [{ ...products.github, hosted: { webUrl: HOST, apiUrl: `${HOST}/api/v3` }, make: () => ({ host: github, tracker: github }) }],
    fetch: () => Promise.reject(new Error('The end-to-end tests reach no network')),
    clientIds: {},
    callbackPort: 0,
  }),
)
