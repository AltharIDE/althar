import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CommandMatch, RulePlace } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import {
  AddCommand,
  Charter,
  CharterKey,
  ChoiceWord,
  type ChoiceWordOption,
  Clause,
  CommandToken,
  NewCommand,
  NewCommandHint,
  RuleWord,
} from './Charter'

const PLACES: ChoiceWordOption<RulePlace>[] = [
  { value: RulePlace.Never, title: 'Never', note: 'Refused outright' },
  { value: RulePlace.Ask, title: 'Always ask me', note: 'Waits for you, whoever would answer' },
  { value: RulePlace.Allow, title: 'Always allowed', note: 'Goes ahead without asking' },
  { value: RulePlace.Rest, title: 'The rest', note: 'With the rest: the coordinator decides' },
]

const CATCHES = (
  <>
    Catches <code>git push origin --delete old-spike</code> and <code>git push --prune</code>; never the task’s own branch
  </>
)

/** A kind of request as a word: the menu it opens moves it to another sentence. */
function KindWord({ defaultOpen, onChange = () => {} }: { defaultOpen?: boolean; onChange?: (place: RulePlace) => void }) {
  const [place, setPlace] = useState(RulePlace.Ask)
  return (
    <ChoiceWord
      word="deleting other branches"
      label="Deleting branches that aren’t the task’s"
      options={PLACES}
      value={place}
      onChange={(next) => {
        setPlace(next)
        onChange(next)
      }}
      note={CATCHES}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
    />
  )
}

const meta = {
  title: 'Setup/Charter',
  component: Charter,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 980 }}>{Story()}</div>],
  args: { children: null },
} satisfies Meta<typeof Charter>
export default meta
type Story = StoryObj<typeof meta>

/**
 * The sentences: one that no project changes, behind its lock; one with
 * underlined words and commands; one that holds for nothing just now; and,
 * after a gap, one of a part of its own.
 */
export const Sentences: Story = {
  render: () => (
    <Charter>
      <Clause label="Always" headingLevel={2} fixed>
        No agent, in any project, reads your credentials or reaches the code host except through Althar.
      </Clause>
      <Clause label="Never" headingLevel={2}>
        Agents never <RuleWord>force push</RuleWord>, and never run <CommandToken pattern="aws s3 rm" onRemove={fn()} /> or{' '}
        <CommandToken pattern="doppler secrets" onRemove={fn()} />.
        <AddCommand label="Add a command to Never" />
      </Clause>
      <Clause label="Ask me" headingLevel={2} off="Off while everything is allowed.">
        They ask you before <RuleWord>pushing to the default branch</RuleWord> or <KindWord />.
      </Clause>
      <Clause label="Finished" headingLevel={2} apart>
        A finished task opens <RuleWord>a draft pull request</RuleWord>, on a branch named{' '}
        <RuleWord mono>feat/MER-128-refund-banner</RuleWord>.
      </Clause>
    </Charter>
  ),
}

/** How to read them: what an underlined word is, and what code is. */
export const Key: Story = { render: () => <CharterKey /> }

/** A built-in word, opened: where it can sit, the current place checked, and what it catches at the foot. */
export const WordOpen: Story = {
  decorators: [(Story) => <div style={{ minHeight: 380, fontSize: 18.5 }}>{Story()}</div>],
  render: () => <KindWord defaultOpen />,
}

const placed = fn()
/** Choosing where a kind sits, by keyboard: the word opens its menu, and the choice goes out at once. */
export const ChoosingAPlace: Story = {
  decorators: [(Story) => <div style={{ minHeight: 380, fontSize: 18.5 }}>{Story()}</div>],
  render: () => <KindWord onChange={placed} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    const word = c.getByRole('button', { name: 'deleting other branches' })
    word.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await page.findByRole('menu', { name: 'Deleting branches that aren’t the task’s' })
    await expect(menu).toHaveAccessibleDescription(/Catches git push origin --delete old-spike/)
    await waitFor(() => expect(page.getByRole('menuitemradio', { name: 'Always ask me' })).toHaveAttribute('aria-checked', 'true'))
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Never' }))
    await expect(placed).toHaveBeenCalledWith(RulePlace.Never)
    await waitFor(() => expect(page.queryByRole('menu')).toBeNull())
    await expect(word).toHaveFocus()
  },
}

