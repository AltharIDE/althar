// Scrappy, surface 3, direction A: Rules lead with the four kinds that still ask, each of which can be made Never; then the person's own Never and Ask, as the charter has them.
import { Fragment, useState } from 'react'

import { Heading } from '../../../../src/primitives/Heading/Heading'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../../../src/primitives/Menu/Menu'
import { AddCommand, Charter, Clause, CommandToken, NewCommand, RuleWord } from '../../../../src/setup/Charter/Charter'
import { RulesChanged } from '../tune/Tune'
import { KINDS } from './Ask'
import s from './rules.module.css'

/** What still asks, by kind, with what each catches. */
const ASKS: ReadonlyArray<{ kind: keyof typeof KINDS; catches: ReadonlyArray<string> }> = [
  {
    kind: 'history',
    catches: [
      'git push --force',
      'a push to main',
      'deleting another branch',
      'discarding changes in another checkout',
      'deleting outside the task',
    ],
  },
  { kind: 'publish', catches: ['a merge', 'npm publish', 'a release or its tag', 'terraform destroy'] },
  { kind: 'speak', catches: ['a post on someone else’s pull request or issue', 'a reply to an outside author'] },
  { kind: 'secrets', catches: ['~/.ssh', 'token files', 'the keychain'] },
]

export const whatAsksText = {
  title: 'What asks',
  lede: 'Agents go ahead with everything else, in every task. One of these you asked for in the thread goes ahead too.',
  asks: 'Asks you',
  never: 'Never',
  place: { asks: 'Asks you, every time', never: 'Refused outright' },
  yours: 'Your own',
  neverLine: 'Agents never run ',
  askLine: 'They ask you before running ',
  noNever: 'Nothing else is refused.',
  noAsk: 'Nothing else asks.',
}

type Place = 'asks' | 'never'

/** A command list, as a sentence, with + at its end and the field where it was pressed. */
function Commands({ start, none, initial }: { start: string; none: string; initial: string[] }) {
  const [list, setList] = useState(initial)
  const [typing, setTyping] = useState<string | null>(null)
  const items = list.map((pattern) => (
    <CommandToken key={pattern} pattern={pattern} onRemove={() => setList(list.filter((one) => one !== pattern))} />
  ))
  const field =
    typing === null ? (
      <AddCommand label="Add a command" onClick={() => setTyping('')} />
    ) : (
      <NewCommand
        ref={(element: HTMLInputElement | null) => element?.focus()}
        value={typing}
        aria-label="A command, as it starts"
        onChange={(event) => setTyping(event.target.value)}
        onBlur={() => setTyping(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setTyping(null)
          if (event.key === 'Enter' && typing.trim() !== '') {
            setList([...list, typing.trim()])
            setTyping(null)
          }
        }}
      />
    )
  if (items.length === 0)
    return (
      <>
        {none}
        {field}
      </>
    )
  return (
    <>
      {start}
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && (index === items.length - 1 ? ' or ' : ', ')}
          {item}
        </Fragment>
      ))}
      .{field}
    </>
  )
}

export function WhatAsks() {
  const [places, setPlaces] = useState<Record<string, Place>>({})
  return (
    <section className={s.whatAsks}>
      <Heading level={3} className={s.title}>
        {whatAsksText.title}
      </Heading>
      <p className={s.lede}>{whatAsksText.lede}</p>
      <ul className={s.kinds}>
        {ASKS.map((one) => {
          const place = places[one.kind] ?? 'asks'
          return (
            <li key={one.kind} className={s.kind}>
              <div className={s.kindText}>
                <span className={s.kindName}>{KINDS[one.kind]}</span>
                <span className={s.catches}>
                  {one.catches.map((each, index) => (
                    <Fragment key={each}>
                      {index > 0 && ', '}
                      {each.startsWith('git') ||
                      each.startsWith('~') ||
                      each.startsWith('npm') ||
                      each.startsWith('rm') ||
                      each.startsWith('terraform') ? (
                        <code>{each}</code>
                      ) : (
                        each
                      )}
                    </Fragment>
                  ))}
                </span>
                {one.kind === 'publish' && <RulesChanged />}
              </div>
              <Menu
                label={KINDS[one.kind]}
                width={240}
                trigger={<RuleWord>{place === 'asks' ? whatAsksText.asks : whatAsksText.never}</RuleWord>}
              >
                <MenuRadioGroup
                  label={KINDS[one.kind]}
                  value={place}
                  onChange={(value) => setPlaces({ ...places, [one.kind]: value as Place })}
                >
                  <MenuRadioItem value="asks" description={whatAsksText.place.asks}>
                    {whatAsksText.asks}
                  </MenuRadioItem>
                  <MenuRadioItem value="never" description={whatAsksText.place.never}>
                    {whatAsksText.never}
                  </MenuRadioItem>
                </MenuRadioGroup>
              </Menu>
            </li>
          )
        })}
      </ul>
      <Heading level={3} className={s.title}>
        {whatAsksText.yours}
      </Heading>
      <Charter className={s.yours}>
        <Clause label="Never" headingLevel={4}>
          <Commands start={whatAsksText.neverLine} none={whatAsksText.noNever} initial={['rm -rf /', 'kubectl delete namespace']} />
        </Clause>
        <Clause label="Ask me" headingLevel={4}>
          <Commands start={whatAsksText.askLine} none={whatAsksText.noAsk} initial={['fly deploy', 'bun run db:reset']} />
        </Clause>
      </Charter>
    </section>
  )
}
