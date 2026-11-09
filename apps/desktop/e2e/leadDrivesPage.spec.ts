import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PageCall, PageDone } from '@althar/runtime/pageBridge'
import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, startTask, toConversation } from './support'

/*
 * The lead drives the page beside its task (ADR-100): asked to, the fake lead
 * opens a page there through Althar's own tools, reads its snapshot, types in
 * its field and presses its button with the real mouse, reads it again and
 * takes its screenshot, which is the page as it shows beside the thread. Then,
 * as a tool of the runtime's would, through the main process's bridge: a
 * phone's viewport takes a press where the element is, a page out of sight
 * is still read, pressed and drawn, and the guards hold for what the lead
 * asks and for where its clicks lead, each told in words.
 */

/** A refunds page: a note, a button that says what was approved, a far button, and links a guard holds. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Refunds</title><style>
  body { margin: 0; font: 15px/1.4 -apple-system, Helvetica, sans-serif; background: #f7f6f2; color: #26262b }
  header { height: 56px; display: flex; align-items: center; padding: 0 24px; background: #fff; font-weight: 600 }
  main { padding: 24px }
  input { font: inherit; padding: 6px 8px; margin-left: 8px }
  button { font: inherit; padding: 6px 14px; margin: 12px 0 }
  #far { margin-top: 1400px }
</style></head><body>
<header>Acme · Refunds</header>
<main>
  <h1>Refunds</h1>
  <label>Note <input id="note"></label>
  <p><button id="approve" type="button">Approve</button></p>
  <p id="status" role="status">Waiting</p>
  <p><a id="file" href="file:///etc/hosts">A file</a> · <a id="github" href="https://github.com/login">Sign in with GitHub</a></p>
  <iframe id="preview" title="Preview" style="width: 320px; height: 80px; border: 1px solid #ccc" srcdoc="<input id='inside' aria-label='Inside'>"></iframe>
  <button id="far" type="button">Far down</button>
</main>
<script>
  document.getElementById('approve').onclick = (event) => {
    document.getElementById('status').textContent = 'Approved: ' + document.getElementById('note').value
    console.warn('approved, trusted: ' + event.isTrusted)
  }
  document.getElementById('far').onclick = () => (document.getElementById('status').textContent = 'Far pressed')
</script>
</body></html>`

/** The page beside the conversation: its view's bounds, and a picture of it as the person sees it, at 1×. */
const beside = (electronApp: ElectronApplication) =>
  electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().includes('/renderer/index.html'))
    const view = window?.contentView.children.find(
      (child): child is Electron.WebContentsView => 'webContents' in child && child.getVisible(),
    )
    if (view === undefined) return null
    const bounds = view.getBounds()
    const picture = await view.webContents.capturePage()
    const sized = picture.getSize().width > bounds.width ? picture.resize({ width: bounds.width }) : picture
    return { bounds, png: sized.toPNG().toString('base64'), partition: view.webContents.session.storagePath ?? '' }
  })

/**
 * A picture of the page's panel as the person sees it: the page is a view of its own over the window, which the
 * window's own screenshot leaves out, so its picture is laid where it is first.
 */
const shoot = async (page: Page, electronApp: ElectronApplication, of: Locator, path: string) => {
  const view = await beside(electronApp)
  if (view === null) throw new Error('No page beside the task.')
  await page.evaluate((drawn) => {
    const picture = document.createElement('img')
    picture.src = `data:image/png;base64,${drawn.png}`
    picture.dataset.drawn = ''
    Object.assign(picture.style, {
      position: 'fixed',
      left: `${drawn.bounds.x}px`,
      top: `${drawn.bounds.y}px`,
      width: `${drawn.bounds.width}px`,
      height: `${drawn.bounds.height}px`,
      pointerEvents: 'none',
      zIndex: '2147483647',
    })
    document.getElementById('root')?.append(picture)
  }, view)
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[data-drawn]')].every((one) => one.complete))
  await of.screenshot({ path, animations: 'disabled', scale: 'css' })
  await page.evaluate(() => {
    for (const one of document.querySelectorAll('img[data-drawn]')) one.remove()
  })
}

