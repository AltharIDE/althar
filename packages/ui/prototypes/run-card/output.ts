import type { RunState } from './states'

/*
 * What each run printed, as the runtime would keep it for its console: a
 * dev server coming up and then reporting each change it picks up, a build
 * to its end, a failure with its stack. The dev server keeps printing while
 * it runs (`HMR`), a line every second or two on the page.
 */

const VITE_READY = [
  'VITE v7.1.3  ready in 412 ms',
  '',
  '➜  Local:   http://localhost:6143/',
  '➜  Network: use --host to expose',
  '➜  press h + enter to show help',
]

const ELECTRON_READY = [
  'vite v7.1.3 building SSR bundle for development...',
  '✓ 38 modules transformed.',
  'out/main/index.js  212.83 kB',
  'built in 640ms.',
  'build the electron main process successfully',
  '',
  'dev server running for the electron renderer process at:',
  '',
  '➜  Local:   http://localhost:5173/',
  '',
  'start electron app...',
]

/** What a dev server says as it picks up changes, in turn, after its clock time. */
export const HMR: readonly string[] = [
  '[vite] hmr update /directions.tsx',
  '[vite] hmr update /directions.module.css',
  '[vite] page reload main.tsx',
  '[vite] hmr update /states.ts, /directions.tsx',
  '[vite] Internal server error: /directions.tsx: Unexpected token (212:4)',
  '[vite] hmr update /directions.tsx',
  '[vite] hmr update /page.module.css',
  '[vite] hmr update /directions.tsx, /directions.module.css',
]

/** 2:41:07 PM, then on, as vite stamps its lines. */
export const stamp = (n: number) => {
  const seconds = 7 + n * 9
  return `2:${String(41 + Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} PM`
}

/** The nth line a running dev server prints after it came up. */
export const hmrLine = (n: number) => `${stamp(n)} ${HMR[n % HMR.length]}`

/** What it printed, from its start, as it stands in this state. */
export function outputOf(s: RunState): string[] {
  const ready = s.name === undefined ? ELECTRON_READY : VITE_READY
  switch (s.phase) {
    case 'starting':
      return []
    case 'up':
      return [...ready, hmrLine(0), hmrLine(1)]
    case 'stopped':
      return [...ready, hmrLine(0), hmrLine(1), hmrLine(2)]
    case 'failed':
      return [
        'error when starting dev server:',
        'Error: Port 6143 is already in use',
        '    at Server.onError (node_modules/vite/dist/node/chunks/dep-C6qYk3zB.js:45596:18)',
        '    at Server.emit (node:events:518:28)',
        '    at emitErrorNT (node:net:1972:8)',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)',
      ]
    case 'finished':
      return [
        'vite v7.1.3 building for production...',
        '✓ 412 modules transformed.',
        'dist/index.html                  0.46 kB │ gzip:  0.30 kB',
        'dist/assets/index-9a2e.css      18.02 kB │ gzip:  4.61 kB',
        'dist/assets/index-4f1c.js      212.40 kB │ gzip: 68.11 kB',
        '✓ built in 2.41s',
      ]
  }
}
