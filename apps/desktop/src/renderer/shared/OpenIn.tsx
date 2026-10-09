import { useQuery } from '@tanstack/react-query'

import { Button, Menu, MenuItem, SplitButton } from '@althar/ui'

import { useServices } from '../data/services'
import { usePreferences } from './usePreferences'

/*
 * Opens a task's folder in one of the editors on this Mac, at a file and
 * line: the one Settings says files open in (the first found until one is
 * chosen), or another from its menu, which becomes the one they open in.
 * Finder shows the file.
 */

export const text = {
  in: (name: string) => (name === 'Finder' ? 'Show in Finder' : `Open in ${name}`),
  more: 'Open in another editor',
}

export interface Editors {
  /** Every editor found here, in the order they are offered; Finder last. */
  readonly editors: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** The one files open in, or none until the editors are read, or where there are none. */
  readonly main: { readonly id: string; readonly name: string } | undefined
  /** Opens the task's folder in an editor, at a file and line where given, and keeps it as the one files open in. */
  readonly open: (editor: string, at?: { readonly path?: string; readonly line?: number }) => void
}

/** The editors found on this Mac, read once for the window; none until they are. */
export const useEditorList = (): Editors['editors'] => {
  const { client } = useServices()
  return useQuery({ queryKey: ['editors'], queryFn: () => client.listEditors(), staleTime: Number.POSITIVE_INFINITY }).data ?? []
}

/** Each editor's icon by its id, read from the main process once for the window; an editor without one has none. */
export const useEditorPictures = (): Readonly<Record<string, string>> => {
  const { host } = useServices()
  const editors = useEditorList()
  const ids = editors.map((editor) => editor.id)
  return (
    useQuery({
      queryKey: ['editor-pictures', ...ids],
      queryFn: async () => {
        const pictures = await Promise.all(ids.map(async (id) => [id, await host.editorPicture(id).catch(() => null)] as const))
        return Object.fromEntries(pictures.filter((entry): entry is readonly [string, string] => entry[1] !== null))
      },
      enabled: ids.length > 0,
      staleTime: Number.POSITIVE_INFINITY,
    }).data ?? {}
  )
}

/** The editors on this Mac, the one files open in, and opening a task's folder in one. */
export const useEditors = (taskId: string): Editors => {
  const { client } = useServices()
  const { preferences, set } = usePreferences()
  const editors = useEditorList()
  const main = editors.find((editor) => editor.id === preferences.editor) ?? editors[0]
  const open = (editor: string, at: { readonly path?: string; readonly line?: number } = {}) => {
    if (editor !== preferences.editor) set('editor', editor)
    void client.openInEditor({
      taskId,
      editor,
      ...(at.path === undefined ? {} : { path: at.path }),
      ...(at.line === undefined ? {} : { line: at.line }),
    })
  }
  return { editors, main, open }
}

export function OpenIn({ taskId, path, line }: { taskId: string; path?: string; line?: number }) {
  const { editors, main, open: openIn } = useEditors(taskId)
  if (main === undefined) return null
  const open = (editor: string) => openIn(editor, { ...(path === undefined ? {} : { path }), ...(line === undefined ? {} : { line }) })
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
