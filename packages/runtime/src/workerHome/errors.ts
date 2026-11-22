export class WorkerHomeError extends Error {
  constructor(
    readonly code: 'UnsafePermissions' | 'InvalidConfig' | 'HostUnavailable' | 'StorageUnavailable',
    message: string,
  ) {
    super(message)
  }
}
