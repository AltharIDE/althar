import type { ReportItem } from '../chrome/ReportProblem/ReportProblem'

/*
 * A report about Meridian's task, for the stories of ReportProblem: the
 * window as it was, drawn as SVG so a story needs no file, and what goes
 * with it, as the app lists it under See what's sent.
 */

export const WINDOW_SHOT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="840" viewBox="0 0 1280 840">` +
    `<rect width="1280" height="840" fill="#f4f2ec"/>` +
    `<rect width="1280" height="40" fill="#ebe8e0"/>` +
    [0, 1, 2].map((i) => `<circle cx="${22 + i * 20}" cy="20" r="6" fill="#d6d2c8"/>`).join('') +
    `<rect x="96" y="10" width="120" height="20" rx="6" fill="#ffffff"/>` +
    `<text x="110" y="25" font-family="Helvetica, Arial" font-size="12" fill="#26262b">Meridian</text>` +
    `<text x="64" y="104" font-family="Helvetica, Arial" font-size="24" font-weight="600" fill="#26262b">Retry the checkout call</text>` +
    [0, 1, 2]
      .map((i) => `<rect x="64" y="${140 + i * 64}" width="${760 - i * 120}" height="44" rx="8" fill="#ffffff" stroke="#e4e2dc"/>`)
      .join('') +
    `<rect x="64" y="350" width="760" height="120" rx="10" fill="#ffffff" stroke="#c9c2f2"/>` +
    `<text x="84" y="384" font-family="Helvetica, Arial" font-size="13" fill="#5b4bd6">STUCK · Implement</text>` +
    `<text x="84" y="414" font-family="Helvetica, Arial" font-size="15" fill="#26262b">Claude Code closed before finishing the step.</text>` +
    `</svg>`,
)}`

export const REPORT_ITEMS: ReportItem[] = [
  { id: 'app', label: 'Althar', value: '0.4.0, Electron 44.5.0' },
  { id: 'system', label: 'System', value: 'macOS 26.5, arm64' },
  { id: 'agent-claude-code', label: 'Claude Code', value: '2.1.263, adapter 0.88.0, signed in' },
  { id: 'agent-codex', label: 'Codex', value: '0.149.0, adapter 2.1.1, signed out' },
  { id: 'agent-opencode', label: 'OpenCode', value: 'Not on this Mac' },
  { id: 'screen', label: 'Screen', value: 'Task, task_7f3a… in proj_41c2…' },
  { id: 'profile', label: 'Profile', value: '18 migrations, the last 0018_questions' },
  { id: 'install', label: 'Install id', value: '3f0c9a52-6b1e-4f7d-9a0e-2c5b8d71e4aa' },
  { id: 'screenshot', label: 'Screenshot', value: 'This window, as it was', with: 'screenshot' },
  { id: 'errors', label: 'Last errors', value: '3 lines', with: 'logs' },
  { id: 'log-main', label: 'main.log', value: 'Its last 12 KB', with: 'logs' },
  { id: 'log-runtime', label: 'runtime.log', value: 'Its last 41 KB', with: 'logs' },
  { id: 'log-agents', label: 'agents.log', value: 'Its last 96 KB', with: 'logs' },
]
