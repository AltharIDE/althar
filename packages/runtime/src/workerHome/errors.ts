export class WorkerHomeError extends Error {
  constructor(
    readonly code: 'UnsafePermissions' | 'InvalidConfig' | 'HostUnavailable',
    message: string,
  ) {
    super(message)
  }
}
