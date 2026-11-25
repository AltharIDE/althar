// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { permissionApprovalPage } from '../src/permissionApprovalPage'

/** The browser's globals this test reads, as jsdom gives them: the runtime's own types have no DOM. */
interface Shown {
  readonly textContent: string | null
  readonly hidden: boolean
  click(): void
  compareDocumentPosition(other: Shown): number
}
interface Browser {
  readonly document: {
    readonly body: { innerHTML: string }
    getElementById(id: string): Shown | null
    querySelector(selector: string): Shown | null
  }
  readonly location: { hash: string }
  readonly navigator: object
  readonly Node: { readonly DOCUMENT_POSITION_FOLLOWING: number }
}
const { document, location, navigator, Node } = globalThis as unknown as Browser

/*
 * The page a home serves to confirm a permission with a security key, or to
 * register one, drawn and run as the browser would: its markup in the
 * document, its script against the broker's answers, the key's ceremony
 * answered here.
 */

const scriptOf = (html: string) => {
  const script = /<script nonce="n">([\s\S]*)<\/script>/.exec(html)?.[1]
  if (script === undefined) throw new Error('The page has no script.')
  return script
}

/** Draws the page and runs its script, the broker answering `view` to the view and `{}` (or `exported`) to the rest. */
const open = async (enrollment: boolean, view: object, exported: object = {}) => {
  const html = permissionApprovalPage('n', enrollment)
  document.body.innerHTML = /<main>[\s\S]*<\/main>/.exec(html)?.[0] ?? ''
  location.hash = '#code'
  const calls: Array<string> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify(url.endsWith('/view') ? view : url.endsWith('/export') ? exported : {}))
    }),
  )
  vi.stubGlobal('PublicKeyCredential', { parseRequestOptionsFromJSON: (x: unknown) => x, parseCreationOptionsFromJSON: (x: unknown) => x })
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { get: async () => ({ toJSON: () => ({}) }), create: async () => ({ toJSON: () => ({}) }) },
  })
  URL.createObjectURL = () => 'blob:key'
  // oxlint-disable-next-line typescript/no-implied-eval -- the page's own script, run against the globals stubbed here
  new Function(scriptOf(html))()
  await vi.waitFor(() => expect(document.getElementById('confirm')?.hidden).toBe(false))
  return calls
}

const text = (id: string) => document.getElementById(id)?.textContent ?? ''
const shown = (id: string) => document.getElementById(id)?.hidden === false

const approval = (more: object) => ({
  title: 'Run a command',
  command: 'git push origin main',
  decision: 'allow',
  reason: null,
  scope: null,
  remembered: null,
  publicKey: {},
  ...more,
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the page that confirms a permission', () => {
  it('says a once answer as it is, with nothing kept', async () => {
    await open(false, approval({}))
    expect(text('decision')).toBe('Allow once')
    expect(shown('scope')).toBe(false)
  })

  it('shows what an exact always keeps, a command as code', async () => {
    await open(false, approval({ scope: 'exact', remembered: 'git push origin main' }))
    expect(text('decision')).toBe('Always allow')
    expect(text('scope')).toBe('Exactly git push origin main')
    expect(document.querySelector('#scope code')?.textContent).toBe('git push origin main')
  })

  it('shows the host an exact always keeps for a network request, not a command', async () => {
    await open(false, approval({ title: 'api.example.com', command: 'api.example.com', scope: 'exact', remembered: 'api.example.com' }))
    expect(text('scope')).toBe('Exactly api.example.com')
    expect(text('scope')).not.toContain('command')
    expect(document.querySelector('#scope code')?.textContent).toBe('api.example.com')
  })

  it('shows that a never for a host refuses every host under it too, as the home says', async () => {
    const host = { title: 'api.example.com', command: 'api.example.com', scope: 'exact', remembered: 'api.example.com' }
    await open(false, approval({ ...host, decision: 'reject', under: true }))
    expect(text('decision')).toBe('Never allow')
    expect(text('scope')).toBe('api.example.com and every host under it')
    expect(text('scope')).not.toContain('Exactly')
    expect(document.querySelector('#scope code')?.textContent).toBe('api.example.com')
  })

  it('shows how the commands a prefix never allows start', async () => {
    await open(false, approval({ decision: 'reject', scope: 'prefix', remembered: 'git push', reason: 'Push from the task’s branch.' }))
    expect(text('decision')).toBe('Never allow')
    expect(text('scope')).toBe('Commands starting with git push')
    expect(text('reason')).toBe('Push from the task’s branch.')
  })

  it('says a kind of request in words, not by its name in the rules', async () => {
    await open(false, approval({ scope: 'kind', remembered: 'default-branch' }))
    expect(text('scope')).toBe('Pushes to the default branch')
  })

  it('confirms with the key, and says so', async () => {
    const calls = await open(false, approval({}))
    document.getElementById('confirm')?.click()
    await vi.waitFor(() => expect(text('status')).toBe('Confirmed. You can close this page.'))
    expect(calls.at(-1)).toBe('/v1/permission-approvals/answer')
  })
})

describe('the page that sets up a security key', () => {
  it('offers the public key, then what to check before installing it, and says it is not in use yet', async () => {
    await open(true, { publicKey: {} }, { version: 1, homeId: 'home_1', origin: 'https://home.example', credentials: [] })
    expect(shown('check')).toBe(false)
    document.getElementById('confirm')?.click()
    await vi.waitFor(() => expect(text('status')).toBe('The public key is ready to download.'))
    expect(text('status')).not.toContain('Registered')
    const download = document.querySelector('a.download')
    expect(download?.textContent).toBe('Download the public key')
    // The download comes first, then the check before installing it, then what makes it work.
    const order = [download, document.getElementById('check'), document.getElementById('fingerprint'), document.getElementById('then')]
    order.slice(1).forEach((after, i) => {
      const before = order[i]
      expect(before != null && after !== null && (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(
        true,
      )
    })
    expect(text('check')).toBe('Before you install it on the home, check that its SHA-256 matches:')
    expect(text('fingerprint')).toMatch(/^[0-9a-f]{64}$/)
    expect(text('then')).toContain('once it’s installed and the home’s service has restarted')
  })
})