/** Commands: by how they start, for the whole line, one too long for its box, and one that only reads. */
export const Commands: Story = {
  render: () => (
    <p style={{ fontSize: 18.5, lineHeight: 1.75, margin: 0 }}>
      <CommandToken pattern="bun test" onRemove={fn()} />,{' '}
      <CommandToken pattern="git status --short" match={CommandMatch.Exact} onRemove={fn()} />,{' '}
      <CommandToken pattern="pnpm replay --env staging --from 2026-09-25 refunds" match={CommandMatch.Exact} onRemove={fn()} /> and{' '}
      <CommandToken pattern="curl localhost" />
    </p>
  ),
}

const removed = fn()
/** A command's ×: named by the command, it takes the rule out. */
export const RemovingACommand: Story = {
  render: () => <CommandToken pattern="git status --short" match={CommandMatch.Exact} onRemove={removed} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Remove exactly git status --short' }))
    await expect(removed).toHaveBeenCalled()
  },
}

/** A command being added in its sentence, with how it matches, what it holds for, and the keys under it. */
function Adding({
  error = null,
  initial = '',
  match: first = CommandMatch.Prefix,
}: {
  error?: string | null
  initial?: string
  match?: CommandMatch
}) {
  const [pattern, setPattern] = useState(initial)
  const [match, setMatch] = useState(first)
  return (
    <Charter>
      <Clause
        label="Go ahead"
        below={<NewCommandHint pattern={pattern} match={match} onMatchChange={setMatch} error={error} errorId="why" noteId="holds" />}
      >
        They go ahead with <CommandToken pattern="bun test" onRemove={fn()} /> and{' '}
        <NewCommand
          aria-label="A command, as it starts"
          aria-describedby={error === null ? 'holds' : 'holds why'}
          value={pattern}
          invalid={error !== null}
          onChange={(event) => setPattern(event.target.value)}
        />
        .
      </Clause>
    </Charter>
  )
}

/** Opened: nothing typed yet, so it says what to type and where it holds. */
export const AddingEmpty: Story = { render: () => <Adding /> }

/** Typed: it holds for the command and whatever follows it. */
export const AddingTyped: Story = { render: () => <Adding initial="npx playwright test" /> }

/** For the whole line, as it would run. */
export const AddingExactly: Story = { render: () => <Adding initial="git status --short" match={CommandMatch.Exact} /> }

/** Not added, and why, under the rest. */
export const AddingRefused: Story = {
  render: () => (
    <Adding initial="bun test" error="“bun test” is under Never, which comes first, so nothing changed. Take it out there first." />
  ),
}

/** Typing grows the box, and the line under it says what it holds for; the match can be changed to the whole line. */
export const Typing: Story = {
  render: () => <Adding />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'A command, as it starts' })
    await expect(c.getByText(/How the command starts, \* for anything/)).toBeInTheDocument()
    await userEvent.type(field, 'npx playwright test')
    await expect(field).toHaveAttribute('size', '20')
    await expect(c.getByText('npx playwright test …')).toBeInTheDocument()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  decorators: [(Story) => <div style={{ fontSize: 18.5, lineHeight: 1.75 }}>{Story()}</div>],
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'word', node: <RuleWord>force push</RuleWord> },
        { state: 'word, mono', node: <RuleWord mono>feat/MER-128-refund-banner</RuleWord> },
        { state: 'hover', node: <RuleWord>force push</RuleWord> },
        { state: 'focus', node: <RuleWord>force push</RuleWord> },
        { state: 'command', node: <CommandToken pattern="bun test" onRemove={fn()} /> },
        { state: 'command, exactly', node: <CommandToken pattern="git status --short" match={CommandMatch.Exact} onRemove={fn()} /> },
        { state: 'command, hover', force: 'hover', node: <CommandToken pattern="bun test" onRemove={fn()} /> },
        { state: 'command, focus', force: 'focus', node: <CommandToken pattern="bun test" onRemove={fn()} /> },
        {
          state: 'command, too long',
          node: <CommandToken pattern="pnpm replay --env staging --from 2026-09-25 refunds" match={CommandMatch.Exact} onRemove={fn()} />,
        },
        { state: 'command, reads only', node: <CommandToken pattern="curl localhost" /> },
        { state: 'add', node: <AddCommand label="Add a command to Never" /> },
        { state: 'add, hover', force: 'hover', node: <AddCommand label="Add a command to Never" /> },
        { state: 'adding', node: <NewCommand aria-label="A command, as it starts" value="npx playwright test" onChange={fn()} /> },
        { state: 'adding, refused', node: <NewCommand aria-label="A command, as it starts" value="bun test" invalid onChange={fn()} /> },
        { state: 'key', node: <CharterKey /> },
      ]}
    />
  ),
}
