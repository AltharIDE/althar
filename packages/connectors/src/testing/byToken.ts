import { Effect } from 'effect'

import type { Access } from '../access'
import type { AdapterOptions } from '../credential'
import type { Tracker } from '../model'
import type { FakeService } from './FakeService'

/**
 * Several fakes of one product, each signed in to by its own token: a
 * workspace of Linear's apiece, say. A connection's tracker and its check go
 * to the fake its token is for, and a token none is for goes to the first.
 */
export const byToken = (services: Readonly<Record<string, FakeService>>) => {
  const [first] = Object.values(services)
  if (first === undefined) throw new Error('byToken needs a fake')
  const of = (token: string) => services[token] ?? first
  const tracker = (options: AdapterOptions): Tracker => {
    const service = Effect.map(options.credential, (credential) => of(credential.token))
    const routed = <A, E>(use: (one: FakeService) => Effect.Effect<A, E>) => Effect.flatMap(service, use)
    return {
      product: first.product,
      capabilities: first.capabilities,
      account: routed((one) => one.account),
      issue: (ref) => routed((one) => one.issue(ref)),
      mine: (options) => routed((one) => one.mine(options)),
      comment: (issue, body) => routed((one) => one.comment(issue, body)),
      link: (issue, link) => routed((one) => one.link(issue, link)),
      start: (issue) => routed((one) => one.start(issue)),
      containers: () => routed((one) => one.containers()),
      create: (container, issue) => routed((one) => one.create(container, issue)),
      choices: (issue, field, wanted) => routed((one) => one.choices(issue, field, wanted)),
      update: (issue, change) => routed((one) => one.update(issue, change)),
    }
  }
  const access: Access = (input) => of(input.credential.token).access(input)
  return { tracker, access }
}
