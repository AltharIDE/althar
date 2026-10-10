import type { MemoryDetail } from '@althar/contracts'
import { BackCrumb, Button } from '@althar/ui'

import { PartPending } from '../../shared/Pending'
import s from './Memory.module.css'
import type { MemoryModel } from './useMemory'

export function MemoryView({
  model,
  onBack,
  onSource,
}: {
  model: MemoryModel
  onBack: () => void
  onSource: (entry: MemoryDetail) => void
}) {
  const entry = model.detail
  return (
    <div className={s.window}>
      <main className={s.main}>
        <div className={s.back}>
          <BackCrumb to={model.project} onBack={onBack} />
        </div>
        <header>
          <h1>Project memory</h1>
          <p>
            Work and outcomes remembered automatically across tasks and agents. Reports keep their sources; they are not project
            instructions.
          </p>
        </header>
        <div className={s.controls}>
          <label className={s.search}>
            Search project memory
            <input
              type="search"
              value={model.query}
              maxLength={2000}
              placeholder="An approach, file, or failure…"
              onChange={(event) => model.search(event.target.value)}
            />
          </label>
          <label>
            <input type="checkbox" checked={model.includeRetired} onChange={(event) => model.showRetired(event.target.checked)} /> Include
            retired
          </label>
          <Button size="small" variant="quiet" onClick={model.refresh}>
            Refresh
          </Button>
        </div>
        {model.error !== null && (
          <p role="alert" className={s.error}>
            {model.error}
          </p>
        )}
        {model.pending > 0 && <output>{model.pending} source updates are still being processed. Refresh to catch up.</output>}
        <div className={s.panes}>
          <section className={s.results} aria-label="Memory results">
            {model.loading ? (
              <PartPending label="Reading project memory" />
            ) : model.entries.length === 0 ? (
              <p className={s.empty}>
                {model.query
                  ? 'No matching memories. Try another term.'
                  : 'As agents work, their reports, plans, and tool outcomes will appear here.'}
              </p>
            ) : (
              model.entries.map((item) => (
                <button key={item.id} className={s.item} aria-pressed={model.selected === item.id} onClick={() => model.select(item.id)}>
                  <span className={s.meta}>
                    {item.taskTitle ?? 'Project conversation'} · {item.agentId ?? (item.kind === 'user_message' ? 'Person' : 'Althar')} ·{' '}
                    {item.state}
                  </span>
                  <span className={s.excerpt}>{item.text}</span>
                  <span className={s.meta}>
                    {item.kind.replaceAll('_', ' ')} · {new Date(item.createdAt).toLocaleString()}
                  </span>
                </button>
              ))
            )}
            <div className={s.pages}>
              <Button size="small" disabled={model.offset === 0} onClick={() => model.page(Math.max(0, model.offset - 25))}>
                Previous
              </Button>
              <Button
                size="small"
                disabled={model.entries.length < 25 || model.offset >= 100000}
                onClick={() => model.page(model.offset + 25)}
              >
                Next
              </Button>
            </div>
          </section>
          <section className={s.detail} aria-label="Memory evidence">
            {model.detailLoading ? (
              <PartPending label="Reading source evidence" />
            ) : entry === null ? (
              <p className={s.empty}>
                {model.selected === null ? 'Select a memory to inspect its evidence and history.' : 'This memory is no longer available.'}
              </p>
            ) : (
              <>
                <div className={s.actions}>
                  <Button size="small" onClick={() => onSource(entry)}>
                    Open source thread
                  </Button>
                  <Button size="small" variant="quiet" busy={model.busy} onClick={model.changeState}>
                    {entry.state === 'active' ? 'Retire memory' : 'Restore memory'}
                  </Button>
                </div>
                <h2>{entry.taskTitle ?? 'Project conversation'}</h2>
                <p className={s.meta}>
                  {entry.agentId ?? (entry.kind === 'user_message' ? 'Person' : 'Althar')} · {entry.kind.replaceAll('_', ' ')} ·{' '}
                  {entry.state} · revision {entry.revision}
                </p>
                <p className={s.note}>
                  {entry.state === 'retired'
                    ? 'Retired evidence is excluded from automatic context. Its source remains intact.'
                    : 'Historical evidence may no longer apply. Agent reports can contain hypotheses; tool failure alone does not establish a cause.'}
                </p>
                {entry.relatedUpdates.length > 0 && (
                  <section aria-label="Related updates">
                    <h3>Possible corrections and updates</h3>
                    <p className={s.note}>
                      These reports explicitly revise an earlier account. Inspect their sources before treating a correction as established.
                    </p>
                    {entry.relatedUpdates.map((update) => (
                      <button key={update.id} className={s.item} onClick={() => model.select(update.id)}>
                        <span className={s.meta}>
                          {update.agentId ?? (update.kind === 'user_message' ? 'Person' : 'Althar')} ·{' '}
                          {new Date(update.createdAt).toLocaleString()}
                        </span>
                        <span className={s.excerpt}>{update.text}</span>
                      </button>
                    ))}
                  </section>
                )}
                <h3>Recorded evidence</h3>
                <pre>{entry.source.text}</pre>
                <div className={s.pages}>
                  <Button
                    size="small"
                    disabled={entry.source.offset === 0}
                    onClick={() => model.sourcePage(Math.max(0, entry.source.offset - 16000))}
                  >
                    Earlier evidence
                  </Button>
                  <Button
                    size="small"
                    disabled={entry.source.nextOffset === null}
                    onClick={() => {
                      if (entry.source.nextOffset !== null) model.sourcePage(entry.source.nextOffset)
                    }}
                  >
                    More evidence
                  </Button>
                </div>
                {entry.source.truncated && (
                  <p className={s.note}>Source excerpt shortened. Use Earlier evidence and More evidence to read other pages.</p>
                )}
                <h3>Repository context at capture</h3>
                {entry.bases.length === 0 ? (
                  <p className={s.note}>No repository base was recorded.</p>
                ) : (
                  entry.bases.map((base, index) => (
                    <p key={`${base.repository} · {base.ref}-${index}`} className={s.base}>
                      {base.repository} · {base.ref}
                      <br />
                      {base.branch} · {base.commit ?? 'unknown commit'}
                    </p>
                  ))
                )}
                <h3>Indexed source revisions</h3>
                {entry.history.length === 0 ? (
                  <p className={s.note}>No indexed revision history.</p>
                ) : (
                  entry.history.map((revision) => (
                    <details key={revision.sourceRevision}>
                      <summary>
                        Revision {revision.sourceRevision} · {new Date(revision.recordedAt).toLocaleString()}
                      </summary>
                      <pre>{revision.text}</pre>
                    </details>
                  ))
                )}
                {entry.historyTruncated && <p className={s.note}>Only the most recent source history is shown.</p>}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