/**
 * Runs a script in the page's own world, as its scripts run, and gives back what it gives; `'loading'` where the page
 * has no document to answer from yet (mid-reload), so a poll asks again.
 */
const inPage = <T>(electronApp: ElectronApplication, code: string) =>
  electronApp.evaluate(async ({ webContents }, script) => {
    const contents = webContents.getAllWebContents().find((one) => one.session.storagePath?.includes('task-') === true)
    if (contents === undefined) throw new Error('No page beside the task.')
    if (contents.isLoading()) return 'loading'
    return (await contents.executeJavaScript(script, true)) as unknown
  }, code) as Promise<T>

/** Asks the page what a tool of the runtime's would, through the main process's bridge. */
const drive = (electronApp: ElectronApplication, owner: string, call: PageCall) =>
  electronApp.evaluate(
    async (_, { owner, call }) =>
      (globalThis as unknown as { drivePage: (owner: string, call: unknown) => Promise<PageDone> }).drivePage(owner, call),
    { owner, call },
  )

/**
 * How far apart two pictures are: the share of their pixels that differ by
 * more than a little in any channel, or 1 where they aren't the same size.
 */
const apart = (electronApp: ElectronApplication, one: string, other: string) =>
  electronApp.evaluate(
    ({ nativeImage }, { one, other }) => {
      const a = nativeImage.createFromBuffer(Buffer.from(one, 'base64'))
      const b = nativeImage.createFromBuffer(Buffer.from(other, 'base64'))
      const size = a.getSize()
      const otherSize = b.getSize()
      if (size.width !== otherSize.width || size.height !== otherSize.height) return 1
      const x = a.toBitmap()
      const y = b.toBitmap()
      let differ = 0
      for (let i = 0; i < x.length; i += 4)
        if (Math.max(Math.abs(x[i]! - y[i]!), Math.abs(x[i + 1]! - y[i + 1]!), Math.abs(x[i + 2]! - y[i + 2]!)) > 24) differ += 1
      return differ / (x.length / 4)
    },
    { one, other },
  )

/** The lead's message, whole, once it ends with its screenshot's words. */
const leadSaid = async (page: Page) => {
  // Its paragraphs and lists are siblings in the message: the first paragraph's parent holds them all.
  const said = shown(page, /^page_open: /)
    .last()
    .locator('xpath=..')
  await expect(said).toContainText('page_screenshot: A screenshot of')
  return (await said.textContent()) ?? ''
}

