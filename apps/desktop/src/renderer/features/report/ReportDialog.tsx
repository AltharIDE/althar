import { keys, modKey, ReportProblem } from '@althar/ui'

import type { Host } from '../../data/services'
import { itemsOf, text } from './reportWords'
import { type ReportModel, useReport } from './useReport'

/*
 * Report a problem, wherever the window is (DEV-61): mounted once, round the
 * whole window, so it opens over the launch, a screen, or the page an update
 * that couldn't move the store shows, with no runtime needed. It hears what
 * asks for it through the host: `reportProblem` from the page, and Help in
 * the app's menu.
 */

export function ReportView({ model }: { readonly model: ReportModel }) {
  const { state } = model
  if (state.phase !== 'open') return null
  const { opened, about, preview, done } = state
  const lines = [
    about.kind === 'failed' ? text.about(about.what) : about.kind === 'update' ? text.about(text.update) : null,
    opened.via === 'mail' ? text.byMail : null,
  ].filter((line) => line !== null)
  const description = lines.length === 0 ? undefined : lines.join(' ')
  return (
    <ReportProblem
      key={opened.reportId}
      {...(opened.screenshot === null ? {} : { screenshot: opened.screenshot })}
      items={preview === null ? null : itemsOf(preview)}
      {...(opened.email === null ? {} : { defaultEmail: opened.email })}
      {...(description === undefined ? {} : { description })}
      sending={state.sending}
      {...(state.error === null ? {} : { error: state.error })}
      {...(done === null ? {} : { done: done.kind === 'sent' ? text.sent : text.saved(done.file) })}
      // The shortcut as this system writes it.
      text={{ sendKbd: modKey(keys.return) }}
      onSend={(draft) => void model.send(draft)}
      onClose={model.close}
    />
  )
}

export function ReportDialog({ host }: { readonly host: Host }) {
  const model = useReport(host.report)
  return <ReportView model={model} />
}
