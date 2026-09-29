import { codexLikeMeanings, fakeAgent, scenarios } from '../src/testing'
import { contract } from './contract'

contract({
  name: 'fake agent',
  transport: () => ({ _tag: 'InProcess', agent: fakeAgent() }),
  cwd: '/tmp',
  modes: { ask: 'ask', readOnly: 'read-only' },
  permissions: codexLikeMeanings,
  model: { optionId: 'model', switchTo: 'large' },
  prompts: { short: scenarios.hello, long: scenarios.slow, command: scenarios.commandChoices },
})