test('a lead opens the page beside its task, reads it, types and clicks, and its screenshot is the page beside the thread', async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGE)
  })
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  const address = `http://localhost:${(server.address() as AddressInfo).port}/`
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const shot = join(mkdtempSync(join(tmpdir(), 'althar-shot-')), 'lead.png')
  const repo = repository(home)
  const { electronApp, page } = await launch(home)
  try {
    // Nothing goes to the person's real browser: what would is kept to look at.
    await electronApp.evaluate(({ shell }) => {
      const opened: Array<string> = []
      ;(globalThis as unknown as { opened: Array<string> }).opened = opened
      shell.openExternal = async (url: string) => void opened.push(url)
    })
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    await startTask(page, 'Approve the refund')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)

    // Asked, the lead opens the page beside its conversation, as Run's card would, with nothing open there before.
    await say(page, `[lead:page] page: ${address} shot: ${shot}`)
    const said = await leadSaid(page)
    const panel = page.getByRole('complementary', { name: 'Page' })
    await expect(panel.getByRole('textbox', { name: 'Address' })).toHaveValue(address.replace('http://', '').replace(/\/$/, ''))

    // What the lead read: the page, with references; and what it did, with the real mouse, which the page trusts.
    // (A web address in the thread is a link, which says where it opens.)
    expect(said).toMatch(/page_open: Opened http:\/\/localhost:\d+\/.* \(“Refunds”\), beside the conversation, on screen\./)
    expect(said).not.toContain('still loading')
    expect(said).toMatch(/textbox "Note" \[ref=e\d+\]/)
    expect(said).toMatch(/button "Approve" \[ref=e\d+\]/)
    expect(said).toContain('status: Approved: Refund approved')
    expect(await inPage<string>(electronApp, 'document.getElementById("status").textContent')).toBe('Approved: Refund approved')
    expect(await inPage<string>(electronApp, 'document.getElementById("note").value')).toBe('Refund approved')

    // Its screenshot is the page as it shows beside the thread, at 1×.
    const shown_ = await beside(electronApp)
    expect(shown_).not.toBeNull()
    const theirs = readFileSync(shot).toString('base64')
    expect(await apart(electronApp, theirs, shown_!.png)).toBeLessThan(0.01)
    expect(said).toContain(`as drawn beside the conversation`)

    // From here, as a tool of the runtime's would, through the main process's bridge, for the task's own page.
    const owner = `task_${/task-([0-9a-f]{32})/.exec(shown_!.partition)?.[1] ?? ''}`
    expect(owner).toMatch(/^task_[0-9a-f]{32}$/)

    // The person sees the lead at work: the element it acts on outlined, and a line under the bar, which goes once it is done.
    await expect(panel.getByText(/The lead is at work on this page/)).toHaveCount(0)
    expect((await drive(electronApp, owner, { op: 'hover', target: { selector: '#note' } })).error).toBeUndefined()
    await expect(panel.getByText(/The lead is at work on this page/)).toBeVisible()
    await shoot(page, electronApp, panel, 'test-results/lead-at-work.png')
    await expect(panel.getByText(/The lead is at work on this page/)).toHaveCount(0)

    // The console says what the press did, and the page took it as a person's.
    const logs = await drive(electronApp, owner, { op: 'logs', since: 0, kind: 'console' })
    expect(logs.value?.text).toContain('approved, trusted: true')

    // Every guard holds for what the lead asks: a file, a script, another app; a sign-in goes to the person's browser.
    for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'vscode://file/etc/hosts'])
      expect((await drive(electronApp, owner, { op: 'open', url })).error).toMatch(/stayed where it was|Only http and https/)
    const signIn = await drive(electronApp, owner, { op: 'open', url: 'https://github.com/login' })
    expect(signIn.error).toContain('GitHub’s sign-in')
    expect(await electronApp.evaluate(() => (globalThis as unknown as { opened: Array<string> }).opened)).toContain(
      'https://github.com/login',
    )
    // And for where its clicks lead: the file link leaves the page where it was, and the lead is told.
    const fileLink = await drive(electronApp, owner, { op: 'click', target: { selector: '#file' }, button: 'left', double: false })
    expect(fileLink.value?.text ?? fileLink.error).toMatch(/file/i)
    expect(await inPage<string>(electronApp, 'location.href')).toBe(address)

    // A reference from an old snapshot that left the page says so in words.
    await inPage(electronApp, 'document.getElementById("approve").remove()')
    const approve = /button "Approve" \[ref=(e\d+)\]/.exec(said)?.[1] ?? 'e1'
    const stale = await drive(electronApp, owner, { op: 'click', target: { ref: approve }, button: 'left', double: false })
    expect(stale.error).toContain('isn’t on the page any more')

    // A confirm the page opens as the lead presses: the lead hears what it asks, the page waits on it, and the lead answers it.
    await inPage(
      electronApp,
      `document.getElementById('far').insertAdjacentHTML('beforebegin', '<button id="remove" type="button">Remove</button>');
      document.getElementById('remove').onclick = () => { document.getElementById('status').textContent = confirm('Remove the note?') ? 'Removed' : 'Kept' }; true`,
    )
    await electronApp.evaluate(({ BrowserWindow }) => {
      const sheets: Array<string> = []
      ;(globalThis as unknown as { sheets: Array<string> }).sheets = sheets
      for (const window of BrowserWindow.getAllWindows()) {
        window.on('sheet-begin', () => sheets.push('begin'))
        window.on('sheet-end', () => sheets.push('end'))
      }
    })
    // CI's Linux has no window manager: Electron's own message box for the page's dialog closes itself
    // after a moment there, answering the page before the lead can. Take that box away, so the page
    // waits for the lead, as it does wherever the box stays open.
    if (process.platform === 'linux')
      await electronApp.evaluate(({ webContents }) => {
        const contents = webContents.getAllWebContents().find((one) => one.session.storagePath?.includes('task-') === true)!
        contents.removeAllListeners('-run-dialog')
      })
    const confirming = await drive(electronApp, owner, { op: 'click', target: { selector: '#remove' }, button: 'left', double: false })
    expect(confirming.value?.text).toContain('As you acted, the page opened a confirm dialog saying “Remove the note?”')
    expect((await drive(electronApp, owner, { op: 'snapshot', target: null })).error).toContain(
      'The page shows a confirm dialog saying “Remove the note?”',
    )
    const accepted = await drive(electronApp, owner, { op: 'dialog', accept: true, text: null })
    expect(accepted.error ?? accepted.value?.text).toContain('Answered OK to the confirm dialog “Remove the note?”.')
    await expect.poll(() => inPage<string>(electronApp, 'document.getElementById("status").textContent')).toBe('Removed')
    // Electron's own sheet of the dialog on the window goes with the lead's answer, which it doesn't undo.
    if (process.platform === 'darwin')
      await expect
        .poll(() => electronApp.evaluate(() => (globalThis as unknown as { sheets: Array<string> }).sheets))
        .toEqual(['begin', 'end'])

    // A page that asks to stay, as one with something unsaved does, is left as the lead goes on, and the lead hears it;
    // a ref from before it loaded again is refused, as it may name something else now.
    await drive(electronApp, owner, { op: 'snapshot', target: null })
    await inPage(electronApp, `addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' }); true`)
    const reloaded = await drive(electronApp, owner, { op: 'move', move: 'reload' })
    expect(reloaded.value?.text).toContain(
      'The page asked to stay, as a page does when something in it isn’t saved; it was left all the same.',
    )
    await expect.poll(() => inPage<string>(electronApp, 'document.getElementById("status").textContent')).toBe('Waiting')
    const before = await drive(electronApp, owner, { op: 'click', target: { ref: approve }, button: 'left', double: false })
    expect(before.error).toContain('before it loaded again')

    // Under a phone's viewport, drawn smaller than its size, a press lands on the element it names.
    expect((await drive(electronApp, owner, { op: 'viewport', viewport: 'phone' })).value?.text).toContain('phone')
    await expect.poll(() => inPage<number>(electronApp, 'innerWidth')).toBe(390)
    const far = await drive(electronApp, owner, { op: 'click', target: { selector: '#far' }, button: 'left', double: false })
    expect(far.error).toBeUndefined()
    await expect.poll(() => inPage<string>(electronApp, 'document.getElementById("status").textContent')).toBe('Far pressed')
    await drive(electronApp, owner, { op: 'viewport', viewport: 'fit' })

    // The person's own input wins, in the page and in a frame of its own origin (Storybook's preview): as the lead types,
    // its text insertion is held in flight, the person loads another document in the frame and types there with a real
    // key, and the lead's action stops, and the line under the bar goes.
    await inPage(electronApp, `document.getElementById('preview').contentWindow.location.href = 'about:blank'; true`)
    await expect
      .poll(() =>
        inPage<boolean>(
          electronApp,
          `document.getElementById('preview').contentDocument?.readyState === 'complete' && document.getElementById('preview').contentDocument.body !== null`,
        ),
      )
      .toBe(true)
    await inPage(
      electronApp,
      `const inside = document.getElementById('preview').contentDocument;
      inside.body.innerHTML = "<input id='inside' aria-label='Inside'>";
      inside.getElementById('inside').focus();
      true`,
    )
    await electronApp.evaluate(async ({ webContents }) => {
      const contents = webContents.getAllWebContents().find((one) => one.session.storagePath?.includes('task-') === true)!
      const held = { release: () => undefined as void }
      ;(globalThis as unknown as { leadText: Promise<void> }).leadText = new Promise<void>((resolve) => {
        held.release = resolve
      })
      ;(globalThis as unknown as { releaseLeadText: () => void }).releaseLeadText = () => held.release()
      const original = contents.debugger.sendCommand.bind(contents.debugger)
      contents.debugger.sendCommand = async (method: string, params?: Record<string, unknown>) => {
        if (method === 'Input.insertText') {
          ;(globalThis as unknown as { leadTextHeld: boolean }).leadTextHeld = true
          await (globalThis as unknown as { leadText: Promise<void> }).leadText
          // The person typed first: the lead's text isn't sent at all.
          return {}
        }
        return original(method, params)
      }
    })
    const leadTyping = drive(electronApp, owner, {
      op: 'type',
      target: { selector: '#note' },
      text: 'Typed by the lead',
      replace: true,
      submit: false,
    })
    await expect(panel.getByText(/The lead is at work on this page/)).toBeVisible()
    // The lead's text is in flight, as if the page were slow to take it.
    await expect
      .poll(() => electronApp.evaluate(() => (globalThis as unknown as { leadTextHeld?: boolean }).leadTextHeld === true))
      .toBe(true)
    await inPage(electronApp, `document.getElementById('preview').contentDocument.getElementById('inside').focus(); true`)
    await electronApp.evaluate(({ webContents }) => {
      const contents = webContents.getAllWebContents().find((one) => one.session.storagePath?.includes('task-') === true)!
      // A real key, as a person's is: trusted, and in the frame's document.
      for (const type of ['keyDown', 'char', 'keyUp'] as const) contents.sendInputEvent({ type, keyCode: 'Y' })
    })
    await electronApp.evaluate(() => (globalThis as unknown as { releaseLeadText: () => void }).releaseLeadText())
    expect((await leadTyping).error).toContain('The person clicked, typed or scrolled in the page while you acted on it')
    // The page shows the person's work, not the lead's, and the lead isn't said to be there any more.
    expect(await inPage<string>(electronApp, 'document.getElementById("note").value')).not.toContain('Typed by the lead')
    expect(
      await inPage<string>(electronApp, `document.getElementById('preview').contentDocument.getElementById('inside').value`),
    ).toContain('Y')
    await expect(panel.getByText(/The lead is at work on this page/)).toHaveCount(0)

    // Out of sight (the task's Outputs in front), the page is still there to read, press and draw.
    await page.keyboard.press('o')
    await expect(panel).toHaveCount(0)
    const state = await drive(electronApp, owner, { op: 'state' })
    expect(state.value?.text).toMatch(/not on screen|out of sight|waiting/i)
    const typed = await drive(electronApp, owner, {
      op: 'type',
      target: { selector: '#note' },
      text: 'Typed out of sight',
      replace: true,
      submit: false,
    })
    expect(typed.error).toBeUndefined()
    expect(await inPage<string>(electronApp, 'document.getElementById("note").value')).toBe('Typed out of sight')
    const unseen = await drive(electronApp, owner, { op: 'screenshot', target: null, fullPage: false })
    expect(unseen.value?.picture?.width ?? 0).toBeGreaterThan(0)
    expect(unseen.value?.text).toContain('off screen')
    await page.keyboard.press('c')
    await expect(panel.getByRole('textbox', { name: 'Address' })).toBeVisible()
  } finally {
    await electronApp.close()
    server.close()
  }
})
