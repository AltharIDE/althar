import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { CanState } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { States } from '../../storybook/States'
import { ConnectCard, ConnectWays } from './ConnectCard'
import {
  ConnectActions,
  type ConnectCan,
  ConnectChecks,
  ConnectClip,
  ConnectCode,
  ConnectFacts,
  ConnectField,
  ConnectFound,
  ConnectPerms,
  ConnectSteps,
  ConnectText,
  ConnectWaiting,
} from './ConnectParts'

/*
 * The walk in to GitHub for Meridian, whose repositories are northwind's,
 * step by step, as Settings shows it in its panel narrowed to a card; then
 * GitLab on a company's own server, Trello's key, and Jira's token that ran
 * out. Each step is the card and the parts the consumer puts in it.
 */

const FOOT = 'Kept encrypted on this Mac. Agents never get it; they reach GitHub through Althar.'
const FOR = 'For Meridian: northwind/meridian-api and northwind/meridian-web'

const WAYS = [
  { id: 'browser', title: 'Continue with GitHub', line: 'Approve in your browser, then let Althar into northwind', brand: Brand.GitHub },
  { id: 'gh', title: 'Use gh’s sign-in', line: 'Signed in as balazs on this Mac', icon: 'terminal' as const },
  { id: 'token', title: 'Make a token', line: 'On GitHub’s token page, opened filled in', icon: 'lock' as const },
]

const PERMISSIONS = [
  { name: 'Contents', level: 'Read and write', why: 'push a task’s branch' },
  { name: 'Pull requests', level: 'Read and write', why: 'open, update and merge them' },
  { name: 'Commit statuses', level: 'Read', why: 'see them pass or fail' },
  { name: 'Actions', level: 'Read', why: 'read a failed job’s log' },
  { name: 'Issues', level: 'Read and write', why: 'read and comment' },
]

const can = (id: string, text: string, state: CanState, more: Partial<ConnectCan> = {}): ConnectCan => ({ id, text, state, ...more })

const CHECKED: ConnectCan[] = [
  can('account', 'Your GitHub account', CanState.Can, { fact: 'balazs' }),
  can('reach', 'Reaches meridian-api and meridian-web', CanState.Can, { fact: 'northwind' }),
  can('push', 'Push a task’s branch', CanState.Can),
  can('changes', 'Open, update and merge pull requests', CanState.Can),
  can('checks', 'Read checks and a failed job’s log', CanState.Can),
  can('issues', 'Read issues and comment on them', CanState.Can),
]

const CHECKING = CHECKED.map((line, i) => (i < 3 ? line : { ...line, state: CanState.Checking }))
const NO_PRS = CHECKED.map((line) =>
  line.id === 'changes'
    ? { ...line, state: CanState.Cannot, why: 'Pull requests is Read-only on this token, so a task would end on its branch.' }
    : line,
)
const FINE_GRAINED = CHECKED.map((line) =>
  line.id === 'changes' || line.id === 'issues'
    ? { ...line, state: CanState.Unknown, why: 'GitHub doesn’t show what a fine-grained token may change.' }
    : line,
)

function Ways({ onChoose = fn() }: { onChoose?: (way: string) => void }) {
  return (
    <ConnectCard brand={Brand.GitHub} title="Connect GitHub" line={FOR} foot={FOOT}>
      <ConnectWays label="Ways to connect GitHub" ways={WAYS} onChoose={onChoose} />
    </ConnectCard>
  )
}

