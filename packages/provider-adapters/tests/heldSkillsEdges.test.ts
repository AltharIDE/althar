import { assert, describe, it } from '@effect/vitest'

import { claudeHolding, codexHolding, openCodeHolding } from '../src/heldSkills'

/* The shapes of config a held list meets that a session's own settings never show: bare settings, odd values, only a plugin's skill. */

const plugin = [{ name: 'superpowers:brainstorming' }]
const own = [{ name: 'impeccable' }]

describe('claudeHolding', () => {
  it('changes nothing where nothing is held', () => {
    const settings = { permissions: {} }
    assert.strictEqual(claudeHolding(settings, undefined), settings)
    assert.strictEqual(claudeHolding(settings, []), settings)
  })

  it('denies a plugin’s skill without listing it as off, and starts a deny list where there was none', () => {
    const settings = claudeHolding({ permissions: {} }, plugin) as Record<string, unknown>
    assert.deepStrictEqual(settings.permissions, { deny: ['Skill(superpowers:brainstorming)'] })
    assert.notProperty(settings, 'skillOverrides')
  })

  it('names a skill once however it is called', () => {
    const settings = claudeHolding({ permissions: { deny: ['Bash'] } }, [{ name: 'a', called: 'a' }, { name: 'a' }])
    assert.deepStrictEqual(settings.permissions.deny, ['Bash', 'Skill(a)'])
  })
})

describe('codexHolding', () => {
  it('changes nothing where nothing is held', () => {
    const config = { a: 1 }
    assert.strictEqual(codexHolding(config, undefined), config)
    assert.strictEqual(codexHolding(config, []), config)
  })

  it('ignores a skills value that is not a table or a rules list that is not a list', () => {
    assert.deepStrictEqual(codexHolding({ skills: 'x' }, own), { skills: { config: [{ name: 'impeccable', enabled: false }] } })
    assert.deepStrictEqual(codexHolding({ skills: null }, own), { skills: { config: [{ name: 'impeccable', enabled: false }] } })
    assert.deepStrictEqual(codexHolding({ skills: { config: 'x', other: 1 } }, own), {
      skills: { other: 1, config: [{ name: 'impeccable', enabled: false }] },
    })
  })

  it('holds no plugin skill', () => {
    assert.deepStrictEqual(codexHolding({}, plugin), { skills: { config: [] } })
  })
})

describe('openCodeHolding', () => {
  it('changes nothing where nothing is held, or only a plugin’s skill is', () => {
    const config = { a: 1 }
    assert.strictEqual(openCodeHolding(config, undefined), config)
    assert.strictEqual(openCodeHolding(config, []), config)
    assert.strictEqual(openCodeHolding(config, plugin), config)
  })

  it('denies after a single word for every skill, or after rules already there', () => {
    const word = openCodeHolding({ permission: { skill: 'ask' } }, own) as { permission: { skill: unknown } }
    assert.deepStrictEqual(word.permission.skill, { '*': 'ask', impeccable: 'deny' })
    const rules = openCodeHolding({ permission: { skill: { x: 'allow' }, bash: 'ask' } }, own) as {
      permission: { skill: unknown; bash: string }
    }
    assert.deepStrictEqual(rules.permission, { skill: { x: 'allow', impeccable: 'deny' }, bash: 'ask' })
  })

  it('starts from nothing where permission, skill or an agent is missing, null or not a table', () => {
    const bare = openCodeHolding({}, own) as { permission: unknown; agent: unknown }
    assert.deepStrictEqual(bare.permission, { skill: { impeccable: 'deny' } })
    assert.deepStrictEqual(bare.agent, {})
    const odd = openCodeHolding({ permission: null, agent: { build: 'x', plan: { permission: { skill: null } } } }, own) as {
      permission: unknown
      agent: Record<string, { permission: unknown } | undefined>
    }
    assert.deepStrictEqual(odd.permission, { skill: { impeccable: 'deny' } })
    assert.deepStrictEqual(odd.agent.build?.permission, { skill: { impeccable: 'deny' } })
    assert.deepStrictEqual(odd.agent.plan?.permission, { skill: { impeccable: 'deny' } })
    assert.deepStrictEqual(openCodeHolding({ agent: null }, own), {
      permission: { skill: { impeccable: 'deny' } },
      agent: {},
    })
  })
})
