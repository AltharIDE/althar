// Scrappy: E, on a project's screen: the coordinator's workbench, the app's own, with a page on it, on the conversation's right.
import { DocumentPanel, type ThreadHost, useThreadHost as useBuiltHost } from '../../../../../apps/desktop/src/renderer/shared/ThreadHost'
import { Beside, benchWidth } from '../parts/Beside'
import { useProto } from '../state'

export { DocumentPanel, type ThreadHost }

export const useThreadHost: typeof useBuiltHost = (documents, code) => {
  const host = useBuiltHost(documents, code)
  const p = useProto()
  const page = p.direction === 'E' ? p.side.thc : undefined
  if (page === undefined) return host
  // Beside the conversation, as wide as the page's workbench, not a document's.
  return {
    ...host,
    bench: { ...host.bench, width: benchWidth(p.bench) },
    workbench: (_doc, over) => <Beside thread="thc" page={page} over={over} />,
  }
}
