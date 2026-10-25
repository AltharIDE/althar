import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { Composer } from '../Composer/Composer'
import { Behind } from '../Behind/Behind'
import { DictationPill } from './DictationPill'

const TO = 'To the coordinator · althar'
const SAID =
  'so the scroll on this task jumps back to the top every time a new message arrives, can you check whether the lead changed how the thread keeps its place'
const LEVELS = [0.2, 0.5, 0.8, 0.4, 0.9, 0.6, 0.3, 0.7, 0.5, 0.2, 0.6, 0.4]

const meta = {
  title: 'Composer/DictationPill',
  component: DictationPill,
  args: {
    phase: 'listening',
    to: TO,
    elapsed: '0:07',
    levels: LEVELS,
    words: SAID,
    kbd: '⌘⇧D',
    onStop: () => {},
    onDiscard: () => {},
    onBack: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 560, paddingTop: 40 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DictationPill>
export default meta
type Story = StoryObj<typeof meta>

export const Listening_: Story = { name: 'Listening' }
export const JustStarted: Story = { args: { elapsed: '0:00', words: '' } }
export const Writing: Story = { args: { phase: 'writing', elapsed: null } }
export const Written: Story = {
  args: {
    phase: 'written',
    elapsed: null,
    onKeep: () => {},
    send: { label: 'Send to the coordinator', onSend: () => {} },
    move: { label: 'Put it in this task', onMove: () => {} },
  },
}
/** It can't go from here (the task's lead isn't on it): back to its composer to send it. */
export const WrittenNotSendable: Story = { args: { phase: 'written', elapsed: null, onKeep: () => {} } }
export const SendFailed: Story = {
  args: { ...Written.args, phase: 'written', error: "It didn't send. It's still here." },
}
export const Failed: Story = { args: { phase: 'failed', elapsed: null, said: '0:12', onRetry: () => {} } }

/** Words come in; the pill stays as wide as it was. */
export const WidthHolds: Story = {
  render: function Render(args) {
    const [words, setWords] = useState('so')
    useEffect(() => {
      const all = SAID.split(' ')
      let n = 1
      const id = window.setInterval(() => setWords(all.slice(0, (n = (n % all.length) + 1)).join(' ')), 120)
      return () => window.clearInterval(id)
    }, [])
    return <DictationPill {...args} words={words} />
  },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('group', { name: TO })
    const width = pill.getBoundingClientRect().width
    await new Promise((resolve) => setTimeout(resolve, 600))
    await expect(pill.getBoundingClientRect().width).toBe(width)
  },
}

export const Opens: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getAllByRole('button', { name: 'Show all of what you said' })[0]!)
    await expect(c.getByRole('region', { name: TO })).toBeVisible()
    await expect(c.getByRole('button', { name: /Stop and write it down/ })).toBeVisible()
  },
}

/** Over another thread's composer, above its pills, covering none of them. */
export const OverAComposer: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 720, paddingTop: 200 }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <Composer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      placeholder="Message the lead"
      onAddImages={() => {}}
      carried={<DictationPill {...args} />}
      above={
        <Behind
          sources={[{ id: 'pr', mark: Brand.GitHub, label: 'PR 166', where: 'althar' }]}
          processes={[{ id: 'dev', command: 'bun run dev', url: 'localhost:5173', since: '4m' }]}
          onStop={() => {}}
        />
      }
    />
  ),
}
