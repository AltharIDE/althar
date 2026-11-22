import type { NativeCall, NativeWindow } from '../../computer/protocol'
import type { ComputerWorker } from './worker'

const FIRST: NativeWindow = { pid: 21, handle: '1', app: 'Writer', title: 'Computer Writer fixture' }
const SECOND: NativeWindow = { pid: 22, handle: '2', app: 'Reader', title: 'Computer Reader fixture' }
const PICTURE = {
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B3ioAAAAASUVORK5CYII=',
} as const

/** A deterministic desktop for the application test. The native driver has its own graphical smoke. */
export const testComputerWorker = (): ComputerWorker => {
  const written = new Map<string, string>()
  let exported = ''
  const run: ComputerWorker['run'] = (call: NativeCall) => {
    const target = 'target' in call ? call.target : 'desktop'
    const key = target === 'desktop' ? target : target.handle
    switch (call.op) {
      case 'inventory':
        return Promise.resolve({ kind: 'inventory', value: { apps: [], windows: [FIRST, SECOND] } })
      case 'launch':
        return Promise.resolve({ kind: 'launched', windows: [] })
      case 'observe': {
        const id = '12345678-1234-1234-1234-123456789abc'
        return Promise.resolve({
          kind: 'observed',
          observation: id,
          answer: {
            text: `Observation ${id}\ne1 textbox "Note" "${written.get(key) ?? ''}"\ne2 button "${key === FIRST.handle ? 'Export' : 'Import'} note"`,
          },
          ...(call.screenshot ? { picture: PICTURE } : {}),
        })
      }
      case 'act':
        if (call.action.op === 'type') written.set(key, call.action.text)
        if (call.action.op === 'click' && 'element' in call.action.at && call.action.at.element === 'e2') {
          if (key === FIRST.handle) exported = written.get(key) ?? ''
          if (key === SECOND.handle) written.set(key, exported)
        }
        return Promise.resolve({ kind: 'acted', answer: { text: 'Input sent.' } })
    }
  }
  return { run, stop: () => Promise.resolve() }
}
