import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject, say, shown, startTask, still, toConversation } from './support'

/*
 * The browser beside the conversation (ADR-100), in a real window: a task's
 * run opens beside its thread, in a page that can reach nothing of Althar's;
 * a comment pointed on it goes in the composer, with its card, and reaches
 * the lead with its selector, text, address, size and crop; Viewport lays
 * the page out as a phone, a touch screen with a mobile browser's agent;
 * files, scripts and other schemes are refused, as is the camera; and from
 * the coordinator's run, the project goes to its conversation for its page.
 */

/** The run's page: a banner, a camera button, and links to a file, a script and a pop-up. */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Refunds</title><style>
  body { margin: 0; font: 15px/1.4 -apple-system, Helvetica, sans-serif; background: #f7f6f2; color: #26262b }
  header { height: 56px; display: flex; align-items: center; padding: 0 24px; background: #fff; font-weight: 600 }
  main { padding: 24px }
  .banner { margin: 16px 0; padding: 18px 20px; border-radius: 8px; background: #f6e3e1 }
  li { list-style: none; margin: 0 0 12px; padding: 16px 20px; border: 1px solid #e4e2dc; border-radius: 8px; background: #fff }
  ul { padding: 0 }
</style></head><body>
<header>Acme · Refunds</header>
<main>
  <h1 id="title">Refunds</h1>
  <div class="banner" data-testid="error">Something went wrong. Try again.</div>
  <ul class="refunds"><li class="refund">re_3Pq · order 88210 · €42.00</li><li class="refund">re_3Pp · order 88211 · €35.00</li></ul>
  <p><a id="file" href="file:///etc/hosts">A file</a> · <a id="other" href="vscode://file/etc/hosts">Another app</a>
  · <button id="camera">Camera</button> · <button id="popup">Pop-up</button></p>
</main>
<script>
  document.getElementById('camera').onclick = () =>
    navigator.mediaDevices.getUserMedia({ video: true }).then(() => (document.title = 'camera: allowed'), (e) => (document.title = 'camera: ' + e.name))
  document.getElementById('popup').onclick = () => window.open('data:text/html,<p>popped</p>')
</script>
</body></html>`

/** A dev server on a free port that says where it answers, as Vite does, serving the page. */
const SERVER = `const page = require('node:fs').readFileSync(require('node:path').join(__dirname, 'page.html'))
require('node:http').createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(page) }).listen(0, function () {
  console.log('  Local:   http://localhost:' + this.address().port + '/')
})
`

/** The page beside the conversation: its view's bounds, and a picture of it as it is drawn. */
interface Drawn {
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly picture: string
}

/** Runs a script in the page's own world, as the page's scripts run, and gives back what it gives. */
const inPage = <T>(electronApp: ElectronApplication, code: string) =>
  electronApp.evaluate(async ({ BrowserWindow }, script) => {
    const window = BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().includes('/renderer/index.html'))
    const view = window?.contentView.children.find((child) => 'webContents' in child)
    if (view === undefined || !('webContents' in view)) throw new Error('No page beside the conversation.')
    return (await (view as Electron.WebContentsView).webContents.executeJavaScript(script, true)) as unknown
  }, code) as Promise<T>

/** Presses on an element of the page, as the person's pointer does: moved over it, then pressed. */
const pressInPage = async (electronApp: ElectronApplication, selector: string) => {
  const box = await inPage<{ x: number; y: number }>(
    electronApp,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
  )
  await electronApp.evaluate(
    async ({ BrowserWindow }, { x, y }) => {
      const window = BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().includes('/renderer/index.html'))
      const view = window?.contentView.children.find((child) => 'webContents' in child) as Electron.WebContentsView | undefined
      if (view === undefined) throw new Error('No page beside the conversation.')
      const contents = view.webContents
      contents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) })
      contents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
      contents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 })
    },
    { x: box.x, y: box.y },
  )
}

/** The page's view, where it shows: its bounds, and a picture of it. */
const drawn = (electronApp: ElectronApplication) =>
  electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((one) => one.webContents.getURL().includes('/renderer/index.html'))
    const views = (window?.contentView.children ?? []).filter(
      (child): child is Electron.WebContentsView => 'webContents' in child && child.getVisible(),
    )
    return Promise.all(
      views.map(async (view) => ({ bounds: view.getBounds(), picture: (await view.webContents.capturePage()).toDataURL() })),
    )
  }) as Promise<ReadonlyArray<Drawn>>

/**
 * A screenshot of the window as the person sees it: the page beside the
 * conversation is a view of its own over the window's page, which the
 * window's own screenshot leaves out, so its picture is laid where it is
 * first, inside the app's root, where nothing watches for what opens over
 * the page.
 */
const shoot = async (page: Page, electronApp: ElectronApplication, path: string, of?: Locator) => {
  const views = await drawn(electronApp)
  await page.evaluate((all) => {
    for (const view of all) {
      const picture = document.createElement('img')
      picture.src = view.picture
      picture.dataset.drawn = ''
      Object.assign(picture.style, {
        position: 'fixed',
        left: `${view.bounds.x}px`,
        top: `${view.bounds.y}px`,
        width: `${view.bounds.width}px`,
        height: `${view.bounds.height}px`,
        pointerEvents: 'none',
        zIndex: '2147483647',
      })
      document.getElementById('root')?.append(picture)
    }
  }, views)
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[data-drawn]')].every((one) => one.complete))
  await (of ?? page).screenshot({ path, animations: 'disabled', scale: 'css' })
  await page.evaluate(() => {
    for (const one of document.querySelectorAll('img[data-drawn]')) one.remove()
  })
}

/** Whether the page is laid exactly where its panel keeps its place: under its bar and line, across the panel inside its edge. */
const onItsPlace = async (electronApp: ElectronApplication, panel: Locator) => {
  const [view] = await drawn(electronApp)
  const box = await panel.boundingBox()
  if (view === undefined || box === null) return false
  return Math.abs(view.bounds.x - box.x) <= 1 && Math.abs(view.bounds.x + view.bounds.width - (box.x + box.width)) <= 1
}

/** What the main process opened in the person's browser, as it would. */
const openedOutside = (electronApp: ElectronApplication) =>
  electronApp.evaluate(() => (globalThis as unknown as { opened?: Array<string> }).opened ?? [])

test('a task’s run opens beside its thread, isolated; a comment pointed on it reaches the lead with its crop; Viewport, refusals and permissions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'meridian', private: true, scripts: { dev: 'node serve.js' } }, null, 2))
  writeFileSync(join(repo, 'serve.js'), SERVER)
  writeFileSync(join(repo, 'page.html'), PAGE)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 't@althar.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 't@althar.test',
  }
  execFileSync('git', ['add', '.'], { cwd: repo, env })
  execFileSync('git', ['commit', '-q', '-m', 'Serve'], { cwd: repo, env })
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
    await startTask(page, 'Fix the refunds banner')
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Open task/ }).click()
    await toConversation(page)

    // The task's run, from its menu: its card in the thread opens it beside the conversation.
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('dialog', { name: 'What it runs' }).getByRole('button', { name: 'Run npm run dev' }).click()
    await page.keyboard.press('Escape')
    const open = page.getByRole('button', { name: /^Open localhost:\d+$/ }).last()
    await expect(open).toBeVisible()
    const address = (await open.getAttribute('aria-label'))?.replace('Open ', '') ?? ''
    await open.click()
    const panel = page.getByRole('complementary', { name: 'Page' })
    await expect(panel.getByRole('textbox', { name: 'Address' })).toHaveValue(address)
    await expect.poll(() => inPage<string>(electronApp, 'document.title')).toBe('Refunds')
    // The thread and its composer stay beside it, and the page is laid on its panel's place.
    await expect(page.getByRole('textbox', { name: /^Tell .* something/ })).toBeVisible()
    await expect.poll(() => onItsPlace(electronApp, panel)).toBe(true)
    await still(page)
    await shoot(page, electronApp, 'test-results/browser-beside.png')

    // The page reaches nothing of Althar's: no bridge, no Node, no pictures of Althar's own.
    expect(
      await inPage(
        electronApp,
        `(async () => ({
          bridge: typeof window.althar,
          node: typeof require + ' ' + typeof process,
          picture: await fetch('althar-picture://shot/' + '0'.repeat(64)).then(() => 'read', () => 'refused'),
        }))()`,
      ),
    ).toEqual({ bridge: 'undefined', node: 'undefined undefined', picture: 'refused' })

    // p takes the page away, and brings it back as it was.
    await page.getByRole('textbox', { name: /^Tell .* something/ }).blur()
    await page.keyboard.press('p')
    await expect(panel).toHaveCount(0)
    await page.keyboard.press('p')
    await expect(panel.getByRole('textbox', { name: 'Address' })).toHaveValue(address)

    // Comment points at the page; a press on the banner opens the comment box over a picture of it.
    await panel.getByRole('button', { name: 'Comment' }).click()
    await expect(panel.getByRole('button', { name: 'Comment' })).toHaveAttribute('aria-pressed', 'true')
    await pressInPage(electronApp, '.banner')
    const box = page.getByRole('textbox', { name: 'Comment on div.banner' })
    await expect(box).toBeFocused()
    await box.fill('Say what happened: too many refunds at once.')
    await still(page)
    await panel.screenshot({ path: 'test-results/browser-commenting.png', scale: 'css', animations: 'disabled' })
    await box.press('Enter')
    // It waits in the composer with its crop and number; pointed at, its card says what the lead will get.
    const chip = page.getByRole('button', { name: 'Comment 1: Say what happened: too many refunds at once.' })
    await expect(chip).toBeVisible()
    await expect.poll(() => inPage<number>(electronApp, 'document.querySelectorAll("althar-overlay").length')).toBe(1)
    await chip.hover()
    await expect(shown(page, 'div[data-testid="error"]').first()).toBeVisible()
    await still(page)
    await shoot(page, electronApp, 'test-results/browser-comment-card.png')
    await page.mouse.move(10, 10)

    // Sent, the person's words go first, then the comment, with its crop as a picture: the lead gets them all.
    await say(page, 'Two things on the refunds page.')
    await expect(shown(page, /saw images: image\/png \d+ B/).last()).toBeVisible()
    // What the lead says back is what it was sent, its paragraphs as the message's.
    const echo = shown(page, 'echo: Two things on the refunds page.', { exact: true }).last().locator('xpath=..')
    await expect(echo).toContainText('Say what happened: too many refunds at once.')
    await expect(echo).toContainText('div[data-testid="error"]')
    await expect(echo).toContainText(`Page: http://${address}/`)
    await expect(echo).toContainText(/ at \d+ × \d+/)
    await expect(echo).toContainText('Picture 1 of those attached.')
    await expect(page.getByRole('button', { name: /^Comment 1/ })).toHaveCount(0)

    // Viewport: a phone's size, laid out as one, with touch and a mobile browser's agent, drawn whole beside the thread.
    await panel.getByRole('button', { name: 'Viewport' }).click()
    await page.getByRole('menuitemradio', { name: /Phone/ }).click()
    await expect(panel.getByRole('button', { name: 'Viewport: Phone' })).toBeVisible()
    await expect
      .poll(() =>
        inPage(
          electronApp,
          '({ width: innerWidth, screen: screen.width, touch: navigator.maxTouchPoints > 0, mobile: /Mobile/.test(navigator.userAgent) })',
        ),
      )
      .toEqual({ width: 390, screen: 390, touch: true, mobile: true })
    await still(page)
    await shoot(page, electronApp, 'test-results/browser-phone.png')
    // Back to the panel's own size: a computer's agent again, the page loaded afresh for it.
    const phoneLoad = await inPage<number>(electronApp, 'performance.timeOrigin')
    await panel.getByRole('button', { name: 'Viewport: Phone' }).click()
    await page.getByRole('menuitemradio', { name: /Fit the panel/ }).click()
    await expect.poll(() => inPage(electronApp, 'navigator.maxTouchPoints')).toBe(0)
    await expect.poll(() => inPage<number>(electronApp, 'performance.timeOrigin')).not.toBe(phoneLoad)
    await expect.poll(() => inPage(electronApp, 'document.readyState')).toBe('complete')

    // Refused: a file and a script typed in the address, a file and another app's link on the page, a pop-up of data. The page stays.
    const field = panel.getByRole('textbox', { name: 'Address' })
    await field.fill('file:///etc/hosts')
    await field.press('Enter')
    await expect(panel.getByText('Files on this computer don’t open here.')).toBeVisible()
    await field.fill('javascript:alert(1)')
    await field.press('Enter')
    await expect(panel.getByText('Only web pages open here.')).toBeVisible()
    await pressInPage(electronApp, '#file')
    await expect(panel.getByText('Files on this computer don’t open here.')).toBeVisible()
    await pressInPage(electronApp, '#other')
    await expect(panel.getByText('Only web pages open here.')).toBeVisible()
    await pressInPage(electronApp, '#popup')
    await expect(panel.getByText('Only web pages open here.')).toBeVisible()
    expect(await inPage(electronApp, 'location.href')).toBe(`http://${address}/`)
    expect(await openedOutside(electronApp)).toEqual([])

    // The camera, asked for: refused, and said.
    await pressInPage(electronApp, '#camera')
    await expect.poll(() => inPage(electronApp, 'document.title')).toBe('camera: NotAllowedError')
    await expect(panel.getByText(`${address} asked for the camera, which pages here don’t get.`)).toBeVisible()

    // A sign-in to one of Althar's services opens in the person's browser, and the page stays.
    await field.fill('https://github.com/login')
    await field.press('Enter')
    await expect(panel.getByText('GitHub’s sign-in opened in your browser.')).toBeVisible()
    expect(await openedOutside(electronApp)).toEqual(['https://github.com/login'])

    // Open as a tab: the page takes a tab of its own after the projects', where it was, and Back beside the task returns it.
    await panel.getByRole('button', { name: 'Open as a tab' }).click()
    // Named by its page's title, which the camera's answer above set.
    const tab = page.getByRole('list', { name: 'Pages' }).getByRole('button', { name: 'camera: NotAllowedError', exact: true })
    await expect(tab).toHaveAttribute('aria-current', 'page')
    const tabbed = page.getByRole('complementary', { name: 'Page' })
    await expect(tabbed.getByRole('textbox', { name: 'Address' })).toHaveValue(address)
    await expect.poll(async () => (await drawn(electronApp))[0]?.bounds.width ?? 0).toBeGreaterThan(1200)
    await expect.poll(() => onItsPlace(electronApp, tabbed)).toBe(true)
    expect(await inPage(electronApp, 'location.href')).toBe(`http://${address}/`)
    await still(page)
    await shoot(page, electronApp, 'test-results/browser-tab.png')
    await tabbed.getByRole('button', { name: 'Back beside the task' }).click()
    await expect(page.getByRole('list', { name: 'Pages' })).toHaveCount(0)
    await expect(panel.getByRole('textbox', { name: 'Address' })).toHaveValue(address)
    await expect.poll(async () => (await drawn(electronApp))[0]?.bounds.width ?? 9999).toBeLessThan(800)

    // The session's facts, over the page: the page steps aside for a picture of it while they show.
    await panel.getByRole('button', { name: 'Its own session' }).click()
    await expect(page.getByText('Cookies kept until the task is done.')).toBeVisible()
    await expect.poll(async () => (await drawn(electronApp)).length).toBe(0)
    await still(page)
    await page.screenshot({ path: 'test-results/browser-session.png', animations: 'disabled', scale: 'css' })
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await drawn(electronApp)).length).toBe(1)

    // Settings › Browser, from Change: where links open, how long cookies are kept, and clearing them all.
    await panel.getByRole('button', { name: 'Its own session' }).click()
    await page.getByRole('button', { name: 'Change' }).click()
    await expect(page.getByRole('heading', { name: 'Browser' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Beside the conversation' })).toBeChecked()
    await still(page)
    await page.screenshot({ path: 'test-results/browser-settings.png', animations: 'disabled', scale: 'css' })
  } finally {
    await electronApp.close()
  }
})

