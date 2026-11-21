import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  AgentRunOutcome,
  DiagnosticOutcome,
  validWorkerProtocolId,
  type DiagnosticOffer,
  type DiagnosticLog,
  type DiagnosticResult,
} from '@althar/worker-protocol'
import type { AgentRunLedger } from '@althar/worker-protocol/agent-runs'
import {
  DIAGNOSTIC_LEASE_MS,
  DIAGNOSTIC_RENEWAL_MS,
  MAX_DIAGNOSTIC_LOG_CHUNK,
  MAX_DIAGNOSTIC_OUTPUT,
  MAX_PROJECT_LOG_BYTES,
} from '@althar/worker-protocol/grpc'

import { fileErrorCode, HostError } from './errors'
import { privateDirectory, writePrivate } from './privateFiles'

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`
const invalid = (message: string) => new HostError({ code: 'InvalidConfig', message })

const schema = `
  CREATE TABLE worker_home (key INTEGER PRIMARY KEY CHECK(key = 1), home_id TEXT NOT NULL) STRICT;
  CREATE TABLE worker_enrollment (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0, 1))
  ) STRICT;
  CREATE TABLE diagnostic (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES worker_enrollment(id),
    fence TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('queued', 'offered', 'claimed', 'succeeded', 'failed', 'unknown')),
    lease_until INTEGER,
    output BLOB CHECK(output IS NULL OR length(output) <= ${MAX_DIAGNOSTIC_OUTPUT})
  ) STRICT;
  CREATE UNIQUE INDEX diagnostic_active ON diagnostic(worker_id) WHERE state IN ('queued', 'offered', 'claimed');
  PRAGMA user_version = 1;
