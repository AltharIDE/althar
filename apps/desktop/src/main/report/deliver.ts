import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Assembled, Picture } from './bundle'
import { readable } from './bundle'
import { zip } from './zip'

/*
 * Where a report goes (DEV-61). With the Worker's address in the app's
 * config, it is posted there as a form: the report, the screenshot and the
 * logs, as the Worker's contract has them (apps/report); the Worker makes a
 * Linear issue of it. With none, it is saved in Downloads as a zip, shown in
 * the file manager, and a message to Althar's address opens in the person's
 * mail app for them to attach it to.
 */

/** How long the Worker has to answer. */
const WAIT = 30_000

export type Delivered = { readonly kind: 'sent' } | { readonly kind: 'saved'; readonly file: string }

const pictureName = (picture: Picture) => (picture.type === 'image/jpeg' ? 'screenshot.jpg' : 'screenshot.png')

/** Why a report didn't go, in words the window shows. */
export class NotDelivered extends Error {}

/** Where reports are posted, where the address is one the app may post to: https, or a local one for `wrangler dev`; the Worker's address alone posts to its /reports. */
export const reportAddress = (configured: string | undefined): string | null => {
  if (configured === undefined || configured.trim() === '') return null
  try {
    const url = new URL(configured.trim())
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !local) return null
    // The Worker's own address takes reports at /reports (apps/report).
    if (url.pathname === '/' || url.pathname === '') url.pathname = '/reports'
    return url.toString()
  } catch {
    return null
  }
}

/** The report as the Worker's form takes it, encoded, with the content type that names its boundary. */
export const form = async (report: Assembled): Promise<{ readonly body: ArrayBuffer; readonly type: string }> => {
  const data = new FormData()
  data.set('report', JSON.stringify(report.json))
  if (report.screenshot !== null)
    data.set(
      'screenshot',
      new Blob([Buffer.from(report.screenshot.bytes)], { type: report.screenshot.type }),
      pictureName(report.screenshot),
    )
  if (report.logs !== null) data.set('logs', new Blob([report.logs], { type: 'text/plain' }), 'logs.txt')
  const encoded = new Response(data)
  return { body: await encoded.arrayBuffer(), type: encoded.headers.get('content-type') ?? 'multipart/form-data' }
}

/** What the Worker said went wrong, from its JSON, or its status. */
const refusal = async (response: Response) => {
  try {
    const said: unknown = await response.json()
    if (typeof said === 'object' && said !== null && 'error' in said && typeof said.error === 'string') return said.error
  } catch {
    // Not JSON.
  }
  return `It answered ${response.status}.`
}

/** Posts the report to the Worker. */
export const post = async (
  address: string,
  report: Assembled,
  fetch: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Delivered> => {
  const { body, type } = await form(report)
  const response = await fetch(address, {
    method: 'POST',
    headers: { 'content-type': type },
    body,
    signal: AbortSignal.timeout(WAIT),
  }).catch((cause: unknown) => {
    throw new NotDelivered(
      cause instanceof Error && cause.name === 'TimeoutError'
        ? 'Althar’s reports service didn’t answer.'
        : 'Althar couldn’t reach its reports service.',
    )
  })
  if (response.status === 429) throw new NotDelivered('Too many reports in the last minute. Try again in a minute.')
  if (!response.ok) throw new NotDelivered(`Althar’s reports service didn’t take it. ${await refusal(response)}`)
  return { kind: 'sent' }
}

/** A name for the zip in `folder` that nothing there has yet: althar-report-2026-10-11-1405.zip, then -2, -3. */
export const zipName = (folder: string, at: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stem = `althar-report-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}.zip` : `${stem}-${n}.zip`
    if (!existsSync(join(folder, name))) return name
  }
}

/** The mail the person sends the zip with: to Althar's address, with what they wrote, cut to what a mailto link holds. */
export const mailto = (to: string, report: Assembled, file: string): string => {
  const said = report.json.text.length > 1_500 ? `${report.json.text.slice(0, 1_500)}…` : report.json.text
  const subject = `Althar: ${
    said
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim()
      .slice(0, 80) ?? 'a problem'
  }`
  const body = `${said}\n\n(The report from Althar is in Downloads as ${file}. Attach it to this message.)\n`
  // An address as it is, where it is a plain one; anything else encoded, so it can't add to the link.
  const address = /^[\w.+-]+@[\w.-]+$/.test(to) ? to : encodeURIComponent(to)
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Saves the report as a zip in `folder`, and gives its name. */
export const save = async (folder: string, report: Assembled, at = new Date()): Promise<string> => {
  const name = zipName(folder, at)
  const encode = (text: string) => new TextEncoder().encode(text)
  await writeFile(
    join(folder, name),
    zip(
      [
        { name: 'report.txt', data: encode(readable(report)) },
        { name: 'report.json', data: encode(`${JSON.stringify(report.json, null, 2)}\n`) },
        ...(report.logs === null ? [] : [{ name: 'logs.txt', data: encode(report.logs) }]),
        ...(report.screenshot === null ? [] : [{ name: pictureName(report.screenshot), data: report.screenshot.bytes }]),
      ],
      at,
    ),
  )
  return name
}
