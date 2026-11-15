import { Schema } from 'effect'

export class HostError extends Schema.TaggedError<HostError>()('HostError', {
  code: Schema.Literals([
    'NotInitialized',
    'UnsafePermissions',
    'UnsafeKeyLocation',
    'WrongKey',
    'CorruptVault',
    'StorageUnavailable',
    'InvalidConfig',
    'UnsupportedPlatform',
    'HostUnavailable',
    'ServiceUnavailable',
    'UpdateUnavailable',
    'ReleaseRejected',
    'UpdateBusy',
    'UpdateIncompatible',
    'UpdateRecoveryRequired',
    'UpdateFailed',
    'UpdateNotConfigured',
  ]),
  message: Schema.String,
}) {}

export const storageFailure = (error: unknown): HostError =>
  error instanceof HostError
    ? error
    : new HostError({
        code: 'StorageUnavailable',
        message: 'Althar could not access its private host files. Check ownership, permissions and free disk space.',
      })

export const fileErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