`

type Active = { id: string; fence: string; state: 'queued' | 'offered' | 'claimed'; lease_until: number | null }
type Project = { projectId: string; commandName: string }
const projectAttempt = (attemptId: string) => validWorkerProtocolId(attemptId, 'wpr_')

export const openWorkerStore = async (profile: string, homeId: string, now = Date.now) => {
  if (!validWorkerProtocolId(homeId, 'home_')) throw invalid('The worker store needs an initialized home')
  const folder = await privateDirectory(join(profile, 'workers'), true)
  const path = join(folder, 'ledger.sqlite')
  const inspect = async () => {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      throw new HostError({ code: 'UnsafePermissions', message: 'The worker ledger must be a private file owned by the home user' })
  }
  try {
    await inspect()
  } catch (error) {
    if (fileErrorCode(error) !== 'ENOENT') throw error
    await writePrivate(path, '', false)
    await inspect()
  }
  const db = new DatabaseSync(path)
  try {
    // Leave contention to the caller's retry. A worker must never block the home event loop on another writer.
    db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = EXTRA;')
    if (db.prepare('PRAGMA user_version').get()?.user_version === 0) {
      db.exec('BEGIN IMMEDIATE')
      if (db.prepare('PRAGMA user_version').get()?.user_version === 0) {
        db.exec(schema)
        db.prepare('INSERT INTO worker_home VALUES (1, ?)').run(homeId)
      }
      db.exec('COMMIT')
    }
    if (
      db.prepare('PRAGMA user_version').get()?.user_version !== 1 ||
      db.prepare('SELECT home_id FROM worker_home WHERE key = 1').get()?.home_id !== homeId
    ) {
      throw invalid('The worker ledger belongs to another home or uses an unsupported format')
    }

    // This table is additive. Older homes can still read and reconcile their
    // existing attempt records without interpreting the live log data.
    db.exec(`
      CREATE TABLE IF NOT EXISTS diagnostic_log (
        attempt_id TEXT PRIMARY KEY REFERENCES diagnostic(id),
        output BLOB NOT NULL CHECK(length(output) <= ${MAX_DIAGNOSTIC_OUTPUT})
      ) STRICT;
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_attempt (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL REFERENCES worker_enrollment(id),
        fence TEXT NOT NULL,
        project_id TEXT NOT NULL,
        command_name TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued', 'offered', 'claimed', 'succeeded', 'failed', 'unknown', 'cancelled')),
        lease_until INTEGER,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
        output BLOB CHECK(output IS NULL OR length(output) <= ${MAX_DIAGNOSTIC_OUTPUT})
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS project_active ON project_attempt(worker_id) WHERE state IN ('queued', 'offered', 'claimed');
      CREATE TABLE IF NOT EXISTS project_log (
        attempt_id TEXT PRIMARY KEY REFERENCES project_attempt(id),
        output BLOB NOT NULL CHECK(length(output) <= ${MAX_PROJECT_LOG_BYTES})
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_worker_journal (
        worker_id TEXT PRIMARY KEY REFERENCES worker_enrollment(id),
        journal_id TEXT NOT NULL UNIQUE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_worker_run (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL REFERENCES agent_worker_journal(worker_id),
        project_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'exited', 'stopped', 'start_failed')),
        exit_code INTEGER CHECK(exit_code IS NULL OR exit_code BETWEEN 0 AND 255)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS agent_worker_active ON agent_worker_run(worker_id) WHERE state = 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS agent_workspace_active ON agent_worker_run(workspace_id) WHERE state = 'active';
    `)
    const attempts = (table: 'diagnostic' | 'project_attempt', logs: 'diagnostic_log' | 'project_log') => {
      const appendLog = db.prepare(`
        INSERT INTO ${logs} (attempt_id, output)
        SELECT d.id, ? FROM ${table} d JOIN worker_enrollment w ON w.id = d.worker_id
        WHERE d.id = ? AND d.worker_id = ? AND d.fence = ? AND d.state = 'claimed' AND d.lease_until > ? AND w.revoked = 0
          AND coalesce((SELECT length(output) FROM ${logs} WHERE attempt_id = d.id), 0) = ?
        ON CONFLICT(attempt_id) DO UPDATE SET output = CAST(${logs}.output || excluded.output AS BLOB)
      `)
      const readLog = db.prepare(`SELECT d.state, l.output FROM ${table} d LEFT JOIN ${logs} l ON l.attempt_id = d.id WHERE d.id = ?`)

      const active = db.prepare(
        `SELECT id, fence, state, lease_until FROM ${table} WHERE worker_id = ? AND state IN ('queued', 'offered', 'claimed')`,
      )
      const offer = db.prepare(
        `UPDATE ${table} SET state = 'offered', lease_until = ? WHERE worker_id = ? AND state = 'queued' RETURNING id, fence, state, lease_until`,
      )
      const claim = db.prepare(
        `UPDATE ${table} SET state = 'claimed', lease_until = min(lease_until, ?) WHERE id = ? AND worker_id = ? AND fence = ? AND state = 'offered' AND lease_until > ? AND EXISTS (SELECT 1 FROM worker_enrollment WHERE id = ? AND revoked = 0) RETURNING lease_until`,
      )
      const renew = db.prepare(
        `UPDATE ${table} SET lease_until = ? WHERE id = ? AND worker_id = ? AND fence = ? AND state = 'claimed' AND lease_until > ? ${table === 'project_attempt' ? 'AND cancel_requested = 0' : ''} AND EXISTS (SELECT 1 FROM worker_enrollment WHERE id = ? AND revoked = 0) RETURNING lease_until`,
      )
      const complete = db.prepare(
        `UPDATE ${table} SET state = ?, output = ? WHERE id = ? AND worker_id = ? AND fence = ? AND (state = 'claimed' OR (state = 'offered' AND ? = 'unknown')) AND EXISTS (SELECT 1 FROM worker_enrollment WHERE id = ? AND revoked = 0)`,
      )
      const result = db.prepare(`SELECT id, worker_id, state, output FROM ${table} WHERE id = ?`)
      const revoke = db.prepare(`UPDATE ${table} SET state = 'unknown' WHERE worker_id = ? AND state IN ('queued', 'offered', 'claimed')`)
      return { active, offer, claim, renew, complete, result, revoke, appendLog, readLog }
    }
    const diagnostic = attempts('diagnostic', 'diagnostic_log')
    const project = attempts('project_attempt', 'project_log')
    const forAttempt = (attemptId: string) => (projectAttempt(attemptId) ? project : diagnostic)
    const enrolled = db.prepare('SELECT id FROM worker_enrollment WHERE fingerprint = ? AND revoked = 0')
    const projectDetails = db.prepare('SELECT project_id AS projectId, command_name AS commandName FROM project_attempt WHERE id = ?')
    const cancellable = db.prepare(
      "SELECT 1 FROM project_attempt WHERE worker_id = ? AND id = ? AND fence = ? AND state = 'claimed' AND cancel_requested = 1",
    )
    const availableWorker = `
      SELECT id FROM worker_enrollment WHERE id = ? AND revoked = 0
        AND NOT EXISTS (SELECT 1 FROM diagnostic WHERE worker_id = worker_enrollment.id AND state IN ('queued', 'offered', 'claimed'))
        AND NOT EXISTS (SELECT 1 FROM project_attempt WHERE worker_id = worker_enrollment.id AND state IN ('queued', 'offered', 'claimed'))
        AND NOT EXISTS (SELECT 1 FROM agent_worker_run WHERE worker_id = worker_enrollment.id AND state = 'active')
    `
    const enqueueDiagnostic = db.prepare(`
      INSERT INTO diagnostic (worker_id, id, fence, state) SELECT id, ?, ?, 'queued' FROM (${availableWorker}) RETURNING id
    `)
    const enqueueProject = db.prepare(`
      INSERT INTO project_attempt (worker_id, id, fence, project_id, command_name, state)
      SELECT id, ?, ?, ?, ?, 'queued' FROM (${availableWorker}) RETURNING id
    `)
    const journal = db.prepare(`
      INSERT INTO agent_worker_journal (worker_id, journal_id)
      SELECT id, ? FROM worker_enrollment WHERE id = ? AND revoked = 0
      ON CONFLICT(worker_id) DO UPDATE SET journal_id = excluded.journal_id
      WHERE agent_worker_journal.journal_id = excluded.journal_id
      RETURNING worker_id
    `)
    const runningAgent = db.prepare(`
      SELECT id AS runId, project_id AS projectId, provider_id AS providerId, workspace_id AS workspaceId
      FROM agent_worker_run WHERE worker_id = ? AND state = 'active'
    `)
    const beginAgent = db.prepare(`
      INSERT INTO agent_worker_run (id, worker_id, project_id, provider_id, workspace_id, state)
      SELECT ?, candidate.id, ?, ?, ?, 'active' FROM (${availableWorker}) candidate
      WHERE EXISTS (SELECT 1 FROM agent_worker_journal WHERE worker_id = candidate.id)
        AND NOT EXISTS (SELECT 1 FROM agent_worker_run WHERE workspace_id = ? AND state = 'active')
      RETURNING id
    `)
    const finishAgent = db.prepare(`
      UPDATE agent_worker_run SET state = ?, exit_code = ?
      WHERE id = ? AND worker_id = ? AND state = 'active'
    `)
    const agents: AgentRunLedger = {
      bind: (workerId, journalId) => journal.get(journalId, workerId) !== undefined,
      outstanding: (workerId) => runningAgent.get(workerId) as ReturnType<AgentRunLedger['outstanding']>,
      begin: (workerId, run) =>
        beginAgent.get(run.runId, run.projectId, run.providerId, run.workspaceId, workerId, run.workspaceId) !== undefined,
      finish: (workerId, result) => {
        const state =
          result.outcome === AgentRunOutcome.EXITED
            ? 'exited'
            : result.outcome === AgentRunOutcome.STOPPED
              ? 'stopped'
              : result.outcome === AgentRunOutcome.START_FAILED
                ? 'start_failed'
                : undefined
        return state !== undefined && finishAgent.run(state, result.exitCode ?? null, result.runId, workerId).changes === 1
      },
    }
    return {
      agents,
      close: () => db.close(),
      workerForCertificate: (fingerprint: string) => enrolled.get(fingerprint)?.id as string | undefined,
      enroll(fingerprint: string) {
        db.prepare('INSERT INTO worker_enrollment (id, fingerprint) VALUES (?, ?) ON CONFLICT(fingerprint) DO NOTHING').run(
          id('wrk'),
          fingerprint,
        )
        const workerId = enrolled.get(fingerprint)?.id
        if (typeof workerId !== 'string') throw invalid('This certificate was revoked. Enroll a replacement certificate')
        return workerId
      },
      revoke(workerId: string) {
        db.exec('BEGIN IMMEDIATE')
        try {
          const revoked = db.prepare('UPDATE worker_enrollment SET revoked = 1 WHERE id = ?').run(workerId)
          if (revoked.changes !== 1) throw invalid('No worker has that identity')
          diagnostic.revoke.run(workerId)
          project.revoke.run(workerId)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      enqueue(workerId: string, command?: Project) {
        const attemptId = id(command === undefined ? 'watt' : 'wpr')
        const fence = id('wfn')
        const row =
          command === undefined
            ? enqueueDiagnostic.get(attemptId, fence, workerId)
            : enqueueProject.get(attemptId, fence, command.projectId, command.commandName, workerId)
        if (row === undefined) throw invalid('Choose an enrolled worker with no outstanding attempt')
        return attemptId
      },
      cancel(attemptId: string) {
        const row = db
          .prepare(`
          UPDATE project_attempt
          SET state = CASE WHEN state IN ('queued', 'offered') THEN 'cancelled' ELSE state END,
              cancel_requested = CASE WHEN state = 'claimed' THEN 1 ELSE cancel_requested END
          WHERE id = ? RETURNING state, cancel_requested
        `)
          .get(attemptId)
        if (row === undefined || typeof row.state !== 'string') throw invalid('No project run has that attempt identity')
        return { attemptId, state: row.state, cancellationRequested: row.cancel_requested === 1 }
      },
      cancellationRequested(workerId: string, attemptId: string, fence: string) {
        return cancellable.get(workerId, attemptId, fence) !== undefined
      },
      result(attemptId: string) {
        const row = forAttempt(attemptId).result.get(attemptId) as
          | { id: string; worker_id: string; state: string; output: Uint8Array | null }
          | undefined
        if (row === undefined) throw invalid('No worker run has that attempt identity')
        return {
          attemptId: row.id,
          workerId: row.worker_id,
          state: row.state,
          output: row.output === null ? null : Buffer.from(row.output).toString('utf8'),
        }
      },
      next(workerId: string, supportsProjectCommands = false): Omit<DiagnosticOffer, '$typeName'> | undefined {
        const at = now()
        const next = (store: typeof diagnostic) =>
          (store.offer.get(at + DIAGNOSTIC_LEASE_MS, workerId) ?? store.active.get(workerId)) as Active | undefined
        const row = next(diagnostic) ?? (supportsProjectCommands ? next(project) : undefined)
        if (row === undefined) return
        return {
          attemptId: row.id,
          ...(projectAttempt(row.id)
            ? {
                projectCommand: { $typeName: 'althar.worker.v1.ProjectCommand', ...(projectDetails.get(row.id) as Project) },
              }
            : {}),
          fence: row.fence,
          claimableForMs: row.state === 'offered' ? Math.max(0, Math.min(DIAGNOSTIC_LEASE_MS, (row.lease_until ?? at) - at)) : 0,
        }
      },
      claim(workerId: string, attemptId: string, fence: string, maximumMs = DIAGNOSTIC_LEASE_MS) {
        const at = now()
        const row = forAttempt(attemptId).claim.get(at + maximumMs, attemptId, workerId, fence, at, workerId)
        return row === undefined ? 0 : Math.max(0, Math.min(DIAGNOSTIC_LEASE_MS, Number(row.lease_until) - now()))
      },
      renew(workerId: string, attemptId: string, fence: string, maximumMs: number) {
        const at = now()
        const row = forAttempt(attemptId).renew.get(
          at + Math.min(DIAGNOSTIC_RENEWAL_MS, maximumMs),
          attemptId,
          workerId,
          fence,
          at,
          workerId,
        )
        return row === undefined ? 0 : Math.max(0, Math.min(DIAGNOSTIC_RENEWAL_MS, Number(row.lease_until) - now()))
      },
      appendLog(workerId: string, chunk: DiagnosticLog) {
        if (
          !Number.isSafeInteger(chunk.offset) ||
          chunk.offset < 0 ||
          chunk.output.length === 0 ||
          chunk.output.length > MAX_DIAGNOSTIC_LOG_CHUNK ||
          chunk.offset + chunk.output.length > (projectAttempt(chunk.attemptId) ? MAX_PROJECT_LOG_BYTES : MAX_DIAGNOSTIC_OUTPUT)
        )
          return false
        return (
          forAttempt(chunk.attemptId).appendLog.run(chunk.output, chunk.attemptId, workerId, chunk.fence, now(), chunk.offset).changes === 1
        )
      },
      log(attemptId: string, offset: number) {
        const row = forAttempt(attemptId).readLog.get(attemptId) as { state: string; output: Uint8Array | null } | undefined
        if (row === undefined) throw invalid('No worker run has that attempt identity')
        const bytes = Buffer.from(row.output ?? [])
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length)
          throw invalid('The log offset is outside the received output')
        return { attemptId, state: row.state, offset, nextOffset: bytes.length, bytesBase64: bytes.subarray(offset).toString('base64') }
      },
      complete(workerId: string, result: DiagnosticResult) {
        const state =
          result.outcome === DiagnosticOutcome.CANCELLED
            ? 'cancelled'
            : result.outcome === DiagnosticOutcome.UNKNOWN
              ? 'unknown'
              : result.outcome === DiagnosticOutcome.SUCCEEDED
                ? 'succeeded'
                : 'failed'
        if (state === 'cancelled' && !cancellable.get(workerId, result.attemptId, result.fence)) return false
        return (
          forAttempt(result.attemptId).complete.run(state, result.output, result.attemptId, workerId, result.fence, state, workerId)
            .changes === 1
        )
      },
    }
  } catch (error) {
    db.close()
    throw error
  }
}
