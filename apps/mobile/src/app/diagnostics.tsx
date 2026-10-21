import { Stack } from 'expo-router'
import { CheckCircle, XmarkCircle } from 'iconoir-react-native'
import { useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { selfTest, type Check } from '../client/relay/selfTest'
import { Button, Card, Divider, Text } from '../components/ui'
import { useTheme } from '../theme/Theme'
import { space } from '../theme/tokens'

/*
 * What a person, or whoever helps them, checks when the phone can't reach
 * Althar: the relay client's whole path, run here against a runtime of the
 * contract's own. On a phone it runs on Hermes, the engine the app ships.
 */

const engine = (): string => {
  const hermes = (globalThis as { HermesInternal?: { getRuntimeProperties?: () => Record<string, string> } }).HermesInternal
  if (hermes === undefined) return Platform.OS === 'web' ? 'the browser’s engine' : 'JavaScriptCore'
  const version = hermes.getRuntimeProperties?.()['OSS Release Version']
  return version === undefined ? 'Hermes' : `Hermes ${version}`
}

export default function Diagnostics() {
  const theme = useTheme()
  const [checks, setChecks] = useState<ReadonlyArray<Check> | null>(null)
  const [running, setRunning] = useState(false)
  const run = () => {
    setRunning(true)
    void selfTest()
      .then(setChecks)
      .finally(() => setRunning(false))
  }
  const failed = checks?.filter((check) => !check.ok).length ?? 0
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Stack.Screen options={{ title: 'Diagnostics' }} />
      <Text kind="body" ink="t2">
        Runs the way the phone talks to Althar, end to end, against a stand-in for your Mac, on {engine()}.
      </Text>
      <Button label={checks === null ? 'Run the checks' : 'Run them again'} tone="ink" busy={running} onPress={run} />
      {checks === null ? null : (
        <>
          <Text kind="headline" ink={failed === 0 ? 'ok' : 'danger'}>
            {failed === 0 ? `All ${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`}
          </Text>
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {checks.map((check, index) => (
              <View key={check.name}>
                {index === 0 ? null : <Divider inset={48} />}
                <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
                  {check.ok ? (
                    <CheckCircle width={20} height={20} color={theme.ok} />
                  ) : (
                    <XmarkCircle width={20} height={20} color={theme.danger} />
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text kind="bodyMedium">{check.name}</Text>
                    <Text kind="monoSmall" ink={check.ok ? 't3' : 'danger'} selectable>
                      {check.detail}
                    </Text>
                  </View>
                  <Text kind="caption" ink="t4">
                    {check.ms}ms
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  )
}
