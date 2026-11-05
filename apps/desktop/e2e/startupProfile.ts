import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { Database } from '../../../packages/persistence-sqlite/src/index'
import { Effect, Layer } from 'effect'

/** A populated, idle profile of its own: 24 projects, 1,200 tasks and their threads; 48 open tasks. No real repositories or sign-ins. */
export const startupProfile = async (home: string) => {
  const profile = join(home, 'profile')
  mkdirSync(profile, { recursive: true })
  const filename = join(profile, 'althar.sqlite')
  await Effect.runPromise(Effect.scoped(Layer.build(Database.layer({ filename }))))
  const db = new DatabaseSync(filename)
  const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`
  const at = '2026-11-01T10:00:00.000Z'
  try {
    db.exec('PRAGMA foreign_keys = ON; BEGIN')
    const person = id('act')
    const coordinator = id('act')
    const actor = db.prepare('INSERT INTO actors (id, kind, display_name, agent_id, created_at) VALUES (?, ?, ?, ?, ?)')
    actor.run(person, 'person', 'You', null, at)
    actor.run(coordinator, 'agent', 'Coordinator', 'coordinator', at)
    const project = db.prepare('INSERT INTO projects (id, name, slug, created_by_actor_id, created_at) VALUES (?, ?, ?, ?, ?)')
    const thread = db.prepare('INSERT INTO threads (id, project_id, kind, owner_actor_id, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    const task = db.prepare(
      'INSERT INTO tasks (id, project_id, title, slug, state, created_by_actor_id, created_at, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (let p = 0; p < 24; p++) {
      const projectId = id('proj')
      project.run(projectId, `Project ${p + 1}`, `project-${p + 1}`, person, at)
      thread.run(id('thr'), projectId, 'coordinator', coordinator, null, at)
      for (let t = 0; t < 50; t++) {
        const taskId = id('task')
        task.run(taskId, projectId, `Task ${t + 1}`, `task-${t + 1}`, t < 2 ? 'open' : 'done', person, at, t < 2 ? null : at)
        thread.run(id('thr'), projectId, 'task', null, taskId, at)
      }
    }
    db.exec('COMMIT')
  } finally {
    db.close()
  }
  return profile
}
