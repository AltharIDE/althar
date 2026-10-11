import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CanState } from '../../foundations/vocabulary'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { States } from '../../storybook/States'
import {
  ConnectActions,
  ConnectChecks,
  ConnectClip,
  ConnectCode,
  ConnectFacts,
  ConnectField,
  type ConnectFieldProps,
  ConnectFound,
  ConnectPerms,
  ConnectSteps,
  ConnectText,
  ConnectWaiting,
} from './ConnectParts'

/* A field kept as it is typed in, the way a consumer keeps it. */
function Kept(args: Partial<ConnectFieldProps>) {
  const [value, setValue] = useState(args.value ?? '')
  return <ConnectField label="Or paste it" type="password" mono submit="Check" {...args} value={value} onChange={setValue} />
}

const SCOPES = [
  { name: 'read:repository:bitbucket' },
  { name: 'write:repository:bitbucket', why: 'push a task’s branch' },
  { name: 'read:pullrequest:bitbucket' },
  { name: 'write:pullrequest:bitbucket', why: 'open, update and merge' },
  { name: 'read:pipeline:bitbucket', why: 'build statuses and logs' },
]

const LINES = [
  { id: 'account', text: 'Your GitHub account', state: CanState.Can, fact: 'balazs' },
  { id: 'reach', text: 'Reaches meridian-api and meridian-web', state: CanState.Checking },
  { id: 'push', text: 'Push a task’s branch', state: CanState.Waiting },
  { id: 'changes', text: 'Open, update and merge pull requests', state: CanState.Cannot, why: 'Pull requests is Read-only on this token.' },
  { id: 'issues', text: 'Read issues and comment on them', state: CanState.Unknown, why: 'GitHub doesn’t show what it may change.' },
]

const submitted = fn()
const used = fn()

const meta = {
  title: 'Setup/ConnectParts',
  component: ConnectField,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 400, display: 'grid', gap: 12 }}>{Story()}</div>],
  args: { label: 'Or paste it', value: '', onChange: fn() },
} satisfies Meta<typeof ConnectField>
export default meta
type Story = StoryObj<typeof meta>

/** A field to paste into: Check, or Enter, sends what is in it; while it is checked, the press waits and says so. */
export const AField: Story = {
  render: () => <Kept onSubmit={submitted} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByLabelText('Or paste it'), 'glpat-x{Enter}')
    await expect(submitted).toHaveBeenCalledTimes(1)
    await userEvent.click(c.getByRole('button', { name: 'Check' }))
    await expect(submitted).toHaveBeenCalledTimes(2)
  },
}

/** Why what is in it won't do, under it, and the field marked; and where a value came from. */
export const AFieldSayingNo: Story = {
  render: () => <Kept value="ATTA" error="Atlassian didn’t take this token." onSubmit={fn()} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByLabelText('Or paste it')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('Atlassian didn’t take this token.')
  },
}

export const AFieldWithItsHint: Story = {
  render: () => (
    <ConnectField
      label="Your Atlassian account’s email"
      type="email"
      value="balazs@tessera.studio"
      onChange={fn()}
      hint="From Tessera’s git config"
    />
  ),
}

/** Busy: Enter doesn't send it twice. */
export const AFieldBeingChecked: Story = {
  render: () => <Kept value="glpat-x" busy onSubmit={submitted} />,
  play: async ({ canvasElement }) => {
    const before = submitted.mock.calls.length
    await userEvent.type(within(canvasElement).getByLabelText('Or paste it'), '{Enter}')
    await expect(submitted.mock.calls.length).toBe(before)
  },
}

/** A field that comes with its step takes focus as it shows. */
export const AFieldTakingFocus: Story = {
  render: () => <Kept focus />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('Or paste it')).toHaveFocus()
  },
}

/** A token on the clipboard, without its middle, and the press that takes it. */
export const OnTheClipboard: Story = {
  render: () => <ConnectClip what="A GitLab token" shown="glpat-····R2b" onUse={used} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('status')).toHaveTextContent('A GitLab token is on your clipboard')
    await userEvent.click(c.getByRole('button', { name: 'Use it' }))
    await expect(used).toHaveBeenCalled()
  },
}

/** Scopes, as code, each with what it is for. */
export const Scopes: Story = { render: () => <ConnectPerms rows={SCOPES} text={{ title: 'The scopes to tick' }} /> }

/** Folded, behind a press, which opens them. */
export const PermissionsFolded: Story = {
  render: () => <ConnectPerms rows={[{ name: 'Contents', level: 'Read and write', why: 'push a task’s branch' }]} fold />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'See the permission it sets' }))
    await expect(c.getByText('Read and write')).toBeInTheDocument()
  },
}

/** Each thing a connection can do, in every state a line can be in. */
export const WhatItCanDo: Story = {
  render: () => <ConnectChecks label="What GitHub lets Althar do" items={LINES} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const list = c.getByRole('list', { name: 'What GitHub lets Althar do' })
    await expect(list).toHaveAttribute('aria-busy', 'true')
    await expect(c.getByText('Push a task’s branch').closest('li')).toHaveTextContent('Push a task’s branch, not checked yet')
    await expect(c.getByText('Read issues and comment on them').closest('li')).toHaveTextContent('Read issues and comment on them, not known')
  },
}

export const TheRest: Story = {
  render: () => (
    <>
      <ConnectText>
        Signed in as <b>balazs</b>. Meridian’s repositories belong to <b>northwind</b>.
      </ConnectText>
      <ConnectText tone="note">It opens with the name Althar and the api scope ticked.</ConnectText>
      <ConnectCode code="LNBY-V0Q5" />
      <ConnectCode code="LNBY-V0Q5" compact />
      <ConnectSteps items={['Set when it runs out.', 'Create token, then copy it.']} />
      <ConnectFacts
        rows={[
          { label: 'Account', value: 'balazs on github.com' },
          { label: 'Scopes', value: 'repo, workflow', mono: true },
        ]}
      />
      <ConnectFound>GitLab answers at git.halyard.dev</ConnectFound>
      <ConnectFound tone="no">Nothing answers at git.halyard.dev</ConnectFound>
      <ConnectActions>
        <ConnectWaiting>Waiting for a token on the clipboard</ConnectWaiting>
        <LinkButton>Paste it myself</LinkButton>
      </ConnectActions>
    </>
  ),
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'field', node: <Kept /> },
        { state: 'field, saying no', node: <Kept value="ATTA" error="Atlassian didn’t take this token." /> },
        { state: 'field, checking', node: <Kept value="glpat-x" busy /> },
        { state: 'clipboard', node: <ConnectClip what="A GitHub token" shown="github_pat_11ABX····7Qx" onUse={fn()} /> },
        { state: 'clipboard, taking it', node: <ConnectClip what="A GitHub token" shown="github_pat_11ABX····7Qx" onUse={fn()} busy /> },
        { state: 'scopes', node: <ConnectPerms rows={SCOPES} /> },
        { state: 'permissions, folded', node: <ConnectPerms rows={SCOPES} fold /> },
        { state: 'what it can do', node: <ConnectChecks label="What it can do" items={LINES} /> },
        { state: 'a code', node: <ConnectCode code="LNBY-V0Q5" /> },
        { state: 'found', node: <ConnectFound>GitLab answers at git.halyard.dev</ConnectFound> },
        { state: 'not found', node: <ConnectFound tone="no">Nothing answers at git.halyard.dev</ConnectFound> },
      ]}
    />
  ),
}
