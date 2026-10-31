// Disposable prototype. No setup commands or copies execute here.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import './style.css'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, FieldArea, FormRow, Panel, Segmented, SettingsLayout, SettingsNav } from '../../src'
import { PROJECT_GROUPS, projectSectionText } from '../../../../apps/desktop/src/renderer/features/projectSettings/sections'

const command =
  'bun install --frozen-lockfile && (cd apps/desktop && node node_modules/electron/install.js && bunx playwright install chromium)'
const directions = [
  { value: 'A', label: 'A · Repository form', kbd: 'A' },
  { value: 'B', label: 'B · Review in steps', kbd: 'B' },
  { value: 'C', label: 'C · In the task', kbd: 'C' },
]
function App() {
  const query = new URLSearchParams(location.search)
  const [direction, setDirection] = useState(query.get('d') || 'A')
  const [view, setView] = useState(query.get('view') || 'first')
  const [crowded, setCrowded] = useState(query.has('crowded'))
  const [narrow, setNarrow] = useState(query.has('narrow'))
  const [step, setStep] = useState('files')
  const [repo, setRepo] = useState('althar')
  const [line, setLine] = useState(command)
  const [files, setFiles] = useState('.env')
  const [message, setMessage] = useState('')
  const [state, setState] = useState('failed')
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,button,[role="radio"]')) return
      if (['a', 'b', 'c'].includes(event.key.toLowerCase())) {
        setDirection(event.key.toUpperCase())
        setMessage('')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const repos = crowded ? ['althar', 'api', 'marketing', 'shared-design-system-and-component-library'] : ['althar']
  const fileFields = (
    <>
      <FormRow label="Copy from your checkout" note="Only the files you list. Contents stay hidden." htmlFor="files">
        <FieldArea id="files" rows={2} value={files} onChange={(e) => setFiles(e.target.value)} className="mono" />
      </FormRow>
      <p className="note">Secrets policy awaits your decision: allow copying by default, or confirm each file.</p>
    </>
  )
  const commandField = (
    <>
      <FormRow label="Setup command" htmlFor="command" note="Runs in the new folder, before the lead starts.">
        <FieldArea id="command" rows={4} value={line} onChange={(e) => setLine(e.target.value)} className="mono" />
      </FormRow>
      <p className="note">Althar runs this with your computer’s access. The lead keeps its usual sandbox.</p>
    </>
  )
  const footer = (
    <div className="actions">
      <output className="note">{message}</output>
      <Button variant="quiet" onClick={() => setMessage('Prototype: task would start without setup.')}>
        Start without setup
      </Button>
      <Button
        variant={view === 'first' ? 'signal' : 'default'}
        onClick={() => setMessage(view === 'first' ? 'Prototype: setup approved for new tasks.' : 'Prototype: changes saved.')}
      >
        {view === 'first' ? 'Use this setup' : 'Save changes'}
      </Button>
    </div>
  )
  const facts = (
    <div className="facts">
      <p>
        Suggested from <code>bun.lock</code> and the desktop toolchain.
      </p>
      <p>Includes Electron’s binary and Chromium for Playwright.</p>
    </div>
  )
  const repoPicker = <Segmented label="Repository" options={repos.map((r) => ({ value: r, label: r }))} value={repo} onChange={setRepo} />
  const content = (
    <>
      {crowded && <div className="repositoryPicker">{repoPicker}</div>}
      <div className="repohead">
        <h3>{repo}</h3>
        <span className="note">{view === 'first' ? 'Suggested · not approved' : 'For new task folders'}</span>
      </div>
      {direction === 'B' ? (
        <>
          <Segmented
            label="Setup review"
            options={[
              { value: 'files', label: '1 · Local files' },
              { value: 'command', label: '2 · Command' },
              { value: 'review', label: '3 · Review' },
            ]}
            value={step}
            onChange={setStep}
          />
          {step === 'files' && fileFields}
          {step === 'command' && (
            <>
              {facts}
              {commandField}
            </>
          )}
          {step === 'review' && (
            <>
              <div className="summary">
                <h3>Before each task starts</h3>
                <p>
                  Copy <code>{files || 'no files'}</code> from your checkout.
                </p>
                <pre>{line || 'No setup command'}</pre>
              </div>
              {facts}
              {footer}
            </>
          )}
          {step !== 'review' && (
            <div className="actions">
              <span className="note">
                {step === 'files' ? 'Choose what comes with the folder.' : 'Review the full command before approving.'}
              </span>
              <Button onClick={() => setStep(step === 'files' ? 'command' : 'review')}>Continue</Button>
            </div>
          )}
        </>
      ) : (
        <>
          {view === 'first' && facts}
          {fileFields}
          {commandField}
          {footer}
        </>
      )}
    </>
  )
  return (
    <>
      <div className={'preview ' + (narrow ? 'narrow' : '')}>
        <header className="top">
          <strong>althar</strong>
          <span>Project settings / Running</span>
          <span className="note">Interactive prototype</span>
        </header>
        {view === 'failure' ? (
          <main className="thread">
            <p className="note">althar / New task folders come ready</p>
            <h1>New task folders come ready</h1>
            <Panel
              title={state === 'failed' ? 'Setup failed' : state === 'running' ? 'Installing dependencies' : 'Starting the lead'}
              lede={
                state === 'failed'
                  ? 'Playwright could not download Chromium. The lead hasn’t started.'
                  : state === 'running'
                    ? 'althar · the lead will start when setup finishes.'
                    : 'Setup skipped for this task.'
              }
            >
              <div className="threadbody">
                <details>
                  <summary>Setup output · althar</summary>
                  <pre>
                    {line}
                    {'\n\n'}Copied .env{'\n'}bun install completed{'\n'}Electron binary ready{'\n'}Chromium download failed: connection
                    reset
                  </pre>
                </details>
                <div className="actions">
                  <Button variant="quiet" onClick={() => setState('skipped')}>
                    Start without setup
                  </Button>
                  <Button variant="signal" onClick={() => setState('running')}>
                    Run setup again
                  </Button>
                </div>
              </div>
            </Panel>
          </main>
        ) : direction === 'C' && view === 'first' ? (
          <main className="thread">
            <p className="note">althar / New task folders come ready</p>
            <h1>New task folders come ready</h1>
            <Panel title="Prepare this project’s task folders?" lede="Review once. Use this setup for new tasks in althar.">
              <div className="threadbody">{content}</div>
            </Panel>
          </main>
        ) : (
          <SettingsLayout
            section="running"
            title={direction === 'B' && view === 'first' ? 'Review the suggested setup' : 'Running'}
            lede="Prepare each new task folder before its lead starts."
            side={
              <SettingsNav
                label="Project settings"
                value="running"
                onChange={() => setMessage('Prototype: only Running is shown.')}
                groups={PROJECT_GROUPS.map((group) => group.map((id) => ({ id, ...projectSectionText[id] })))}
              />
            }
          >
            <h2>New task folders</h2>
            {content}
          </SettingsLayout>
        )}
      </div>
      <footer className="switcher">
        <Segmented
          label="Direction"
          value={direction}
          onChange={(d) => {
            setDirection(d)
            setMessage('')
          }}
          options={directions}
        />
        <div className="tools">
          <Segmented
            label="Screen"
            value={view}
            onChange={(v) => {
              setView(v)
              setMessage('')
              setState('failed')
            }}
            options={[
              { value: 'first', label: 'First use' },
              { value: 'settings', label: 'Settings' },
              { value: 'failure', label: 'Failure' },
            ]}
          />
          <label>
            <input type="checkbox" checked={crowded} onChange={(e) => setCrowded(e.target.checked)} /> Many repos
          </label>
          <label>
            <input type="checkbox" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} /> Narrow
          </label>
        </div>
      </footer>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
