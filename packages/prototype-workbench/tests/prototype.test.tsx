import { describe, expect, it } from 'vitest'

import { problemsOf, prototype } from '../src/prototype'

const direction = (key: string) => ({ key, name: key, render: () => null })

describe('what is wrong with a prototype', () => {
  it('is nothing for one with its own keys', () => {
    expect(
      problemsOf(
        prototype({
          title: 'Fine',
          directions: [direction('A'), direction('B')],
          states: [
            { key: 'one', name: 'One' },
            { key: 'two', name: 'Two' },
          ],
        }),
      ),
    ).toEqual([])
  })

  it('says a direction or state with another’s key, in any case, once', () => {
    expect(
      problemsOf(
        prototype({
          title: 'Twice',
          directions: [direction('A'), direction('a'), direction('A')],
          states: [
            { key: 'one', name: 'One' },
            { key: 'one', name: 'Again' },
          ],
        }),
      ),
    ).toEqual(['Two directions have the key A: each needs its own.', 'Two states have the key one: each needs its own.'])
  })

  it('keeps today for Today', () => {
    expect(problemsOf(prototype({ title: 'Today', directions: [direction('Today')] }))).toEqual([
      'A direction can’t have the key today: it is kept for Today.',
    ])
  })

  it('says a key that can’t go in the address', () => {
    expect(problemsOf(prototype({ title: 'Keys', directions: [direction(' ')], states: [{ key: 'a,b', name: 'Both' }] }))).toEqual([
      'A key is empty or has a comma in it: keys go in the address, as ?d=A&s=pushing.',
    ])
  })
})