function Code() {
  return (
    <ConnectCard brand={Brand.GitHub} title="Type this code on GitHub" pager={{ steps: 3, at: 0 }}>
      <ConnectText>github.com/login/device is open in your browser. Type the code there, then Authorize Althar.</ConnectText>
      <ConnectCode code="LNBY-V0Q5" />
      <ConnectActions>
        <ConnectWaiting>Waiting for you to approve · the code lasts 14 min</ConnectWaiting>
      </ConnectActions>
      <ConnectActions>
        <LinkButton>Open the page again</LinkButton>
        <LinkButton>Another way</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

function Install() {
  return (
    <ConnectCard brand={Brand.GitHub} title="Let Althar into northwind" pager={{ steps: 3, at: 1 }}>
      <ConnectText>
        Signed in as <b>balazs</b>. Meridian’s repositories belong to <b>northwind</b>, where Althar isn’t installed yet.
      </ConnectText>
      <ConnectActions primary>
        <Button trailingIcon="external">Install Althar on northwind</Button>
      </ConnectActions>
      <ConnectSteps items={['Choose Only select repositories.', 'Pick meridian-api and meridian-web.', 'Install.']} />
      <ConnectActions>
        <ConnectWaiting>Waiting for GitHub</ConnectWaiting>
      </ConnectActions>
      <ConnectText tone="note">If you don’t own northwind, GitHub asks its owners, and Althar carries on once they approve.</ConnectText>
    </ConnectCard>
  )
}

function Gh() {
  return (
    <ConnectCard brand={Brand.GitHub} title="Use gh’s sign-in" pager={{ steps: 2, at: 0 }}>
      <ConnectFacts
        rows={[
          { label: 'Account', value: 'balazs on github.com' },
          { label: 'Scopes', value: 'repo, workflow, read:org, gist', mono: true },
          { label: 'Reaches', value: 'Every repository balazs can, northwind’s included' },
        ]}
      />
      <ConnectText tone="note">Althar keeps its own copy of the token, encrypted. gh keeps working as it does.</ConnectText>
      <ConnectActions primary>
        <Button>Use this sign-in</Button>
        <LinkButton>Another way</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

function Make() {
  return (
    <ConnectCard brand={Brand.GitHub} title="Make a token on GitHub" pager={{ steps: 3, at: 0 }}>
      <ConnectActions primary>
        <Button trailingIcon="external">Open GitHub’s token page</Button>
      </ConnectActions>
      <ConnectText tone="note">It opens with the name, northwind as the owner, 90 days and the permissions set.</ConnectText>
      <ConnectPerms rows={PERMISSIONS} fold />
      <ConnectSteps
        items={[
          'Under Repository access, choose Only select repositories: meridian-api and meridian-web.',
          'Generate token, then copy it.',
        ]}
      />
      <ConnectActions>
        <ConnectWaiting>Waiting for a token on the clipboard</ConnectWaiting>
        <LinkButton>Paste it myself</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

function Paste({ onSubmit = fn() }: { onSubmit?: (token: string) => void }) {
  const [token, setToken] = useState('')
  return (
    <ConnectCard brand={Brand.GitHub} title="Paste the token" pager={{ steps: 3, at: 1 }}>
      <ConnectClip what="A GitHub token" shown="github_pat_11ABX····7Qx" onUse={fn()} />
      <ConnectField
        label="Or paste it"
        value={token}
        onChange={setToken}
        onSubmit={() => onSubmit(token)}
        submit="Check"
        type="password"
        mono
        placeholder="github_pat_…"
      />
      <ConnectText tone="note">Kept encrypted on this Mac, for Althar alone. It isn’t shown again.</ConnectText>
    </ConnectCard>
  )
}

function Check({ title, lines, done = false, children }: { title: string; lines: ConnectCan[]; done?: boolean; children?: ReactNode }) {
  return (
    <ConnectCard brand={Brand.GitHub} title={title} pager={{ steps: 3, at: 2 }} done={done}>
      <ConnectChecks label="What GitHub lets Althar do" items={lines} />
      {children}
    </ConnectCard>
  )
}

function Server() {
  return (
    <ConnectCard brand={Brand.GitLab} title="Halyard’s GitLab" pager={{ steps: 4, at: 0 }}>
      <ConnectField label="Server address" value="https://git.halyard.dev" onChange={fn()} type="url" />
      <ConnectFound>GitLab answers at git.halyard.dev · from Halyard’s remote, origin</ConnectFound>
      <ConnectText tone="note">On this server Althar connects with a token you make there.</ConnectText>
      <ConnectActions primary>
        <Button>Make a token</Button>
        <LinkButton>gitlab.com instead</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

function TrelloKey() {
  return (
    <ConnectCard
      brand={Brand.Trello}
      title="Make a Power-Up key on Trello"
      line="A key of yours on Trello, then a token you allow for it"
      pager={{ steps: 4, at: 0 }}
    >
      <ConnectActions primary>
        <Button trailingIcon="external">Open Trello’s Power-Up admin</Button>
      </ConnectActions>
      <ConnectSteps
        items={[
          'New: name it Althar, choose your Workspace, Create.',
          'API key › Generate a new API key.',
          'Copy the API key, not the secret beside it.',
        ]}
      />
      <ConnectField
        label="Power-Up API key"
        value="9f2c41d07be3a5c8e1f64b2d90a7c3e5b18d4f6a2e07c9b3d5f1a8e6c40b27d9"
        onChange={fn()}
        submit="Continue"
        mono
        error="That’s the Power-Up’s secret; paste its API key"
      />
    </ConnectCard>
  )
}

function JiraRanOut() {
  return (
    <ConnectCard brand={Brand.Jira} title="That token ran out" pager={{ steps: 3, at: 2 }}>
      <ConnectChecks
        label="What Jira lets Althar do"
        items={[
          can('site', 'Site', CanState.Can, { fact: 'northwind.atlassian.net' }),
          can('account', 'Your Atlassian account', CanState.Cannot, {
            why: 'Jira didn’t take this token: it may have run out, or been revoked.',
          }),
          can('read', 'Reads its issues', CanState.Waiting),
          can('move', 'Moves them through their workflow', CanState.Waiting),
          can('comment', 'Comments on issues', CanState.Waiting),
        ]}
      />
      <ConnectActions>
        <Button trailingIcon="external">Make a new one</Button>
        <LinkButton>Paste another</LinkButton>
      </ConnectActions>
    </ConnectCard>
  )
}

/* A step whose one press replaces it with the next, as a walk does. */
function Moving() {
  const [step, setStep] = useState(0)
  return step === 0 ? (
    <ConnectCard brand={Brand.GitHub} title="Make a token on GitHub" pager={{ steps: 3, at: 0 }}>
      <ConnectActions primary>
        <Button onClick={() => setStep(1)}>Open GitHub’s token page</Button>
      </ConnectActions>
    </ConnectCard>
  ) : (
    <ConnectCard brand={Brand.GitHub} title="Paste the token" pager={{ steps: 3, at: 1 }} />
  )
}

const meta = {
  title: 'Setup/ConnectCard',
  component: ConnectCard,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 420, padding: 14, borderRadius: 15, background: 'var(--frost-raised)' }}>{Story()}</div>],
  args: { title: 'Connect GitHub', brand: Brand.GitHub },
} satisfies Meta<typeof ConnectCard>
export default meta
type Story = StoryObj<typeof meta>

/** The ways in first, stacked, each saying what it needs from you. */
export const TheWaysIn: Story = {
  render: () => <Ways onChoose={fn()} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'Connect GitHub', level: 3 })).toBeInTheDocument()
    await expect(c.getByRole('group', { name: 'Ways to connect GitHub' })).toBeInTheDocument()
    await expect(c.queryByText(/^Step/)).toBeNull()
  },
}

const chose = fn()

/** Choosing a way, by pointer or keyboard, says which. */
export const ChoosingAWay: Story = {
  render: () => <Ways onChoose={chose} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const way = c.getByRole('button', { name: /Use gh’s sign-in/ })
    way.focus()
    await userEvent.keyboard('{Enter}')
    await expect(chose).toHaveBeenLastCalledWith('gh')
    await userEvent.click(c.getByRole('button', { name: /Make a token/ }))
    await expect(chose).toHaveBeenLastCalledWith('token')
  },
}

