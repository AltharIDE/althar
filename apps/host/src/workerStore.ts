import { openWorkerStore as open } from '@althar/runtime/workerHome'

export const openWorkerStore = (profile: string, homeId: string, now = Date.now) => open(profile, homeId, now)
