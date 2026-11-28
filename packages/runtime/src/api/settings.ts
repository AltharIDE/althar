import { type ApiHandlers, ApiError } from '@althar/contracts'
import type { Ledger } from '@althar/persistence-sqlite'
import { type Crypto, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Automations } from '../Automations'
import { Changes } from '../Changes'
import { coAuthorLine, coAuthorOn, setCoAuthor } from '../credit'
import { plansAndReviewsOf, newProjectDefaultsOf, setPlansAndReviews, setNewProjectDefaults } from '../plansAndReviews'
import { reviewSeal, setReviewSeal, setReviewSealStyle } from '../pullRequestReview'
import { FolderCleanup } from '../FolderCleanup'
import type { Instance } from '../Instance'
import { Busy } from '../Busy'
import { SettingsTools } from '../SettingsTools'
import { postTeamReviews, runOutside, sendMidTurn, setPostTeamReviews, setRunOutside, setSendMidTurn } from '../Reviews'
import { setShipRoute, shipRouteSetting } from '../shipRoute'
import {
  declinePresetOffer,
  BUILT_IN,
  describe as describePreset,
  editPreset,
  partsOfTask,
  presetsIn,
  removePreset,
  resetPreset,
  savePreset,
  tunePreset,
} from '../presets'
import { Plans } from '../Plans'
import { presetModels } from '../presetModels'
import { usableModels } from '../usableModels'
import type { ApiKit } from './kit'

/**
 * The person's settings for every project: the settings read, each switch, presets and applying one.
 * The setting changes an agent asks for or made, answered and undone.
 */
export const settingsHandlers = ({ actorId, api }: ApiKit) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const sql = yield* SqlClient.SqlClient
    // What bringing a task's removed folder back needs (ADR-056).
    const folderStore = yield* Effect.context<SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto>()
    const cleanup = yield* FolderCleanup
    const pullRequests = yield* Changes
    const busy = yield* Busy
    const automations = yield* Automations
    const settingsTools = yield* SettingsTools
    return {
      GetSettings: () =>
        api(
          Effect.gen(function* () {
            const on = yield* coAuthorOn
            const atOnce = yield* busy.atOnce
            const shipRoute = yield* shipRouteSetting
            return {
              plansAndReviews: yield* plansAndReviewsOf,
              newProjects: yield* newProjectDefaultsOf,
              coAuthor: { on, line: coAuthorLine },
              reviewSeal: yield* reviewSeal,
              postTeamReviews: yield* postTeamReviews,
              runOutside: yield* runOutside,
              sendMidTurn: yield* sendMidTurn,
              ...(shipRoute === undefined ? {} : { shipRoute }),
              automationsPaused: yield* automations.allPaused,
              folderWait: yield* cleanup.wait,
              agentsAtOnce: {
                count: atOnce.count,
                own: atOnce.own,
                machine: { count: atOnce.machine.count, cores: atOnce.machine.cores, memory: atOnce.machine.memory },
              },
            }
          }),
        ).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetCoAuthor: ({ on }) => api(setCoAuthor(on)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetReviewSeal: ({ on }) => api(setReviewSeal(on)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetReviewSealStyle: ({ style }) => api(setReviewSealStyle(style)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetAgentsAtOnce: ({ count }) => api(busy.set(count)),
      SetPlansAndReviews: ({ commandId: _commandId, ...change }) =>
        api(setPlansAndReviews(change)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetNewProjectDefaults: ({ commandId: _commandId, ...change }) =>
        api(setNewProjectDefaults(change)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetPostTeamReviews: ({ on }) => api(setPostTeamReviews(on)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetSendMidTurn: ({ to }) => api(setSendMidTurn(to)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetShipRoute: ({ route }) => api(setShipRoute(route)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      SetRunOutside: ({ to }) => api(setRunOutside(to)).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
      AnswerSettingChange: ({ itemId, yes }) => api(settingsTools.answer(itemId, yes)),
      UndoSettingChange: ({ itemId }) => api(settingsTools.undo(itemId)),
      GetSettingChanges: ({ projectId }) => api(settingsTools.changed(projectId)),
      ApplyPreset: ({ planId, preset }) =>
        api(
          Effect.gen(function* () {
            const [plan] = yield* sql<{
              projectId: string
              taskId: string
            }>`SELECT project_id, task_id FROM task_plans WHERE id = ${planId}`
            const end = plan === undefined ? undefined : yield* pullRequests.endFor(plan.projectId, plan.taskId)
            return yield* plans.applyPreset(planId, preset, actorId, end)
          }),
        ),
      ListPresets: ({ projectId }) =>
        api(
          Effect.gen(function* () {
            const all = yield* presetsIn(projectId ?? null)
            // Each lead as people know its model, where the agents offer it.
            const models = presetModels(yield* usableModels(projectId ?? undefined).pipe(Effect.orElseSucceed(() => [])))
            // The projects they're kept to, or can be, by name, for Settings to say.
            const named = new Map(
              (yield* sql<{ id: string; name: string }>`SELECT id, name FROM projects`).map((one) => [one.id, one.name] as const),
            )
            return all.map(({ fromProjectId, ...one }) => {
              const keptTo = one.projectId === null ? undefined : named.get(one.projectId)
              const from = fromProjectId == null ? undefined : named.get(fromProjectId)
              const built = one.tuned === true ? BUILT_IN.find((preset) => preset.id === one.id) : undefined
              return {
                ...one,
                about: describePreset(one.parts, models),
                ...(built === undefined ? {} : { asBuilt: { parts: built.parts, about: describePreset(built.parts, models) } }),
                ...(keptTo === undefined ? {} : { keptTo }),
                ...(from === undefined ? {} : { from }),
              }
            })
          }).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
        ),
      EditPreset: ({ id, name, parts, projectOnly }) =>
        api(
          editPreset({ id, name, parts, ...(projectOnly === undefined ? {} : { projectOnly }) }).pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
          ),
        ),
      SavePreset: ({ name, taskId, parts, projectOnly, asNew }) =>
        api(
          Effect.provideContext(
            Effect.gen(function* () {
              const from = taskId === undefined ? null : yield* partsOfTask(taskId)
              const kept = parts ?? from?.parts
              if (kept === undefined) return yield* new ApiError({ reason: 'Invalid', message: 'Say which task, or what parts, to keep.' })
              return yield* savePreset({
                name,
                parts: kept,
                projectId: projectOnly === true ? (from?.projectId ?? null) : null,
                fromTaskId: taskId ?? null,
                actorId: actorId,
                asNew,
              })
            }),
            folderStore,
          ),
        ),
      TunePreset: ({ id, tuning }) => api(tunePreset(id, tuning).pipe(Effect.asVoid, Effect.provideService(SqlClient.SqlClient, sql))),
      ResetPreset: ({ id }) => api(resetPreset(id).pipe(Effect.asVoid, Effect.provideService(SqlClient.SqlClient, sql))),
      RemovePreset: ({ id }) => api(Effect.provideContext(removePreset(id), folderStore)),
      DeclinePresetOffer: ({ taskId }) => api(Effect.provideContext(declinePresetOffer(taskId, actorId), folderStore)),
    } satisfies Partial<ApiHandlers>
  })
