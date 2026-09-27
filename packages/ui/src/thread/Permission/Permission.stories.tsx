import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ALLOWED, PROJECT, REQUESTS, STAGING } from '../../fixtures/meridian'
import { OPUS } from '../../fixtures/models'
import { AllowedBy, Decision, PermissionScope } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Allowed, Permission, Permissions } from './Permission'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Permission',
  component: Permission,
  decorators: [threadDecorator],
  args: { ...STAGING, project: PROJECT, onAnswer: fn() },
} satisfies Meta<typeof Permission>
export default meta
type Story = StoryObj<typeof meta>

export const Asks: Story = {}

/** Keys pick an option; Enter answers. A yes beats once in violet and folds to a line with Undo. */
export const AllowOnce: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Yes, this once/ }))
    await userEvent.click(c.getByRole('button', { name: /Allow/ }))
    await waitFor(() => expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowOnce, cmd: STAGING.cmd }))
    await expect(c.getByRole('status')).toHaveTextContent('Allowed once')
  },
}

/** No, with what to do instead: the field takes focus. */
export const Denying: Story = {
  args: { text: { insteadPlaceholder: 'Use the fixture log instead' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /No, and say/ }))
    await expect(c.getByRole('textbox', { name: 'What to do instead' })).toHaveFocus()
    await expect(c.getByRole('button', { name: /Deny/ })).toBeInTheDocument()
  },
}

const ALWAYS = { decision: Decision.AllowAlways, cmd: STAGING.cmd, scope: PermissionScope.Prefix } as const

/** Answered already: from earlier in the thread, with Undo. */
export const Answered: Story = { args: { defaultAnswer: ALWAYS } }

/** A rule saved meanwhile answered it before you did. Not yours to undo. */
export const AnsweredByRule: Story = {
  args: { defaultAnswer: ALWAYS, answeredBy: { by: AllowedBy.Rule, rule: 'Meridian’s staging rule' } },
}

/** The lead answered while it waited for you. */
export const AnsweredByLead: Story = {
  args: {
    defaultAnswer: { decision: Decision.Deny, cmd: STAGING.cmd, note: 'Use the staging snapshot' },
    answeredBy: { by: AllowedBy.Lead, lead: OPUS },
  },
}

/** An agent that offers all four of ACP's answers, never-allow included. */
export const FourAnswers: Story = {
  args: { offers: [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways], defaultDecision: Decision.DenyAlways },
}

export const Stacked: Story = { render: () => <Permissions items={REQUESTS} project={PROJECT} onAnswer={fn()} /> }
/** Without a kind, "always" offers only the prefix and the exact command. */
export const NoKind: Story = { args: { kind: undefined } }

export const AllowedWithoutYou: Story = { render: () => <Allowed items={ALLOWED} project={PROJECT} /> }
export const AllowedWithoutYouOpen: Story = { render: () => <Allowed items={ALLOWED} project={PROJECT} defaultOpen /> }

/* Each answer picked, an option hovered and focused, the submit pressed, the stack, answered, and what was allowed without you. */
export const AllStates: Story = {
  parameters: statesOn({ hover: 'fieldset > div:nth-child(3) label', focus: 'fieldset input:checked', pressed: 'button[type="submit"]' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'allow once', node: <Permission {...args} /> },
        { state: 'always, scoped', node: <Permission {...args} defaultDecision={Decision.AllowAlways} /> },
        {
          state: 'deny, with a note',
          node: <Permission {...args} defaultDecision={Decision.Deny} text={{ insteadPlaceholder: 'Use the fixture log instead' }} />,
        },
        { state: 'option, hover', force: 'hover', node: <Permission {...args} /> },
        { state: 'option, focus', force: 'focus', node: <Permission {...args} /> },
        { state: 'answer, pressed', force: 'pressed', node: <Permission {...args} /> },
        { state: 'no kind to scope', node: <Permission {...args} kind={undefined} defaultDecision={Decision.AllowAlways} /> },
        { state: 'no agent named', node: <Permission {...args} agent={undefined} step={undefined} /> },
        { state: 'four answers, never', node: <Permission {...args} {...FourAnswers.args} /> },
        { state: 'answered', node: <Permission {...args} {...Answered.args} /> },
        { state: 'answered by a rule', node: <Permission {...args} {...AnsweredByRule.args} /> },
        { state: 'answered by the lead', node: <Permission {...args} {...AnsweredByLead.args} /> },
        { state: 'several, stacked', node: <Permissions items={REQUESTS} project={PROJECT} /> },
        { state: 'allowed without you', node: <Allowed items={ALLOWED} project={PROJECT} /> },
        { state: 'allowed, open', node: <Allowed items={ALLOWED} project={PROJECT} defaultOpen /> },
      ]}
    />
  ),
}
