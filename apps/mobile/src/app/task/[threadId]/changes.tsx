import type { ChangedFile } from '@althar/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { NavArrowRight } from 'iconoir-react-native'
import { Pressable, ScrollView, View } from 'react-native'

import { useThread } from '../../../client/react'
import { Card, Divider, Text } from '../../../components/ui'
import { lines, plural } from '../../../model/words'
import { useTheme } from '../../../theme/Theme'
import { space } from '../../../theme/tokens'

/*
 * What a task changed, file by file, from its base to its folder as it
 * stands: each opens its diff. What isn't committed yet says so, as it
 * isn't in what Althar pushes.
 */

const letters = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' } as const

function FileRow({ file, onPress }: { readonly file: ChangedFile; readonly onPress: () => void }) {
  const theme = useTheme()
  const slash = file.path.lastIndexOf('/')
  const folder = slash === -1 ? '' : file.path.slice(0, slash + 1)
  const name = file.path.slice(slash + 1)
  const tone = file.status === 'added' ? theme.ok : file.status === 'deleted' ? theme.danger : theme.t3
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${file.path}, ${file.status}, ${lines(file.add, file.del)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        backgroundColor: pressed ? theme.pressed : 'transparent',
      })}
    >
      <Text kind="monoSmall" style={{ color: tone, width: 12 }}>
        {letters[file.status]}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text kind="bodyMedium" lines={1}>
          {name}
        </Text>
        <Text kind="monoSmall" ink="t3" lines={1}>
          {folder === '' ? '/' : folder}
          {file.uncommitted ? '  · not committed' : ''}
        </Text>
      </View>
      <Text kind="monoSmall" ink="ok">
        +{file.add}
      </Text>
      <Text kind="monoSmall" ink="danger">
        −{file.del}
      </Text>
      <NavArrowRight width={16} height={16} color={theme.t4} />
    </Pressable>
  )
}

export default function Changes() {
  const { threadId, taskId } = useLocalSearchParams<{ threadId: string; taskId: string }>()
  const router = useRouter()
  const thread = useThread(threadId)
  const files = thread.data?.task.files ?? []
  const add = files.reduce((sum, one) => sum + one.add, 0)
  const del = files.reduce((sum, one) => sum + one.del, 0)
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Text kind="sub" ink="t3">
        {plural(files.length, 'file')} · {lines(add, del)}
        {thread.data === undefined ? '' : ` · ${plural(thread.data.task.commits, 'commit')} on ${thread.data.task.branch ?? 'its branch'}`}
      </Text>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        {files.map((file, index) => (
          <View key={file.path}>
            {index === 0 ? null : <Divider inset={40} />}
            <FileRow
              file={file}
              onPress={() => router.push({ pathname: '/task/[threadId]/diff', params: { threadId, taskId, path: file.path } })}
            />
          </View>
        ))}
      </Card>
    </ScrollView>
  )
}
