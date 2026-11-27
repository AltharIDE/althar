import { describe, expect, it } from 'vitest'

import { indexList, type Own, resolveSetup, type SetupItem } from '../src'
import { FN, northbank, P, PROJ, T } from './fixtures'

const index = indexList(northbank)
const none: Own = { added: [], choices: new Map() }

const item = (over: Partial<SetupItem> & Pick<SetupItem, 'name' | 'level'>): SetupItem => ({
  kind: 'skill',
  version: 'v1',
  standing: 'recommended',
  function: null,
  reach: 'projects',
  ...over,
})

const org = { kind: 'organization' } as const
const team = (id: string) => ({ kind: 'team', team: id }) as const
const project = (id: string) => ({ kind: 'project', project: id }) as const

/** Northbank's setup, from the worked example. */
const items: ReadonlyArray<SetupItem> = [
  item({ name: 'secret-scanning', level: org, standing: 'required' }),
  item({ name: 'security-review', kind: 'preset', level: org, standing: 'required' }),
  item({ name: 'design-system', level: org, function: FN.frontend }),
  item({ name: 'design-system', level: org, function: FN.design }),
  item({ name: 'figma', kind: 'mcp_server', level: org, function: FN.design }),
  item({ name: 'market-data', kind: 'mcp_server', level: team(T.markets), standing: 'available' }),
  item({ name: 'fx-conventions', level: team(T.fx), standing: 'required' }),
  item({ name: 'storybook', level: team(T.fx), function: FN.frontend }),
  item({ name: 'component-change', kind: 'preset', level: team(T.fx), function: FN.frontend }),
  item({ name: 'playwright', kind: 'mcp_server', level: team(T.fx), function: FN.qa }),
  item({ name: 'repository-skills', level: project(PROJ.fx) }),
  item({ name: 'design-direction', kind: 'preset', level: team(T.design), reach: 'people', standing: 'required' }),
  item({ name: 'payments-only', level: team(T.payments), standing: 'required' }),
  item({ name: 'other-project', level: project(PROJ.payments) }),
]

const names = (list: ReadonlyArray<{ name: string }>) => list.map((entry) => entry.name)

describe('setup', () => {
  it('gives Ana the organization’s, FX Manager’s and the project’s, for everyone and her functions', () => {
    const own: Own = {
      added: [{ kind: 'skill', name: 'writing-style', version: 'mine' }],
      choices: new Map([['mcp_server:playwright', false]]),
    }
    const result = resolveSetup(index, { person: P.ana, project: PROJ.fx, items, own })
    expect(names(result.on)).toEqual([
      'component-change',
      'security-review',
      'design-system',
      'fx-conventions',
      'repository-skills',
      'secret-scanning',
      'storybook',
      'writing-style',
    ])
    expect(names(result.off)).toEqual(['market-data', 'playwright'])
    expect(result.toSettle).toEqual([])
  })

  it('gives Sofia the project’s setup for Design, and what Design Studio sends with its people as a recommendation', () => {
    const result = resolveSetup(index, { person: P.sofia, project: PROJ.fx, items, own: none })
    expect(names(result.on)).toEqual([
      'figma',
      'design-direction',
      'security-review',
      'design-system',
      'fx-conventions',
      'repository-skills',
      'secret-scanning',
    ])
    const carried = result.on.find((entry) => entry.name === 'design-direction')!
    expect(carried.from).toEqual({ kind: 'level', level: team(T.design), standing: 'recommended' })
    // Turned off, it goes: it was only ever recommended on someone else's project.
    const off = resolveSetup(index, {
      person: P.sofia,
      project: PROJ.fx,
      items,
      own: { added: [], choices: new Map([['preset:design-direction', false]]) },
    })
    expect(names(off.off)).toContain('design-direction')
  })

  it('takes a function the person has on this project over their usual ones', () => {
    const qaHere = indexList({
      ...northbank,
      people: northbank.people.map((p) => (p.id === P.ana ? { ...p, projectFunctions: [{ project: PROJ.fx, functions: [FN.qa] }] } : p)),
    })
    const result = resolveSetup(qaHere, { person: P.ana, project: PROJ.fx, items, own: none })
    expect(names(result.on)).toContain('playwright')
    expect(names(result.on)).not.toContain('storybook')
  })

  it('keeps a requirement over the person’s own version, and asks for it to be settled', () => {
    const own: Own = {
      added: [{ kind: 'skill', name: 'secret-scanning', version: 'mine' }],
      choices: new Map([['skill:secret-scanning', false]]),
    }
    const result = resolveSetup(index, { person: P.ana, project: PROJ.fx, items, own })
    expect(result.on.find((entry) => entry.name === 'secret-scanning')?.version).toBe('v1')
    expect(result.toSettle).toEqual([
      {
        kind: 'skill',
        name: 'secret-scanning',
        offers: [
          { kind: 'skill', name: 'secret-scanning', version: 'v1', from: { kind: 'level', level: org, standing: 'required' } },
          { kind: 'skill', name: 'secret-scanning', version: 'mine', from: { kind: 'own' } },
        ],
      },
    ])
  })

  it('lets the furthest requirement win, and the closest level win otherwise', () => {
    const clash = [
      item({ name: 'lint', level: org, standing: 'required', version: 'org' }),
      item({ name: 'lint', level: team(T.fx), standing: 'required', version: 'fx' }),
      item({ name: 'style', level: org, version: 'org' }),
      item({ name: 'style', level: project(PROJ.fx), version: 'project', standing: 'available' }),
    ]
    const result = resolveSetup(index, { person: P.ben, project: PROJ.fx, items: clash, own: none })
    expect(result.on).toEqual([{ kind: 'skill', name: 'lint', version: 'org', from: { kind: 'level', level: org, standing: 'required' } }])
    expect(result.off).toEqual([
      { kind: 'skill', name: 'style', version: 'project', from: { kind: 'level', level: project(PROJ.fx), standing: 'available' } },
    ])
    expect(names(result.toSettle)).toEqual(['lint'])
  })

  it('asks to settle two versions at the same level, and lets the person’s own win over a recommendation', () => {
    const clash = [item({ name: 'twice', level: team(T.fx), version: 'a' }), item({ name: 'twice', level: team(T.fx), version: 'b' })]
    const result = resolveSetup(index, {
      person: P.ben,
      project: PROJ.fx,
      items: [...clash, item({ name: 'mine', level: org })],
      own: { added: [{ kind: 'skill', name: 'mine', version: 'own' }], choices: new Map() },
    })
    expect(names(result.toSettle)).toEqual(['twice'])
    expect(result.on.find((entry) => entry.name === 'mine')?.from).toEqual({ kind: 'own' })
  })

  it('lets the project’s item win a clash with one that travels with people', () => {
    const clash = [
      item({ name: 'tokens', level: team(T.design), reach: 'people', version: 'studio' }),
      item({ name: 'tokens', level: project(PROJ.fx), version: 'fx' }),
    ]
    const result = resolveSetup(index, { person: P.sofia, project: PROJ.fx, items: clash, own: none })
    expect(result.on.map((entry) => entry.version)).toEqual(['fx'])
  })

  it('gives nothing for someone or something it doesn’t know, and nothing from the organization’s own project for teams', () => {
    expect(resolveSetup(index, { person: `act_${'f'.repeat(32)}`, project: PROJ.fx, items, own: none })).toEqual({
      on: [],
      off: [],
      toSettle: [],
    })
    const result = resolveSetup(index, { person: P.owner, project: PROJ.company, items, own: none })
    expect(names(result.on)).toEqual(['security-review', 'secret-scanning'])
  })
})
