import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repository } from '../tests/repository'
import { launch, openFirstProject } from './support'

/*
 * Dictation with the real speech model, in the built app: a recording plays
 * into the window's microphone, and the speech process writes it down with
 * sherpa-onnx. The model is 670 MB, so it runs only when asked:
 * ALTHAR_REAL_SPEECH names a folder holding the model's folder
 * (parakeet-tdt-0.6b-v3-int8, with ready.json in it), ALTHAR_REAL_VOICE a
 * recording of someone speaking (WAV), and ALTHAR_REAL_WORDS what should be
 * written (a pattern). The project's code has `RefundLedger`, `useEffect` and
 * `idempotencyKey`, so a recording that says them shows them spelt as the
 * code spells them.
 */

const models = process.env.ALTHAR_REAL_SPEECH
const voice = process.env.ALTHAR_REAL_VOICE
const words = process.env.ALTHAR_REAL_WORDS ?? ''

test.skip(models === undefined || voice === undefined, 'Set ALTHAR_REAL_SPEECH and ALTHAR_REAL_VOICE to run it with the real model')

test('writes down a real voice with the real model', async () => {
  test.setTimeout(120_000)
  const home = mkdtempSync(join(tmpdir(), 'althar-speech-'))
  const meridian = repository(home, 'meridian')
  mkdirSync(join(meridian, 'src'))
  writeFileSync(join(meridian, 'src', 'RefundLedger.ts'), 'export class RefundLedger {\n  idempotencyKey = ""\n  useEffect() {}\n}\n')
  execFileSync('git', ['add', '.'], { cwd: meridian })
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@a.test', 'commit', '-q', '-m', 'Ledger'], { cwd: meridian })
  mkdirSync(join(home, 'profile', 'speech'), { recursive: true })
  symlinkSync(join(models ?? '', 'parakeet-tdt-0.6b-v3-int8'), join(home, 'profile', 'speech', 'parakeet-tdt-0.6b-v3-int8'))
  const { electronApp, page } = await launch(home, { ALTHAR_FAKE_MICROPHONE: '1' })
  try {
    await openFirstProject(electronApp, page, meridian)
    // The recording, played into the microphone once, then silence: Chromium's own fake microphone only beeps.
    await page.evaluate(
      async (wav) => {
        const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0))
        navigator.mediaDevices.getUserMedia = async () => {
          const context = new AudioContext()
          const source = context.createBufferSource()
          source.buffer = await context.decodeAudioData(bytes.buffer.slice(0))
          const out = context.createMediaStreamDestination()
          source.connect(out)
          source.start()
          return out.stream
        }
      },
      readFileSync(voice ?? '').toString('base64'),
    )
    const box = page.getByRole('textbox', { name: /^Tell .* something/ })
    await page.getByRole('button', { name: 'Dictate', exact: true }).click()
    const stop = page.getByRole('button', { name: /^Stop dictating/ })
    // Words show as they are said.
    await expect(page.locator('[aria-hidden="true"][class*="interim"]')).not.toHaveText('', { timeout: 30_000 })
    process.stdout.write(`Heard so far: ${await page.locator('[aria-hidden="true"][class*="interim"]').innerText()}\n`)
    await page.screenshot({ path: 'test-results/dictation-real-live.png', animations: 'disabled' })
    // Past the end of the recording, so all of it is heard.
    await expect(stop).toHaveAccessibleName(/Stop dictating, 0:1\d/, { timeout: 30_000 })
    await stop.click()
    await expect(box).toHaveValue(new RegExp(words), { timeout: 60_000 })
    await page.screenshot({ path: 'test-results/dictation-real.png', animations: 'disabled' })
    process.stdout.write(`Heard: ${await box.inputValue()}\n`)
  } finally {
    await electronApp.close()
  }
})
