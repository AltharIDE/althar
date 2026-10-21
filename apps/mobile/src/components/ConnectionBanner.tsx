import { useRouter } from 'expo-router'
import { Laptop, WifiOff } from 'iconoir-react-native'
import { View } from 'react-native'

import { useConnection } from '../client/react'
import { connectionWords } from '../model/words'
import { useTheme } from '../theme/Theme'
import { radius, space } from '../theme/tokens'
import { Button, Text } from './ui'

/**
 * How the phone stands with the Mac, wherever it isn't simply online: the
 * Mac is canonical, so the phone says when what it shows is old, and what
 * waits there meanwhile.
 */
export function ConnectionBanner({ now, waiting }: { readonly now: number; readonly waiting: number }) {
  const theme = useTheme()
  const router = useRouter()
  const connection = useConnection()
  const words = connectionWords(connection, now)
  if (words === null) return null
  const away = connection.state === 'away'
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: away ? theme.dangerDim : theme.raised,
        borderWidth: 1,
        borderColor: away ? theme.line3 : theme.line2,
        alignItems: 'flex-start',
      }}
    >
      {away ? <WifiOff width={20} height={20} color={theme.warm} /> : <Laptop width={20} height={20} color={theme.t2} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text kind="bodyMedium">{words.title}</Text>
        <Text kind="sub" ink="t2">
          {words.detail}
          {away && waiting > 0 ? ` ${waiting} ${waiting === 1 ? 'call waits' : 'calls wait'} there; answer once it’s back.` : ''}
        </Text>
        {connection.state === 'unpaired' ? (
          <View style={{ marginTop: space.sm, alignSelf: 'flex-start' }}>
            <Button label="Pair with your Mac" tone="ink" small onPress={() => router.push('/pair')} />
          </View>
        ) : null}
      </View>
    </View>
  )
}
