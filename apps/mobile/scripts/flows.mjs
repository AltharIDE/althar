#!/usr/bin/env node
/*
 * The app's flows, end to end, on the web build and the demo:
 * `bun run export:web && bun run flows [name…]`. Each flow opens the app in
 * Chromium at a phone's size, does what a person would, and checks what it
 * shows; a failing flow saves a screenshot to test-results/flows.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

import { serve } from './dist.mjs'

const port = Number(process.env.FLOWS_PORT ?? 8732)
const out = path.resolve(import.meta.dirname, '..', 'test-results', 'flows')
const base = `http://localhost:${port}`

/** Opens the app at `url`, still (`?live=0`), and waits for it to draw. */
const open = async (page, url) => {
  await page.goto(`${base}${url}${url.includes('?') ? '&' : '?'}live=0`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
}

const heading = (page) => page.getByText(/need(s)? you|All clear/).first()

const FLOWS = {
  'deny a permission from the home': async (page) => {
    await open(page, '/')
    assert.equal(await heading(page).textContent(), '6 need you')
    await page.getByRole('button', { name: 'Deny', exact: true }).first().click()
    await page.getByText('5 need you').waitFor()
    assert.equal(await page.getByText('Run the database migration on staging').count(), 0)
    await page.getByText('3 at work on Sam’s MacBook Pro').waitFor()
  },

  'answer a question in place': async (page) => {
    await open(page, '/')
    const answer = page.getByRole('button', { name: 'Answer', exact: true })
    assert.equal(await answer.getAttribute('aria-disabled'), 'true', 'Answer waits for a choice')
    await page.getByRole('radio', { name: /Below 640px/ }).click()
    await answer.click()
    await page.getByText('5 need you').waitFor()
  },

  'allow from the call sheet': async (page) => {
    await open(page, '/')
    await page.getByText('Run the database migration on staging').click()
    await page.getByText('Always allow, in the project’s rules').waitFor()
    await page.getByRole('button', { name: 'Allow once' }).last().click()
    await page.getByText('5 need you').waitFor()
  },

  'merge a ready change': async (page) => {
    await open(page, '/')
    await page.getByRole('button', { name: 'Review and merge' }).click()
    await page.getByText('All 14 checks passed').waitFor()
    await page.getByRole('button', { name: 'Merge' }).click()
    await page.getByText('Merged', { exact: true }).first().waitFor()
    assert.equal(await page.getByText('Working', { exact: false }).count(), 0, 'a merged task says so in its header')
    await page.goBack()
    await page.getByText('5 need you').waitFor()
  },

  'settle a finished task': async (page) => {
    await open(page, '/')
    await page.getByText('Why does the checkout test flake?').click()
    await page.getByText(/Two ways to fix it/).waitFor()
    await page.getByRole('button', { name: 'Done', exact: true }).last().click()
    await page.waitForTimeout(300)
    await page.goBack()
    await page.getByText('5 need you').waitFor()
    assert.equal(await page.getByText('Why does the checkout test flake?').count(), 0)
  },

  'start a plan now': async (page) => {
    await open(page, '/')
    await page.getByText('Starts in 2m').waitFor()
    await page.getByRole('button', { name: 'Start now' }).click()
    await page.getByText('3 at work on Sam’s MacBook Pro').waitFor()
  },

  'stop a task, asked twice': async (page) => {
    await open(page, '/task/thr_task_backfill')
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    const sure = page.getByRole('button', { name: 'Stop the task?' })
    await sure.waitFor()
    await sure.click()
    await page.waitForTimeout(400)
    assert.equal(await page.getByRole('button', { name: /^Stop/ }).count(), 0, 'a stopped task offers no Stop')
  },

  'tell the lead something': async (page) => {
    await open(page, '/task/thr_task_backfill')
    await page.getByLabel('Message to the lead').fill('Also do 2023, the same way.')
    await page.getByRole('button', { name: 'Queue', exact: true }).click()
    await page.getByText('Also do 2023, the same way.').waitFor()
    await page.waitForTimeout(600)
    const sent = await page.getByText('Also do 2023, the same way.').boundingBox()
    assert.ok(sent !== null && sent.y > 0 && sent.y + sent.height < 844, 'the thread follows what you sent into view')
    assert.equal(await page.getByLabel('Message to the lead').inputValue(), '', 'the composer clears once sent')
  },

  'ask the lead to fix a finding': async (page) => {
    await open(page, '/task/thr_task_stripe')
    assert.equal(
      await page.getByRole('button', { name: 'Ask the lead to fix it' }).count(),
      0,
      'a review a later round passed has nothing to hand on',
    )
  },

  'start a new task': async (page) => {
    await open(page, '/new')
    await page.getByRole('radio', { name: /althar-site/ }).click()
    await page.getByLabel('What should be done').fill('Add an RSS feed for the shifts')
    await page.getByRole('button', { name: 'Plan it' }).click()
    await page.waitForURL(/\/task\/thr_task_add-an-rss-feed/)
    await page.getByText('Add an RSS feed for the shifts').first().waitFor()
  },

  'ask the coordinator for work': async (page) => {
    await open(page, '/project/proj_site')
    await page.getByRole('button', { name: 'Talk to the coordinator' }).click()
    await page.getByText('Ask for what should be done').waitFor()
    await page.getByLabel('Ask the coordinator').fill('Add an RSS feed for the shifts. Keep it under 50 items.')
    await page.getByRole('button', { name: 'Queue', exact: true }).click()
    await page.getByText('Starts in 2m').waitFor()
    await page.getByRole('button', { name: 'Start now' }).click()
    await page.getByText('Implementing').first().waitFor()
  },

  'find a task and open it': async (page) => {
    await open(page, '/projects')
    await page.getByLabel('Find a task').fill('stripe')
    await page.getByText('Upgrade the Stripe SDK to v19').click()
    await page.waitForURL(/\/task\/thr_task_stripe/)
  },

  'mark a file viewed': async (page) => {
    await open(page, '/task/thr_task_stripe/diff?taskId=task_stripe&path=src%2Fwebhooks%2Fhandle.ts')
    await page.getByRole('button', { name: 'Mark viewed' }).click()
    await page.getByRole('button', { name: 'Viewed ✓' }).waitFor()
  },

  'answers wait while the Mac is away': async (page) => {
    await open(page, '/?connection=away')
    await page.getByText('Sam’s MacBook Pro is away').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Allow once' }).first().getAttribute('aria-disabled'), 'true')
    assert.equal(await page.getByRole('button', { name: 'Deny', exact: true }).first().getAttribute('aria-disabled'), 'true')
  },

  'pair with the demo Mac': async (page) => {
    await open(page, '/?connection=unpaired')
    await page.getByText('Althar, on your phone').waitFor()
    await page.getByRole('button', { name: 'Pair with your Mac' }).click()
    await page.getByRole('button', { name: 'Use the demo Mac instead' }).click()
    await page.getByText('Do these match your Mac?').waitFor()
    await page.getByRole('button', { name: 'They match' }).click()
    await page.getByText('Paired with Sam’s MacBook Pro').waitFor()
    await page.getByRole('button', { name: 'Not now' }).click()
    await page.getByText('6 need you').first().waitFor()
  },

  'refuse pairing when the words differ': async (page) => {
    await open(page, '/?connection=unpaired')
    await page.getByRole('button', { name: 'Pair with your Mac' }).click()
    await page.getByRole('button', { name: 'Use the demo Mac instead' }).click()
    await page.getByRole('button', { name: 'They don’t' }).click()
    await page.getByText('Not paired').first().waitFor()
  },

  'run the diagnostics': async (page) => {
    await open(page, '/diagnostics')
    await page.getByRole('button', { name: 'Run the checks' }).click()
    await page.getByText('All 7 checks passed').waitFor({ timeout: 10_000 })
  },
}

const wanted = new Set(process.argv.slice(2))
const flows = Object.entries(FLOWS).filter(([name]) => wanted.size === 0 || wanted.has(name))
const server = await serve(port)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
let failed = 0
try {
  for (const [name, flow] of flows) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(5_000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await flow(page)
      assert.deepEqual(errors, [], 'no errors on the page')
      console.log(`pass  ${name}`)
    } catch (error) {
      failed += 1
      await page.screenshot({ path: path.join(out, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`) })
      console.log(`FAIL  ${name}: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
    }
    await page.close()
  }
} finally {
  await browser.close()
  server.close()
}
console.log(`${flows.length - failed} of ${flows.length} flows passed`)
process.exit(failed === 0 ? 0 : 1)
