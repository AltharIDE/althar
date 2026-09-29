import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { Client } from '../src/renderer/data/client'
import { type Host, ServicesProvider } from '../src/renderer/data/services'
import { fakeHost } from './fixtures'

/** Renders a screen with the services a view model reaches for. */
export const withServices = (node: ReactNode, client: Client, host: Host = fakeHost()) =>
  render(<ServicesProvider value={{ client, host }}>{node}</ServicesProvider>)
