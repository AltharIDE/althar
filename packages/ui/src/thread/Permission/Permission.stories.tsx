import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ALLOWED, BY_RULE, MANY, PROJECT, REQUESTS, STAGING } from '../../fixtures/meridian'
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
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Allowed once'))
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

/** Allow always by how the command starts: the scope is picked beside the answer, and the answer says it. */
export const AllowAlwaysByPrefix: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Yes, and always allow/ }))
    await userEvent.click(c.getByRole('combobox', { name: 'What to always allow' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: /commands starting/ }))
    await userEvent.click(c.getByRole('button', { name: /Allow/ }))
    await waitFor(() =>
      expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowAlways, cmd: STAGING.cmd, scope: PermissionScope.Prefix }),
    )
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Allowed always'))
  },
}

/** Kept for you by the always-ask list: an allow rule wouldn't hold, so Allow always isn't offered. Never allow is, by each scope. */
export const HeldForYou: Story = {
  args: {
    offers: [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways],
    scopes: { [Decision.AllowAlways]: [], [Decision.DenyAlways]: [PermissionScope.Exact, PermissionScope.Prefix, PermissionScope.Kind] },
    defaultDecision: Decision.DenyAlways,
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('radio', { name: /Yes, and always allow/ })).toBeNull()
    await expect(c.getByRole('combobox', { name: 'What to never allow' })).toBeInTheDocument()
  },
}

/** Only one scope would hold, and it reaches past this command: it is said rather than offered. */
export const OnlyByPrefix: Story = {
  args: { scopes: { [Decision.AllowAlways]: [PermissionScope.Prefix] }, defaultDecision: Decision.AllowAlways },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('combobox')).toBeNull()
    await expect(c.getByText('commands starting')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /Allow/ }))
    await waitFor(() =>
      expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowAlways, cmd: STAGING.cmd, scope: PermissionScope.Prefix }),
    )
  },
}

export const Stacked: Story = { render: () => <Permissions items={REQUESTS} project={PROJECT} onAnswer={fn()} /> }

/** Allow all allows each once; the card in front beats for all of them, then the stack folds to one line. */
export const AllowAll: Story = {
  render: (args) => <Permissions items={REQUESTS} project={PROJECT} onAnswer={args.onAnswer} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Allow all 3' }))
    await waitFor(() => expect(args.onAnswer).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Allowed 3'))
  },
}

/** Many at once: never more than two behind the front card. */
export const ManyAtOnce: Story = { render: () => <Permissions items={MANY} project={PROJECT} onAnswer={fn()} /> }

/** A stack of one is a card, and folds as one. */
export const StackOfOne: Story = {
  render: (args) => <Permissions items={[STAGING]} project={PROJECT} onAnswer={args.onAnswer} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /Allow all/ })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: /Allow/ }))
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Allowed once'))
  },
}
/** Without a kind, "always" offers only the prefix and the exact command. */
export const NoKind: Story = { args: { kind: undefined } }

export const AllowedWithoutYou: Story = { render: () => <Allowed items={ALLOWED} project={PROJECT} /> }
export const AllowedWithoutYouOpen: Story = { render: () => <Allowed items={ALLOWED} project={PROJECT} defaultOpen /> }

/** A rule answered, in a thread with no steps to tell apart: the command and the rule. */
export const AllowedByRule: Story = { render: () => <Allowed items={BY_RULE} project={PROJECT} defaultOpen /> }

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
        { state: 'held for you, never', node: <Permission {...args} {...HeldForYou.args} /> },
        { state: 'one scope, said', node: <Permission {...args} {...OnlyByPrefix.args} /> },
        { state: 'several, stacked', node: <Permissions items={REQUESTS} project={PROJECT} /> },
        { state: 'many at once', node: <Permissions items={MANY} project={PROJECT} /> },
        { state: 'allowed without you', node: <Allowed items={ALLOWED} project={PROJECT} /> },
        { state: 'allowed, open', node: <Allowed items={ALLOWED} project={PROJECT} defaultOpen /> },
        { state: 'allowed by a rule', node: <Allowed items={BY_RULE} project={PROJECT} defaultOpen /> },
      ]}
    />
  ),
}
