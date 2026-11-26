import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { TaskFolderChoice, TaskFolderState } from '../src/main/appPreferences'
import { ServicesProvider, type Host } from '../src/renderer/data/services'
import { text, useTaskFolderLocation } from '../src/renderer/features/settings/useTaskFolderLocation'
import { fakeClient, fakeHost } from './fixtures'
import { servicesFor } from './render'

/*
 * Where new tasks' folders go, as Settings holds it: read now and again on focus, Change and Use the default
 * keep what the main process answers, show a refusal in a line, and say so where the call itself fails.
 */

const NOW: TaskFolderState = { folder: '/home/ada/Althar', from: 'default' }
const MOVED: TaskFolderState = { folder: '/mnt/work/Althar', from: 'setting', defaultFolder: '/home/ada/Althar' }

const hook = (over: Partial<Host>) => {
  const services = servicesFor(fakeClient().client, { ...fakeHost(), ...over })
  return renderHook(() => useTaskFolderLocation(), {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

describe('useTaskFolderLocation', () => {
  it('is null where the main process keeps no such setting', () => {
    const { result } = hook({})
    expect(result.current).toBeNull()
  })

  it('reads the folder, and again when the window gains focus', async () => {
    const taskFolder = vi.fn<() => Promise<TaskFolderState>>().mockResolvedValueOnce(NOW).mockResolvedValue(MOVED)
    const { result, unmount } = hook({ taskFolder })
    await waitFor(() => expect(result.current?.folder).toBe(NOW.folder))
    act(() => void window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current?.folder).toBe(MOVED.folder))
    unmount()
    window.dispatchEvent(new Event('focus'))
    expect(taskFolder).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed read quiet', async () => {
    const taskFolder = vi.fn().mockRejectedValue(new Error('gone'))
    const { result } = hook({ taskFolder })
    await waitFor(() => expect(taskFolder).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('keeps the chosen folder, ignores a cancel, and shows a refusal', async () => {
    const answers: TaskFolderChoice[] = [MOVED, null, { refused: 'That folder is inside a repository.' }]
    const chooseTaskFolder = vi.fn(() => Promise.resolve(answers.shift() ?? null))
    const { result } = hook({ taskFolder: () => Promise.resolve(NOW), chooseTaskFolder })
    await waitFor(() => expect(result.current).not.toBeNull())
    act(() => result.current?.change())
    await waitFor(() => expect(result.current?.folder).toBe(MOVED.folder))
    expect(result.current?.busy).toBe(false)
    act(() => result.current?.change())
    await waitFor(() => expect(chooseTaskFolder).toHaveBeenCalledTimes(2))
    expect(result.current?.refusal).toBeNull()
    act(() => result.current?.change())
    await waitFor(() => expect(result.current?.refusal).toBe('That folder is inside a repository.'))
    expect(result.current?.folder).toBe(MOVED.folder)
  })

  it('goes back to the default, and says where either call fails', async () => {
    const useDefaultTaskFolder = vi.fn().mockResolvedValueOnce(NOW).mockRejectedValue(new Error('no'))
    const chooseTaskFolder = vi.fn().mockRejectedValue(new Error('no'))
    const { result } = hook({ taskFolder: () => Promise.resolve(MOVED), useDefaultTaskFolder, chooseTaskFolder })
    await waitFor(() => expect(result.current).not.toBeNull())
    act(() => result.current?.useDefault())
    await waitFor(() => expect(result.current?.folder).toBe(NOW.folder))
    act(() => result.current?.useDefault())
    await waitFor(() => expect(result.current?.refusal).toBe(text.defaultFailed))
    act(() => result.current?.change())
    await waitFor(() => expect(result.current?.refusal).toBe(text.failed))
  })

  it('does nothing where the host has no dialog to ask', async () => {
    const { result } = hook({ taskFolder: () => Promise.resolve(NOW) })
    await waitFor(() => expect(result.current).not.toBeNull())
    act(() => result.current?.change())
    act(() => result.current?.useDefault())
    expect(result.current?.busy).toBe(false)
  })
})
