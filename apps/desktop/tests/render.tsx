import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { Client } from '../src/renderer/data/client'
import { follow } from '../src/renderer/data/feed'
import { makeQueryClient } from '../src/renderer/data/reads'
import { type Host, type Services, ServicesProvider } from '../src/renderer/data/services'
import { fakeHost } from './fixtures'

/** What a window holds: the client, the host, a cache of its own and a watch on the client, from now. */
export const servicesFor = (client: Client, host: Host = fakeHost()): Services => {
  const cache = makeQueryClient()
  return { client, host, cache, feed: follow(client, cache) }
}

/** Renders a screen with the services a view model reaches for. */
export const withServices = (node: ReactNode, client: Client, host: Host = fakeHost()) =>
  render(<ServicesProvider value={servicesFor(client, host)}>{node}</ServicesProvider>)
