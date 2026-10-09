import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Menu, MenuItem, SplitButton } from '@althar/ui'

import { useServices } from '../data/services'

/*
 * Opens a task's folder in one of the editors on this Mac, at a file and
 * line: the one the person used last, or another from its menu. Finder shows
 * the file. Which was used last is this window's to remember.
 */

export const text = {
  in: (name: string) => (name === 'Finder' ? 'Show in Finder' : `Open in ${name}`),
  more: 'Open in another editor',
}

const LAST = 'althar.editor'

const remembered = (): string | null => {
  try {
    return window.localStorage.getItem(LAST)
  } catch {
    return null
  }
}

export function OpenIn({ taskId, path, line }: { taskId: string; path?: string; line?: number }) {
  const { client } = useServices()
  const editors = useQuery({ queryKey: ['editors'], queryFn: () => client.listEditors(), staleTime: Number.POSITIVE_INFINITY }).data ?? []
  const [last, setLast] = useState(remembered)
  const main = editors.find((editor) => editor.id === last) ?? editors[0]
  if (main === undefined) return null
  const open = (editor: string) => {
    setLast(editor)
    try {
      window.localStorage.setItem(LAST, editor)
    } catch {
      // Remembered for now only.
    }
    void client.openInEditor({ taskId, editor, ...(path === undefined ? {} : { path }), ...(line === undefined ? {} : { line }) })
  }
  const others = editors.filter((editor) => editor.id !== main.id)
  if (others.length === 0)
    return (
      <Button size="small" onClick={() => open(main.id)}>
        {text.in(main.name)}
      </Button>
    )
  return (
    <SplitButton
      size="small"
      onClick={() => open(main.id)}
      moreLabel={text.more}
      menu={(trigger) => (
        <Menu trigger={trigger} label={text.more} align="end">
          {others.map((editor) => (
            <MenuItem key={editor.id} onSelect={() => open(editor.id)}>
              {text.in(editor.name)}
            </MenuItem>
          ))}
        </Menu>
      )}
    >
      {text.in(main.name)}
    </SplitButton>
  )
}
