import { describe, expect, it } from 'vitest'

import { computerCallOf, computerCallProblem } from '../src/computerBridge'

/*
 * A lead that calls the computer wrong hears what was wrong, in the field it was, with a call that would do: never one
 * message for every mistake, which it cannot correct itself by.
 */
describe('a computer call', () => {
  it('opens an app by its name, as well as by the id Althar gave it', () => {
    expect(computerCallOf({ op: 'launch', app: 'Akiflow' })).toEqual({ op: 'launch', app: 'Akiflow' })
    expect(computerCallOf({ op: 'launch', app: '/Applications/Akiflow.app' })).not.toBeNull()
    expect(computerCallOf({ op: 'launch', app: 'a1111111-1111-4111-8111-111111111111' })).not.toBeNull()
    expect(computerCallOf({ op: 'launch', app: '' })).toBeNull()
  })

  it('says which operation there is, where it has none or one that isn’t', () => {
    expect(computerCallProblem({ app: 'Akiflow' })).toBe(
      'Give op, one of: status, request, launch, observe, click, type, key, scroll, drag, evidence, release. Start with {"op":"status"}.',
    )
    expect(computerCallProblem({ op: 'open', app: 'Akiflow' })).toMatch(/^"open" isn't a computer operation\. op is one of: status, /)
  })

  it('names each field that is wrong, what it needs, and gives an example', () => {
    expect(computerCallProblem({ op: 'launch' })).toBe('launch: app is missing. For example {"op":"launch","app":"Akiflow"}.')
    expect(computerCallProblem({ op: 'launch', app: 'Akiflow', target: 'desktop' })).toBe(
      'launch: launch takes no target. For example {"op":"launch","app":"Akiflow"}.',
    )
    expect(computerCallProblem({ op: 'observe', target: 'Akiflow' })).toMatch(
      /^observe: target: Expected an id Althar gave \(a UUID\) or "desktop", got "Akiflow"\. For example /,
    )
    expect(
      computerCallProblem({ op: 'key', target: 'desktop', observation: 'a1111111-1111-4111-8111-111111111111', keys: ['cmd space'] }),
    ).toMatch(/^key: keys\[0\]: Expected a key name such as "cmd", "space" or "return", got "cmd space"\. For example /)
    expect(
      computerCallProblem({ op: 'click', target: 'desktop', observation: 'a1111111-1111-4111-8111-111111111111', at: { x: -4, y: 10 } }),
    ).toBe(
      'click: at: an element of the latest observation, {"element":"e4"}, or a point {"x":120,"y":40} in whole pixels of the latest screenshot, got {"x":-4,"y":10}. For example {"op":"click","target":"<window id>","observation":"<observation id>","at":{"element":"e4"}} or "at":{"x":120,"y":40}.',
    )
  })
})
