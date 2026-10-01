import { Effect } from 'effect'

import { makeFakeService } from '../src/testing'
import { hostContract, trackerContract } from './contract'

const fake = makeFakeService({ pushUrl: (path) => `/tmp/fake/${path.join('/')}.git` })
fake.addRepository(['meridian', 'api'])
fake.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges' })
let branches = 0

hostContract({
  name: 'The fake',
  host: fake,
  path: ['meridian', 'api'],
  branch: Effect.sync(() => `charrette/contract-${(branches += 1)}`),
})
trackerContract({ name: 'The fake', tracker: fake, ref: 'MER-231' })