/** GitHub's device code, while Althar waits for the person to approve it. */
export const TypingTheCode: Story = {
  render: () => <Code />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Step 1 of 3')).toBeInTheDocument()
    await expect(c.getByText('LNBY-V0Q5')).toBeInTheDocument()
    await expect(c.getByRole('status')).toHaveTextContent('Waiting for you to approve')
  },
}

export const LettingAltharIn: Story = { render: () => <Install /> }

export const UsingGhsSignIn: Story = { render: () => <Gh /> }

/** The token page opens filled in; what it sets is behind a press, one thing at a time. */
export const MakingAToken: Story = {
  render: () => <Make />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('Pull requests')).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'See the 5 permissions it sets' }))
    await expect(c.getByText('Pull requests')).toBeInTheDocument()
  },
}

/** A token on the clipboard, or one pasted: Check sends it, and so does Enter. */
export const PastingIt: Story = {
  render: () => <Paste onSubmit={fn()} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('A GitHub token is on your clipboard')).toBeInTheDocument()
    const field = c.getByLabelText('Or paste it')
    await expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'github_pat_x{Enter}')
  },
}

export const Checking: Story = { render: () => <Check title="Checking what it can do" lines={CHECKING} /> }

/** One thing it can't do, with why on its line and how to put it right. */
export const CantDoOneThing: Story = {
  render: () => (
    <Check title="This token can’t open pull requests" lines={NO_PRS}>
      <ConnectText tone="note">
        Set Pull requests to Read and write, then Update. It stays the same token, so there’s nothing to paste again.
      </ConnectText>
      <ConnectActions>
        <Button trailingIcon="external">Change it on GitHub</Button>
        <LinkButton>Check again</LinkButton>
        <LinkButton>Connect as it is</LinkButton>
      </ConnectActions>
    </Check>
  ),
}