test('from the coordinator, the project’s run opens beside its conversation, the board stepping aside', async () => {
  const home = mkdtempSync(join(tmpdir(), 'althar-e2e-'))
  const repo = repository(home)
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'meridian', private: true, scripts: { dev: 'node serve.js' } }, null, 2))
  writeFileSync(join(repo, 'serve.js'), SERVER)
  writeFileSync(join(repo, 'page.html'), PAGE)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 't@althar.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 't@althar.test',
  }
  execFileSync('git', ['add', '.'], { cwd: repo, env })
  execFileSync('git', ['commit', '-q', '-m', 'Serve'], { cwd: repo, env })
  const { electronApp, page } = await launch(home)
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await openFirstProject(electronApp, page, repo)
    // The board is beside the conversation as the project opens, on its Home view.
    await expect(page.getByRole('radio', { name: 'Home', checked: true })).toBeVisible()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await page.getByRole('dialog', { name: 'What it runs' }).getByRole('button', { name: 'Run npm run dev' }).click()
    await page.keyboard.press('Escape')
    const open = page.getByRole('article', { name: 'Run of main' }).getByRole('button', { name: /^Open localhost:\d+$/ })
    await expect(open).toBeVisible()
    const address = (await open.getAttribute('aria-label'))?.replace('Open ', '') ?? ''
    await open.click()
    // The project goes to its conversation, and the page opens beside it, in the project's own session.
    const panel = page.getByRole('complementary', { name: 'Page' })
    await expect(panel.getByRole('textbox', { name: 'Address' })).toHaveValue(address)
    await expect(page.getByRole('radio', { name: 'Conversation', checked: true })).toBeVisible()
    await expect.poll(() => inPage<string>(electronApp, 'document.title')).toBe('Refunds')
    await expect.poll(() => onItsPlace(electronApp, panel)).toBe(true)
    await still(page)
    await shoot(page, electronApp, 'test-results/browser-coordinator.png')
    // Its session is the project's, kept until the project is removed where the person keeps cookies until a task is done.
    await panel.getByRole('button', { name: 'Its own session' }).click()
    await expect(page.getByText('The project’s own session')).toBeVisible()
    await expect(page.getByText('Cookies kept until the project is removed.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await drawn(electronApp)).length).toBe(1)
  } finally {
    await electronApp.close()
  }
})
