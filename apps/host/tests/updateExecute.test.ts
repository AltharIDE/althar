import { describe, expect, it, vi } from 'vitest'

import { executeUpdate, runRelease, systemServices, type UpdateExecutor } from '../src/updates/execute'

describe('isolated updater process operations', () => {
  it('clears Node loader injection and redacts failed or aborted subprocess output', async () => {
    vi.stubEnv('NODE_OPTIONS', '--not-a-real-node-option')
    vi.stubEnv('NODE_PATH', '/untrusted/modules')
    try {
      const result = await executeUpdate(process.execPath, [
        '-e',
        'process.stdout.write(JSON.stringify([process.env.NODE_OPTIONS, process.env.NODE_PATH]))',
      ])
      expect(JSON.parse(result)).toEqual(['', ''])
      const failed = executeUpdate(process.execPath, ['-e', 'process.stderr.write("private material");process.exit(1)'])
      await expect(failed).rejects.toMatchObject({ code: 'UpdateFailed' })
      await expect(failed).rejects.not.toThrow('private material')
      await expect(executeUpdate(process.execPath, ['-e', ''], AbortSignal.abort())).rejects.toMatchObject({ code: 'UpdateFailed' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('selects Node and entry from the same immutable release without shell interpolation', async () => {
    const execute = vi.fn<UpdateExecutor>().mockResolvedValue('result')
    expect(await runRelease({ folder: '/private/release with spaces' }, ['status', '--json'], execute)).toBe('result')
    expect(execute).toHaveBeenCalledWith(
      '/private/release with spaces/node/bin/node',
      ['/private/release with spaces/dist/althar-host.js', 'status', '--json'],
      undefined,
    )
  })
  it('checks service state and resets failures before starting, with a separate nonblocking updater job', async () => {
    const execute = vi.fn<UpdateExecutor>().mockResolvedValue('active\n')
    const services = systemServices(execute)
    expect(await services.active('home')).toBe(true)
    execute.mockResolvedValueOnce('inactive\n')
    expect(await services.active('home')).toBe(false)
    execute.mockRejectedValueOnce(new Error('no user manager'))
    expect(await services.active('home')).toBe(false)
    await services.stop('home')
    await services.start('home')
    await services.kick('home')
    expect(execute.mock.calls.slice(-4).map(([, args]) => args)).toEqual([
      ['--user', 'stop', 'home.service'],
      ['--user', 'reset-failed', 'home.service'],
      ['--user', 'start', 'home.service'],
      ['--user', 'start', '--no-block', 'home-update.service'],
    ])
  })
})
