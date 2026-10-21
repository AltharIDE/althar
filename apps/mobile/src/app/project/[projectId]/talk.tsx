import { Stack, useLocalSearchParams } from 'expo-router'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'

import { useCoordinator, useNow } from '../../../client/react'
import { Composer } from '../../../components/Composer'
import { Thread } from '../../../components/Thread'
import { Text } from '../../../components/ui'
import { useTheme } from '../../../theme/Theme'
import { space } from '../../../theme/tokens'

/*
 * A project's coordinator, as the desktop's Talk room: say what should be
 * done, in words or by voice, and it plans it as a task, posted here as its
 * card, counting down to its start unless held. The coordinator writes no
 * code itself.
 */
export default function Talk() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const theme = useTheme()
  const now = useNow()
  const coordinator = useCoordinator(projectId)
  const data = coordinator.data
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.page }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen options={{ title: data === undefined ? 'Coordinator' : `${data.project.name} · Coordinator` }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
        {data === undefined ? (
          <Text kind="sub" ink="t3">
            {coordinator.isError ? coordinator.error.message : 'Reading the conversation…'}
          </Text>
        ) : data.items.length === 0 ? (
          <View style={{ gap: space.sm, paddingTop: space.xl }}>
            <Text kind="headline">Ask for what should be done</Text>
            <Text kind="sub" ink="t2">
              The coordinator reads {data.project.name}, plans the work as tasks, and picks who leads and who reviews. Each starts on its
              own unless you hold it.
            </Text>
          </View>
        ) : (
          <Thread threadId={data.threadId} items={data.items} now={now} streamed={null} />
        )}
      </ScrollView>
      {data === undefined ? null : <Composer threadId={data.threadId} leadWorking={false} placeholder="Ask the coordinator…" />}
    </KeyboardAvoidingView>
  )
}
