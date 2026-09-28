import { contract } from './contract'
import { fakeAgent, scenarios } from '../src/testing'

contract({
  name: 'fake agent',
  transport: () => ({ _tag: 'InProcess', agent: fakeAgent() }),
  cwd: '/tmp',
  modes: { ask: 'ask', readOnly: 'read-only' },
  model: { optionId: 'model', switchTo: 'large' },
  prompts: { short: scenarios.hello, long: scenarios.slow },
})