/** What the service doesn't say is said not to be known, quietly. */
export const NotKnown: Story = { render: () => <Check title="Connected as balazs" lines={FINE_GRAINED} done /> }

/** Connected: a tick on the mark, the pager full, and Done. */
export const Connected: Story = {
  render: () => (
    <Check title="Connected as balazs" lines={CHECKED} done>
      <ConnectText tone="note">The token runs out on 8 January 2027.</ConnectText>
      <ConnectActions primary>
        <Button>Done</Button>
      </ConnectActions>
    </Check>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Connected')).toBeInTheDocument()
    await expect(c.getByText('Your GitHub account').closest('li')).toHaveTextContent('Your GitHub account, it can')
  },
}

export const ACompanysServer: Story = { render: () => <Server /> }

export const AKeyThatIsntOne: Story = { render: () => <TrelloKey /> }

export const ATokenThatRanOut: Story = { render: () => <JiraRanOut /> }

/** A step that replaces the one with focus gives it to its heading. */
export const FocusMovesOn: Story = {
  render: () => <Moving />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Open GitHub’s token page' }))
    await expect(c.getByRole('heading', { name: 'Paste the token' })).toHaveFocus()
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'the ways in', node: <Ways /> },
        { state: 'a code', node: <Code /> },
        { state: 'let in', node: <Install /> },
        { state: 'gh’s sign-in', node: <Gh /> },
        { state: 'make a token', node: <Make /> },
        { state: 'paste', node: <Paste /> },
        { state: 'checking', node: <Check title="Checking what it can do" lines={CHECKING} /> },
        { state: 'one thing it can’t', node: <Check title="This token can’t open pull requests" lines={NO_PRS} /> },
        { state: 'not known', node: <Check title="Connected as balazs" lines={FINE_GRAINED} done /> },
        { state: 'connected', node: <Check title="Connected as balazs" lines={CHECKED} done /> },
        { state: 'a server', node: <Server /> },
        { state: 'a key that isn’t one', node: <TrelloKey /> },
        { state: 'ran out', node: <JiraRanOut /> },
      ]}
    />
  ),
}
