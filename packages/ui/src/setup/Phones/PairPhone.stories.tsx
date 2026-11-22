import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PairPhone } from './PairPhone'

/** A code as a home makes one: its body carries the home's id and key pin, which the print is drawn from, and a certificate's worth of bytes. */
const body = {
  protocol: 1,
  homeId: 'home_5c1e0a7d93b24f6e8a01c2d3e4f5a6b7',
  apiVersion: 1,
  origin: 'https://studio-mac.local:6769',
  tlsKeyPin: '3f2a9c4d1e8b7a6f5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b',
  tlsCertificate: 'MIIB'.padEnd(560, 'q'),
  token: 'A'.repeat(43),
  expiresAt: 1_800_000_000_000,
}
const CODE = `althar-pairing1.${btoa(JSON.stringify(body)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
const LINK = `https://althar.ai/pair#${CODE.slice('althar-pairing'.length)}`

const meta = {
  title: 'Setup/Phones/PairPhone',
  component: PairPhone,
  args: {
    home: 'This Mac',
    state: { kind: 'waiting', code: CODE, link: LINK, left: 299_000 },
    reach: 'Phones on the same Wi-Fi as this Mac reach it, at studio-mac.local.',
    onLetIn: fn(),
    onNewCode: fn(),
    onDone: fn(),
    onPairAnother: fn(),
  },
  render: (args) => (
    <div style={{ width: args.layout === 'narrow' ? 268 : 640 }}>
      <PairPhone {...args} />
    </div>
  ),
} satisfies Meta<typeof PairPhone>
export default meta
type Story = StoryObj<typeof meta>

/** The QR (a link the phone's camera opens), the home's print and words to check, the code to paste, and the time it has left. */
export const Waiting: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement)
    await expect(view.getByText('Scan it with your phone’s camera')).toBeInTheDocument()
    await expect(view.getByText('4:59')).toBeInTheDocument()
    await expect(view.getByText(CODE)).toBeInTheDocument()
    await expect(view.getByText('Your phone shows this print')).toBeInTheDocument()
    await expect(canvasElement.querySelector('svg title')?.textContent).toBe('Pairing code')
  },
}

/** Five minutes passed: the QR fades under New code, and the code can't be copied. */
export const RanOut: Story = {
  args: { state: { kind: 'expired', code: CODE, link: LINK } },
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement)
    await expect(view.getByText('This code ran out')).toBeInTheDocument()
    await userEvent.click(view.getByRole('button', { name: 'New code' }))
    await expect(args.onNewCode).toHaveBeenCalled()
  },
}

/** The phone paired: the print in the QR's place, its point lit, as the phone shows it. */
export const Paired: Story = {
  args: { state: { kind: 'paired', code: CODE, device: 'iPhone' } },
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement)
    await expect(view.getByText('iPhone is paired')).toBeInTheDocument()
    await userEvent.click(view.getByRole('button', { name: 'Pair another phone' }))
    await expect(args.onPairAnother).toHaveBeenCalled()
  },
}

/** This Mac doesn't let phones in yet: one press does. */
export const ThisMacClosed: Story = {
  args: { state: { kind: 'closed', switchable: true } },
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement)
    await userEvent.click(view.getByRole('button', { name: 'Let phones in' }))
    await expect(args.onLetIn).toHaveBeenCalled()
  },
}

/** Letting them in failed: the home says why. */
export const ThisMacRefused: Story = {
  args: { state: { kind: 'closed', switchable: true, problem: 'Phones can’t be let in: port 6769 is taken.' } },
}

/** A remote home whose host doesn't listen over HTTPS: what to run on it. */
export const RemoteClosed: Story = {
  args: { home: 'studio', state: { kind: 'closed', switchable: false } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/althar-host configure-network/)).toBeInTheDocument()
  },
}

/** The home is making the code. */
export const Making: Story = { args: { state: { kind: 'making' } } }

/** Narrow, as in a popover: the QR over what to check. */
export const Narrow: Story = { args: { layout: 'narrow' } }
