import type { DiffLine } from '@althar/contracts'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text as NativeText, View } from 'react-native'

import { useFileDiff } from '../../../client/react'
import { Button, Text } from '../../../components/ui'
import { pieces } from '../../../model/diff'
import { lines as lineWords } from '../../../model/words'
import { useTheme } from '../../../theme/Theme'
import { space, type } from '../../../theme/tokens'

/*
 * One file's diff, unified, as a phone can read it: lines wrap by default,
 * so nothing hides past the edge, with the stretch that changed marked
 * stronger; Scroll keeps each line whole, to scroll sideways.
 */

function Line({ line, wrap }: { readonly line: DiffLine; readonly wrap: boolean }) {
  const theme = useTheme()
  if (line.kind === 'hunk') {
    return (
      <View style={{ backgroundColor: theme.liveDim, paddingHorizontal: space.md, paddingVertical: 4 }}>
        <NativeText style={[type.monoSmall, { color: theme.live }]}>{line.text}</NativeText>
      </View>
    )
  }
  const bg = line.kind === 'added' ? theme.diffAdd : line.kind === 'removed' ? theme.diffDel : 'transparent'
  const strong = line.kind === 'added' ? theme.diffAddStrong : theme.diffDelStrong
  const number = line.kind === 'added' ? line.new : line.kind === 'removed' ? line.old : line.new
  const mark = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '
  return (
    <View style={{ flexDirection: 'row', backgroundColor: bg }}>
      <NativeText style={[type.monoSmall, { color: theme.t4, width: 40, textAlign: 'right', paddingRight: 6 }]}>{number}</NativeText>
      <NativeText
        style={[type.monoSmall, { color: line.kind === 'added' ? theme.ok : line.kind === 'removed' ? theme.danger : theme.t4, width: 14 }]}
      >
        {mark}
      </NativeText>
      <NativeText style={[type.mono, { color: theme.t1, flexShrink: wrap ? 1 : 0, paddingRight: space.md }]}>
        {pieces(line.text, line.kind === 'context' ? undefined : line.changed).map((piece, index) => (
          <NativeText key={index} style={piece.changed ? { backgroundColor: strong, borderRadius: 2 } : undefined}>
            {piece.text}
          </NativeText>
        ))}
      </NativeText>
    </View>
  )
}

export default function Diff() {
  const { taskId, path } = useLocalSearchParams<{ taskId: string; path: string }>()
  const theme = useTheme()
  const [wrap, setWrap] = useState(true)
  const diff = useFileDiff(taskId, path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const body = (
    <View style={{ paddingVertical: space.sm }}>
      {(diff.data?.lines ?? []).map((line, index) => (
        <Line key={index} line={line} wrap={wrap} />
      ))}
    </View>
  )
  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => <Button label={wrap ? 'Scroll' : 'Wrap'} tone="quiet" small onPress={() => setWrap(!wrap)} />,
        }}
      />
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.line2,
          backgroundColor: theme.page,
        }}
      >
        <Text kind="monoSmall" ink="t2" lines={1}>
          {path}
        </Text>
        {diff.data === undefined ? null : (
          <Text kind="caption" ink="t3">
            {lineWords(diff.data.file.add, diff.data.file.del)}
            {diff.data.truncated ? ' · cut short: open it on your Mac for the rest' : ''}
          </Text>
        )}
      </View>
      <ScrollView>{wrap ? body : <ScrollView horizontal>{body}</ScrollView>}</ScrollView>
    </View>
  )
}
