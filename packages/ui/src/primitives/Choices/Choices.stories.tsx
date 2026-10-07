import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Logo } from '../../foundations/Logo/Logo'
import { States, statesOn } from '../../storybook/States'
import { Choices, type ChoiceOption } from './Choices'

type Limit = 'move' | 'wait' | 'ask'
const OPTIONS: ChoiceOption<Limit>[] = [
  { value: 'move', title: 'Move the work to the next agent free', note: 'In the order of your connections.' },
  { value: 'wait', title: 'Wait for the reset', note: 'The task keeps its place and resumes on its own.' },
  { value: 'ask', title: 'Ask me' },
]

function Example({ options = OPTIONS }: { options?: ChoiceOption<Limit>[] }) {
  const [v, setV] = useState<Limit>('move')
  return (
    <div style={{ width: 420 }}>
      <Choices label="Usage limits" options={options} value={v} onChange={setV} />
    </div>
  )
}

/* Pictures for tiles: the mark on three grounds, standing in for the app's icons. */
type Ground = 'cobalt' | 'paper' | 'ink'
const ground = (background: string, color: string) => (
  <span style={{ display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: 11, background, color }}>
    <Logo size={34} />
  </span>
)
const TILES: ChoiceOption<Ground>[] = [
  { value: 'cobalt', title: 'Cobalt', picture: ground('var(--live)', '#f4f1e8') },
  { value: 'paper', title: 'Paper', picture: ground('#f4f1e8', 'var(--t-1)') },
  { value: 'ink', title: 'Ink', picture: ground('var(--t-1)', '#f4f1e8') },
]

function TileExample() {
  const [v, setV] = useState<Ground>('cobalt')
  return <Choices label="App icon" layout="tiles" options={TILES} value={v} onChange={setV} />
}

const meta = {
  title: 'Primitives/Choices',
  component: Choices,
  args: { label: 'Usage limits', options: OPTIONS, value: 'move', onChange: () => {} },
} satisfies Meta<typeof Choices<Limit>>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Example />,
}

/** Choosing by pointer, then by arrow key. */
export const Choosing: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Wait for the reset/ }))
    await expect(c.getByRole('radio', { name: /Wait for the reset/ })).toBeChecked()
    await userEvent.keyboard('{ArrowDown>}')
    await new Promise((r) => setTimeout(r, 30))
    await userEvent.keyboard('{/ArrowDown}')
    await waitFor(() => expect(c.getByRole('radio', { name: 'Ask me' })).toBeChecked())
  },
}

/** Side by side, for a choice better seen than read: a picture over each title. Arrows move across. */
export const Tiles: Story = {
  render: () => <TileExample />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: 'Paper' }))
    await expect(c.getByRole('radio', { name: 'Paper' })).toBeChecked()
    await userEvent.keyboard('{ArrowRight>}')
    await new Promise((r) => setTimeout(r, 30))
    await userEvent.keyboard('{/ArrowRight}')
    await waitFor(() => expect(c.getByRole('radio', { name: 'Ink' })).toBeChecked())
  },
}

export const WithDisabled: Story = { render: () => <Example options={OPTIONS.map((o) => ({ ...o, disabled: o.value === 'ask' }))} /> }

export const AllStates: Story = {
  parameters: statesOn({ hover: '[role="radio"]:nth-child(2)', focus: '[aria-checked="true"]', pressed: '[role="radio"]:nth-child(2)' }),
  render: () => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({
          state,
          node: <Choices label={`Limits, ${state}`} options={OPTIONS} value="move" onChange={() => {}} />,
        })),
        ...(['rest', 'hover', 'focus', 'pressed'] as const).map((state) => ({
          state: `tiles, ${state}`,
          ...(state === 'rest' ? {} : { force: state }),
          node: <Choices label={`Icon, ${state}`} layout="tiles" options={TILES} value="cobalt" onChange={() => {}} />,
        })),
        {
          state: 'tiles, disabled option',
          node: (
            <Choices
              label="Icon, one disabled"
              layout="tiles"
              options={TILES.map((o) => ({ ...o, disabled: o.value === 'ink' }))}
              value="cobalt"
              onChange={() => {}}
            />
          ),
        },
        {
          state: 'disabled option',
          node: (
            <Choices
              label="Limits, one disabled"
              options={OPTIONS.map((o) => ({ ...o, disabled: o.value === 'ask' }))}
              value="move"
              onChange={() => {}}
            />
          ),
        },
      ]}
    />
  ),
}
