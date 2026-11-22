import { create, toBinary } from '@bufbuild/protobuf'
import { AgentSkillFilesSchema } from './gen/althar/worker/v1/control_pb.ts'

export const MAX_WORKER_SKILL_BYTES = 8 * 1024 * 1024
export const MAX_WORKER_SKILL_FILES = 512

export interface WorkerSkillFile {
  readonly path: string
  readonly data: Uint8Array
  readonly executable: boolean
}

export const workerSkillBundle = (skills: ReadonlyArray<WorkerSkillFile>): Uint8Array => {
  const size = skills.reduce((sum, file) => sum + Buffer.byteLength(file.path) + file.data.byteLength, 0)
  const tooLarge = () => new Error('The selected skills are too large for the worker.')
  if (skills.length === 0 || skills.length > MAX_WORKER_SKILL_FILES || size > MAX_WORKER_SKILL_BYTES) throw tooLarge()
  const bytes = toBinary(AgentSkillFilesSchema, create(AgentSkillFilesSchema, { files: [...skills] }))
  if (bytes.byteLength > MAX_WORKER_SKILL_BYTES) throw tooLarge()
  return bytes
}
