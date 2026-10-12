import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SignInWay } from '../../foundations/vocabulary'
import { ACCOUNTS, FOUND } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { AccountSignIn, type AccountSignInProps, type AccountSignInStep } from './AccountSignIn'
import { Accounts } from './Accounts'

/* A sign-in is always drawn in the list, in the line it is for: here a new
   one, after Codex's plans and before its key. */
const InTheList = (props: AccountSignInProps) => (
  <Accounts
    agent="Codex"
    accounts={ACCOUNTS}
    signIn={
      props.account
        ? { account: 'acc_side', node: <AccountSignIn {...props} /> }
        : { account: null, at: 4, node: <AccountSignIn {...props} /> }
    }
  />
)

const meta = {
  title: 'Setup/AccountSignIn',
  component: AccountSignIn,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 600 }}>{Story()}</div>],
  render: (args) => <InTheList {...args} />,
  args: {
    agent: 'Codex',
    position: 5,
    step: { kind: 'choose' },
    ways: { browser: 'ChatGPT', code: true, terminal: true, key: 'OpenAI API key', console: 'OpenAI Platform', found: FOUND, choose: true },
    holds: 'you@meridian.dev',
    onWay: fn(),
    onOpen: fn(),
    onCheck: fn(),
    onPaste: fn(),
    onKey: fn(),
    onAdopt: fn(),
    onChooseFolder: fn(),
    onBack: fn(),
    onDone: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof AccountSignIn>
export default meta
type Story = StoryObj<typeof meta>

/** The ways in: the browser first, the rest as quiet links, and a word on who the browser may still be signed in as. Escape inside cancels. */
export const Choosing: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('New account')).toBeInTheDocument()
    await expect(c.getByText(/may still be signed in as you@meridian\.dev/)).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Continue with ChatGPT' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Browser)
    await userEvent.click(c.getByRole('button', { name: 'A code' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Code)
    await userEvent.click(c.getByRole('button', { name: 'In Terminal' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Terminal)
    await userEvent.click(c.getByRole('button', { name: 'OpenAI Platform' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Console)
    await userEvent.click(c.getByRole('button', { name: 'OpenAI API key' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Key)
    await userEvent.click(c.getByRole('button', { name: 'A folder on this Mac' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Folder)
    await userEvent.keyboard('{Escape}')
    await expect(args.onCancel).toHaveBeenCalledTimes(1)
    await userEvent.click(c.getByRole('button', { name: 'Cancel signing in' }))
    await expect(args.onCancel).toHaveBeenCalledTimes(2)
  },
}

/** An agent with only its browser sign-in: no links after it. */
export const OnlyTheBrowser: Story = {
  args: { ways: { browser: 'Claude' }, holds: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('or')).toBeNull()
    await expect(c.getByRole('button', { name: 'Continue with Claude' })).toBeInTheDocument()
  },
}

/** An agent that signs in with its own command: in Terminal first, then a folder another tool already signed in. */
export const InTerminalFirst: Story = {
  args: { ways: { terminal: true, found: FOUND, choose: true }, holds: undefined },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Sign in in Terminal' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Terminal)
    await expect(c.getByRole('button', { name: 'A folder on this Mac' })).toBeInTheDocument()
  },
}

/** Signing one in again, in its own line: as whoever it was, and only the ways that keep it the same account. */
export const SigningInAgain: Story = {
  args: { position: 4, account: { name: 'side', who: 'side@meridian.dev' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Sign in as side@meridian.dev' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'A code' })).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'OpenAI API key' })).toBeNull()
    await expect(c.queryByText(/may still be signed in/)).toBeNull()
  },
}

/** Waiting on the browser, with its link to open elsewhere, and a code to paste where the browser can't reach back. */
export const InTheBrowser: Story = {
  args: { step: { kind: 'browser', host: 'chatgpt.com', link: 'https://auth.openai.com/authorize?client_id=x', paste: true } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Approve on chatgpt.com in your browser')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Copy the link' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Paste a code' }))
    await userEvent.click(c.getByRole('button', { name: 'Continue' }))
    await expect(c.getByRole('alert')).toHaveTextContent('Paste the code first')
    await expect(args.onPaste).not.toHaveBeenCalled()
    await userEvent.type(c.getByRole('textbox', { name: 'The code chatgpt.com showed' }), ' AB12-CD34 {Enter}')
    await expect(args.onPaste).toHaveBeenCalledWith('AB12-CD34')
    await userEvent.click(c.getByRole('button', { name: 'Another way' }))
    await expect(args.onBack).toHaveBeenCalled()
  },
}

/** A pasted code the agent turned down. */
export const PasteRefused: Story = {
  args: { step: { kind: 'browser', host: 'chatgpt.com', paste: true, pasteError: 'That code has expired.' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Paste a code' }))
    await expect(c.getByRole('alert')).toHaveTextContent('That code has expired.')
  },
}

/** The agent's own sign-in, opened in Terminal: Althar checks when the person comes back, or when asked. */
export const InTerminal: Story = {
  args: { step: { kind: 'terminal', line: 'CODEX_HOME=~/.althar/codex/side codex login', opened: true } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Finish signing in in Terminal')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Check again' }))
    await expect(args.onCheck).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Open Terminal again' }))
    await expect(args.onOpen).toHaveBeenCalled()
  },
}

/** Back from Terminal without being signed in. */
export const NotSignedInYet: Story = {
  args: { step: { kind: 'terminal', line: 'codex login', opened: true, notYet: true } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Not signed in yet\./)).toBeInTheDocument()
  },
}

/** Where Terminal couldn't be opened: the line to run, to copy. */
export const RunItYourself: Story = {
  args: { step: { kind: 'terminal', line: 'CODEX_HOME=~/.althar/codex/side codex login', opened: false } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Run this in a terminal to sign in')).toBeInTheDocument()
    await expect(c.getByText('CODEX_HOME=~/.althar/codex/side codex login')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Open Terminal again' })).toBeNull()
  },
}

/** A one-time code to type on the provider's page, and how long it still works. */
export const WithACode: Story = {
  args: { step: { kind: 'code', code: 'WDJB-MJHT', page: 'auth.openai.com/device', lasts: '14 min' } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Enter the code at auth.openai.com/device')).toBeInTheDocument()
    await expect(c.getByText('lasts 14 min')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Open the page' }))
    await expect(args.onOpen).toHaveBeenCalled()
  },
}

/** The page is open: Althar waits for the code to be typed. */
export const CodeOpened: Story = {
  args: { step: { kind: 'code', code: 'WDJB-MJHT', page: 'auth.openai.com/device', lasts: '13 min', opened: true } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Waiting for the code')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Open the page' })).toBeNull()
  },
}

/** A key, pasted hidden, billed per use after the plans. */
export const PastingAKey: Story = {
  args: { step: { kind: 'key' } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Billed per use to the key’s account, after your plans.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Add key' }))
    await expect(c.getByRole('alert')).toHaveTextContent('Paste the key first')
    await userEvent.type(c.getByLabelText('OpenAI API key'), 'sk-proj-4f2a{Enter}')
    await expect(args.onKey).toHaveBeenCalledWith('sk-proj-4f2a')
  },
}

/** A key the provider turned down. */
export const KeyRefused: Story = {
  args: { step: { kind: 'key', error: 'OpenAI didn’t accept that key.' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('OpenAI didn’t accept that key.')
  },
}

/** Folders an account switcher already signed in, added as they are, or another the person picks. */
export const FromAFolder: Story = {
  args: { step: { kind: 'folders' } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('~/.codex-personal · codex-profiles')).toBeInTheDocument()
    const [first] = c.getAllByRole('button', { name: 'Add it' })
    if (first) await userEvent.click(first)
    await expect(args.onAdopt).toHaveBeenCalledWith('grant_personal')
    await userEvent.click(c.getByRole('button', { name: 'Another folder…' }))
    await expect(args.onChooseFolder).toHaveBeenCalled()
  },
}

/** Asking the agent who it signed in as. */
export const Checking: Story = {
  args: { step: { kind: 'checking' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Checking who Codex signed in as…')).toBeInTheDocument()
  },
}

/** Asking the provider whether it takes the key. */
export const CheckingAKey: Story = {
  args: { step: { kind: 'checking', key: true } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Checking the key…')).toBeInTheDocument()
  },
}

/** Signed in: named in its line, with the name it came with chosen to type over, who it is, and what pays. Return adds it. */
export const Naming: Story = {
  args: {
    step: { kind: 'named', name: 'Weekend', who: 'you@weekend.dev', paid: 'ChatGPT Plus', placed: 'After your plans, before the key' },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Name this account' })
    await expect(field).toHaveValue('Weekend')
    await expect(c.getByText('you@weekend.dev')).toBeInTheDocument()
    await expect(c.getByText('ChatGPT Plus')).toBeInTheDocument()
    await userEvent.clear(field)
    await userEvent.keyboard('{Enter}')
    await expect(c.getByRole('alert')).toHaveTextContent('Give it a name')
    await expect(args.onDone).not.toHaveBeenCalled()
    await userEvent.type(field, ' Side project {Enter}')
    await expect(args.onDone).toHaveBeenCalledWith('Side project')
    await userEvent.click(c.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalled()
  },
}

/** Signed in again: Done rather than Add, while it saves. */
export const NamingAgain: Story = {
  args: {
    position: 4,
    account: { name: 'side' },
    step: { kind: 'named', name: 'side', who: 'side@meridian.dev', paid: 'ChatGPT Plus', saving: true },
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    // While it saves, Return in the name keeps nothing more.
    await userEvent.type(c.getByRole('textbox'), '{Enter}{Enter}')
    await expect(args.onDone).not.toHaveBeenCalled()
  },
}

/** The browser signed in as an account already in the list: nothing was added. */
export const SameAccount: Story = {
  args: { step: { kind: 'same', name: 'Personal' } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('That’s Personal again')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'A code' }))
    await expect(args.onWay).toHaveBeenCalledWith(SignInWay.Code)
  },
}

/** The agent stopped, in its own words. */
export const Failed: Story = {
  args: { step: { kind: 'failed', said: 'error: login timed out after 300s' } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('error: login timed out after 300s')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Try again' }))
    await expect(args.onBack).toHaveBeenCalled()
  },
}

/* A sign-in from the browser to a name, as a consumer drives it. */
function Walking(args: AccountSignInProps) {
  const [step, setStep] = useState<AccountSignInStep>({ kind: 'choose' })
  return (
    <InTheList
      {...args}
      step={step}
      onWay={(way) => {
        args.onWay(way)
        setStep({ kind: 'browser', host: 'chatgpt.com' })
        setTimeout(() => setStep({ kind: 'checking' }), 150)
        setTimeout(() => setStep({ kind: 'named', name: 'weekend', who: 'you@weekend.dev', paid: 'ChatGPT Plus' }), 300)
      }}
    />
  )
}

/** All the way through: the browser, a check, and the line named. */
export const Walkthrough: Story = {
  render: (args) => <Walking {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Continue with ChatGPT' }))
    await expect(await c.findByText('Approve on chatgpt.com in your browser')).toBeInTheDocument()
    await expect(await c.findByRole('textbox', { name: 'Name this account' })).toHaveValue('weekend')
    await userEvent.click(c.getByRole('button', { name: 'Add account' }))
    await expect(args.onDone).toHaveBeenCalledWith('weekend')
  },
}

const STEPS: { state: string; step: AccountSignInStep }[] = [
  { state: 'choosing', step: { kind: 'choose' } },
  { state: 'in the browser', step: { kind: 'browser', host: 'chatgpt.com', link: 'https://auth.openai.com/authorize', paste: true } },
  { state: 'in Terminal', step: { kind: 'terminal', line: 'codex login', opened: true, notYet: true } },
  { state: 'run it yourself', step: { kind: 'terminal', line: 'CODEX_HOME=~/.althar/codex/side codex login', opened: false } },
  { state: 'a code', step: { kind: 'code', code: 'WDJB-MJHT', page: 'auth.openai.com/device', lasts: '14 min' } },
  { state: 'a key', step: { kind: 'key', error: 'OpenAI didn’t accept that key.' } },
  { state: 'a folder', step: { kind: 'folders' } },
  { state: 'checking', step: { kind: 'checking' } },
  {
    state: 'naming',
    step: { kind: 'named', name: 'weekend', who: 'you@weekend.dev', paid: 'ChatGPT Plus', placed: 'After your plans, before the key' },
  },
  { state: 'the same account', step: { kind: 'same', name: 'Personal' } },
  { state: 'failed', step: { kind: 'failed', said: 'error: login timed out after 300s' } },
]

/** Every step, each in its line. */
export const AllStates: Story = {
  render: (args) => <States size="wide" cells={STEPS.map(({ state, step }) => ({ state, node: <InTheList {...args} step={step} /> }))} />,
}
