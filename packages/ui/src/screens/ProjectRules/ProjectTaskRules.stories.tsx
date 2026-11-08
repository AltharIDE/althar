import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  exampleName,
  MERIDIAN_ACCOUNTS,
  MERIDIAN_BRANCHES,
  MERIDIAN_BRANCHES_APART,
  MERIDIAN_TEMPLATES,
  MERIDIAN_TITLES,
} from '../../fixtures/rules'
import { LimitPolicy, TaskEnd } from '../../foundations/vocabulary'
import { ProjectTaskRules, type ProjectTaskRulesProps } from './ProjectRules'

/** The sentences with their values kept as they are changed, as the app keeps them; each change also goes to its spy. */
function Live(args: ProjectTaskRulesProps) {
  const [end, setEnd] = useState(args.end)
  const [limit, setLimit] = useState(args.limit)
  const [rotate, setRotate] = useState(args.rotate)
  const [allowed, setAllowed] = useState(args.allowed)
  const [branch, setBranch] = useState(args.branches.value)
  return (
    <ProjectTaskRules
      {...args}
      end={end}
      onEndChange={(next) => {
        setEnd(next)
        args.onEndChange(next)
      }}
      branches={{ ...args.branches, value: branch, onChange: setBranch }}
      limit={limit}
      onLimitChange={(next) => {
        setLimit(next)
        args.onLimitChange(next)
      }}
      rotate={rotate}
      onRotateChange={(next) => {
        setRotate(next)
        args.onRotateChange(next)
      }}
      allowed={allowed}
      onAllowedChange={(agent, ids) => {
        setAllowed({ ...allowed, [agent]: ids })
        args.onAllowedChange(agent, ids)
      }}
    />
  )
}

const meta = {
  title: 'Screens/ProjectTaskRules',
  component: ProjectTaskRules,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 984 }}>{Story()}</div>],
  render: (args) => <Live {...args} />,
  args: {
    end: TaskEnd.DraftPr,
    onEndChange: fn(),
    branches: { value: null, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES },
    titles: { value: '{key}: {title}', onChange: fn(), exampleOf: exampleName, fallback: '{title}', repositories: MERIDIAN_TITLES },
    templates: MERIDIAN_TEMPLATES,
    limit: LimitPolicy.Move,
    onLimitChange: fn(),
    agentAccounts: MERIDIAN_ACCOUNTS,
    rotate: false,
    onRotateChange: fn(),
    allowed: {},
    onAllowedChange: fn(),
  },
} satisfies Meta<typeof ProjectTaskRules>
export default meta
type Story = StoryObj<typeof meta>

/** Meridian's tasks: a draft pull request when one is finished, and the work moving to another model when an account runs out. */
export const AtRest: Story = {}

/** The repositories name branches each their own way: the sentence says so, and the name opens where each comes from. */
export const NamesApart: Story = {
  args: {
    branches: { value: null, exampleOf: exampleName, fallback: 'althar/{key}-{slug}', repositories: MERIDIAN_BRANCHES_APART },
    templates: MERIDIAN_TEMPLATES.map((each) => ({ ...each, path: null })),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await expect(c.getByRole('button', { name: 'Althar’s own words' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'as each repository says' }))
    await expect(await page.findByText('CONTRIBUTING.md says feat/{key}-{slug}')).toBeInTheDocument()
  },
}

/** A pattern of the person's own, typed in its popover: Enter gives it, and the sentence shows what it makes. */
export const NamingBranches: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'feat/MER-128-refund-banner' }))
    const field = await page.findByRole('textbox', { name: 'Branch names' })
    await userEvent.type(field, 'team/{{slug}{Enter}')
    await expect(c.getByRole('button', { name: 'team/refund-banner' })).toBeInTheDocument()
  },
}

/** Pushing the branch only: the sentence says so, and what a pull request opened from it would be titled. */
export const PushOnly: Story = { args: { end: TaskEnd.PushOnly, limit: LimitPolicy.Wait } }

/** When an account runs out, the step waits for the person: the sentence says what they'll choose between. */
export const LimitAsks: Story = {
  args: { limit: LimitPolicy.Ask },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('listitem', { name: 'Limits' })).toHaveTextContent(
      'When an account runs out, the work waits for you to move it to a model with usage left, or to wait for the reset.',
    )
  },
}

/** The three things a limit can do, from its word; asking is one. */
export const ChoosingALimit: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'moves to the strongest model with usage left' }))
    await expect(await page.findAllByRole('menuitemradio')).toHaveLength(3)
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Ask me' }))
    await expect(args.onLimitChange).toHaveBeenCalledWith(LimitPolicy.Ask)
    await expect(c.getByRole('button', { name: 'waits for you' })).toBeInTheDocument()
  },
}

/** Work goes on with an agent's next account: the limit sentence says that comes first, and the accounts read in order. */
export const NextAccount: Story = { args: { rotate: true } }

/** An agent's accounts: which this project may use, the last one kept, and whether work goes on with the next. */
export const ChoosingAccounts: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Personal' }))
    await userEvent.click(await page.findByRole('menuitemcheckbox', { name: 'Personal' }))
    await expect(args.onAllowedChange).toHaveBeenCalledWith('claude-code', ['work'])
    await expect(page.getByRole('menuitemcheckbox', { name: 'Work' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Go on with the next' }))
    await expect(args.onRotateChange).toHaveBeenCalledWith(true)
  },
}

/** The one account this project named is gone: work runs on every one again, and the sentence says so. */
export const AccountGone: Story = {
  args: { allowed: { 'claude-code': ['removed'] } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(c.getByRole('button', { name: 'Personal' }))
    await expect(await page.findByRole('menuitemcheckbox', { name: 'Personal' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menuitemcheckbox', { name: 'Work' })).toHaveAttribute('aria-checked', 'true')
  },
}

/** With no agent of several accounts, the limit sentence stands alone. */
export const OneAccountEach: Story = { args: { agentAccounts: [] } }
