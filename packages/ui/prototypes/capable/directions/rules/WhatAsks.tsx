// Scrappy, surface 2: what asks. A, in the project's Rules: the four kinds that still ask, each of which can be made Never, then the person's own Never and Ask. B, in the person's own Settings: the same, for every project, and a project's Rules keep only what is its own.
import { Fragment, useState } from 'react'

import { Heading } from '../../../../src/primitives/Heading/Heading'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem } from '../../../../src/primitives/Menu/Menu'
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
  account: {
    lede: 'In every project. Agents go ahead with everything else, and with one of these you asked for in the thread.',
    yours: 'Your own, in every project',
    differ: 'Where a project differs',
    open: 'Open',
  },
  project: {
    same: 'The same in every project: lost work and history, publishing and merging, speaking for you, and secrets.',
    change: 'Change in Settings',
    here: 'This project’s own',
    branchLine: 'A push to ',
    branchEnd: ' asks, as one to main does.',
    differ: 'A kind works differently here',
    place: { asks: 'Asks you here', never: 'Never here', ahead: 'Goes ahead here' },
  },
}

type Place = 'asks' | 'never'

/** A command list, as a sentence, with + at its end and the field where it was pressed. */
function Commands({ start, none, initial, end = '.' }: { start: string; none: string; initial: string[]; end?: string }) {
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
      {end}
      {field}
    </>
  )
}

export function WhatAsks({ where = 'project' }: { where?: 'project' | 'account' }) {
  const [places, setPlaces] = useState<Record<string, Place>>({})
  const account = where === 'account'
  return (
    <section className={s.whatAsks}>
      {!account && (
        <Heading level={3} className={s.title}>
          {whatAsksText.title}
        </Heading>
      )}
      <p className={s.lede}>{account ? whatAsksText.account.lede : whatAsksText.lede}</p>
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
                {one.kind === 'publish' && !account && <RulesChanged />}
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
        {account ? whatAsksText.account.yours : whatAsksText.yours}
      </Heading>
      <Charter className={s.yours}>
        <Clause label="Never" headingLevel={4}>
          <Commands start={whatAsksText.neverLine} none={whatAsksText.noNever} initial={['rm -rf /', 'kubectl delete namespace']} />
        </Clause>
        <Clause label="Ask me" headingLevel={4}>
          <Commands
            start={whatAsksText.askLine}
            none={whatAsksText.noAsk}
            initial={account ? ['terraform apply'] : ['fly deploy', 'bun run db:reset']}
          />
        </Clause>
      </Charter>
      {account && <Differ />}
    </section>
  )
}

/** B, in Settings: the projects whose Rules add to it or differ, each a line. */
function Differ() {
  return (
    <>
      <Heading level={3} className={s.title}>
        {whatAsksText.account.differ}
      </Heading>
      <ul className={s.differ}>
        <li>
          <span className={s.differName}>althar</span>
          <span className={s.differWhat}>
            A push to <code>next</code> or <code>release/*</code> asks; <code>fly deploy</code> and <code>bun run db:reset</code> ask
          </span>
          <LinkButton onClick={() => window.location.assign('#/projects/p1?room=settings&section=rules')}>
            {whatAsksText.account.open}
          </LinkButton>
        </li>
        <li>
          <span className={s.differName}>meridian</span>
          <span className={s.differWhat}>Speaking for you: never</span>
          <LinkButton onClick={() => window.location.assign('#/projects/p1?room=settings&section=rules')}>
            {whatAsksText.account.open}
          </LinkButton>
        </li>
      </ul>
    </>
  )
}

type HerePlace = 'asks' | 'never' | 'ahead'

/** B, in a project's Rules: a line on what asks everywhere, then only what is this project's own. */
export function ProjectAsks() {
  const [kinds, setKinds] = useState<ReadonlyArray<{ kind: keyof typeof KINDS; place: HerePlace }>>([])
  return (
    <section className={s.whatAsks}>
      <Heading level={3} className={s.title}>
        {whatAsksText.title}
      </Heading>
      <p className={s.same}>
        <span>{whatAsksText.project.same}</span>
        <LinkButton onClick={() => window.location.assign('#/settings/what-asks')}>{whatAsksText.project.change}</LinkButton>
      </p>
      <Heading level={3} className={s.title}>
        {whatAsksText.project.here}
      </Heading>
      <Charter className={s.yours}>
        <Clause label="Branches" headingLevel={4}>
          <Commands
            start={whatAsksText.project.branchLine}
            none={whatAsksText.noAsk}
            initial={['next', 'release/*']}
            end={whatAsksText.project.branchEnd}
          />
        </Clause>
        <Clause label="Never" headingLevel={4}>
          <Commands start={whatAsksText.neverLine} none={whatAsksText.noNever} initial={['bun run db:reset --remote']} />
        </Clause>
        <Clause label="Ask me" headingLevel={4}>
          <Commands start={whatAsksText.askLine} none={whatAsksText.noAsk} initial={['fly deploy', 'bun run db:reset']} />
        </Clause>
        {kinds.map((one) => (
          <Clause key={one.kind} label={KINDS[one.kind]} headingLevel={4}>
            <Menu label={KINDS[one.kind]} width={220} trigger={<RuleWord>{whatAsksText.project.place[one.place]}</RuleWord>}>
              <MenuRadioGroup
                label={KINDS[one.kind]}
                value={one.place}
                onChange={(value) =>
                  setKinds(kinds.map((each) => (each.kind === one.kind ? { ...each, place: value as HerePlace } : each)))
                }
              >
                {(['asks', 'never', 'ahead'] as const).map((place) => (
                  <MenuRadioItem key={place} value={place}>
                    {whatAsksText.project.place[place]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </Menu>
            .
          </Clause>
        ))}
      </Charter>
      <Menu
        label={whatAsksText.project.differ}
        width={240}
        trigger={<LinkButton className={s.differLink}>{whatAsksText.project.differ}</LinkButton>}
      >
        {(Object.keys(KINDS) as Array<keyof typeof KINDS>)
          .filter((kind) => !kinds.some((one) => one.kind === kind))
          .map((kind) => (
            <MenuItem key={kind} onSelect={() => setKinds([...kinds, { kind, place: 'never' }])}>
              {KINDS[kind]}
            </MenuItem>
          ))}
      </Menu>
    </section>
  )
}
