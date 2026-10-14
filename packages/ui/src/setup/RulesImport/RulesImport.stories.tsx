import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MERIDIAN_IMPORT, MERIDIAN_SKIPPED } from '../../fixtures/rules'
import { RulesImport } from './RulesImport'

const meta = {
  title: 'Setup/RulesImport',
  component: RulesImport,
  parameters: { layout: 'fullscreen' },
  args: { rules: MERIDIAN_IMPORT, skipped: MERIDIAN_SKIPPED, onTake: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 760 }}>{Story()}</div>],
} satisfies Meta<typeof RulesImport>
export default meta
type Story = StoryObj<typeof meta>

/** From the rules screen: every rule chosen, under the sentence it would join, and what can't be taken folded away. */
export const Default: Story = {}

/** As the project opens: turning it down takes none, and answers the offer. */
export const Offered: Story = { args: { onDecline: fn() } }

/** Some chosen. */
export const SomeChosen: Story = { args: { defaultChosen: ['rm', 'test'] } }

/** Only what can't be taken: nothing to choose, only why. */
export const NothingToTake: Story = { args: { rules: [], unreadable: ['opencode.jsonc'] } }

/** A file Althar couldn't read as its agent does. */
export const Unreadable: Story = { args: { unreadable: ['opencode.jsonc', '~/.claude/settings.json'] } }

/** Opened before the files are read. */
export const Reading: Story = { args: { reading: true, rules: [], skipped: [] } }

/** Opened before the files are read: once they are, every rule starts chosen. */
export const ReadAfterOpening: Story = {
  render: function Render(args) {
    const [read, setRead] = useState(false)
    useEffect(() => {
      const reading = setTimeout(() => setRead(true), 60)
      return () => clearTimeout(reading)
    }, [])
    return <RulesImport {...args} reading={!read} rules={read ? args.rules : []} />
  },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(await page.findByText('Reading your agents’ settings…')).toBeInTheDocument()
    await userEvent.click(await page.findByRole('button', { name: 'Take 5 rules' }))
    await expect(args.onTake).toHaveBeenCalledWith(['rm', 'push', 'tf', 'test', 'status'])
  },
}

/** Driven from outside: what the consumer says is chosen. */
export const Controlled: Story = {
  args: { chosen: ['tf'], onChosenChange: fn() },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(await page.findByRole('checkbox', { name: 'terraform' })).toBeChecked()
    await userEvent.click(page.getByRole('checkbox', { name: 'rm -rf' }))
    await expect(args.onChosenChange).toHaveBeenCalledWith(['rm', 'tf'])
  },
}

/** No agent keeps settings here: the consumer says so in its own words. */
export const NoneFound: Story = {
  args: { rules: [], skipped: [], text: { none: 'None of your agents keep settings for this project yet.' } },
}

/** Taking what was chosen. */
export const Taking: Story = { args: { taking: true } }

/** The runtime said no. */
export const Failed: Story = { args: { error: 'Your agents’ settings changed since they were read, so nothing was taken.' } }

/** Taking all but one: the others, in the order read. */
export const TakingSome: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('checkbox', { name: 'terraform' }))
    await expect(page.getByRole('checkbox', { name: 'rm -rf' })).toHaveAccessibleDescription(
      'From .claude/settings.json, as Bash(rm -rf:*)',
    )
    await userEvent.click(page.getByRole('button', { name: 'Take 4 rules' }))
    await expect(args.onTake).toHaveBeenCalledWith(['rm', 'push', 'test', 'status'])
  },
}

/** Taken with none chosen, it says to choose one; nothing goes. */
export const ChooseFirst: Story = {
  args: { rules: MERIDIAN_IMPORT.slice(0, 1) },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('checkbox', { name: 'rm -rf' }))
    await userEvent.click(page.getByRole('button', { name: 'Take 0 rules' }))
    await expect(page.getByRole('alert')).toHaveTextContent('Choose a rule to take first.')
    await expect(args.onTake).not.toHaveBeenCalled()
  },
}

/** Turned down as the project opens: none taken. */
export const TakingNone: Story = {
  args: { onDecline: fn() },
  play: async ({ args }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Take none' }))
    await expect(args.onDecline).toHaveBeenCalledOnce()
    await expect(args.onTake).not.toHaveBeenCalled()
  },
}

/** What can't be taken opens, each with why and where it came from. */
export const WhySkipped: Story = {
  play: async () => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: '3 can’t be taken' }))
    await expect(await page.findByText('Read(./.env)')).toBeInTheDocument()
    await expect(page.getByText('No project can change this: agents reach the code host through Althar.')).toBeInTheDocument()
    await expect(page.getByText('From ~/.claude/settings.json')).toBeInTheDocument()
  },
}
