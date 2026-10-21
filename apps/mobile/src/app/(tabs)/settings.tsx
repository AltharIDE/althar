import { useRouter } from 'expo-router'
import { Bell, FaceId, Laptop, NavArrowRight, ShieldCheck } from 'iconoir-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useClient, useConnection } from '../../client/react'
import { Button, Card, Divider, Text } from '../../components/ui'
import { useTheme } from '../../theme/Theme'
import { space } from '../../theme/tokens'

/*
 * The phone's own settings: the Mac it's paired with, how it answers for
 * you, and what taps you. Everything about the work itself is the Mac's.
 */

function Row({
  icon,
  title,
  detail,
  onPress,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly detail?: string
  readonly onPress?: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole={onPress === undefined ? 'text' : 'button'}
      disabled={onPress === undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        backgroundColor: pressed ? theme.pressed : 'transparent',
      })}
    >
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text kind="bodyMedium">{title}</Text>
        {detail === undefined ? null : (
          <Text kind="sub" ink="t3">
            {detail}
          </Text>
        )}
      </View>
      {onPress === undefined ? null : <NavArrowRight width={16} height={16} color={theme.t4} />}
    </Pressable>
  )
}

export default function Settings() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const client = useClient()
  const connection = useConnection()
  const mac = connection.state === 'unpaired' ? null : connection.mac
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, padding: space.lg, gap: space.md }}>
      <Text kind="largeTitle" style={{ paddingHorizontal: 4 }}>
        Settings
      </Text>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        {mac === null ? (
          <Row
            icon={<Laptop width={22} height={22} color={theme.t2} />}
            title="Not paired"
            detail="Pair with Althar on your Mac"
            onPress={() => router.push('/pair')}
          />
        ) : (
          <>
            <Row
              icon={<Laptop width={22} height={22} color={theme.t2} />}
              title={mac.name}
              detail={`${connection.state === 'online' ? 'Connected' : connection.state === 'away' ? 'Away' : 'Reaching it…'} · paired ${new Date(mac.pairedAt).toLocaleDateString()}`}
            />
            <Divider inset={50} />
            <Row
              icon={<ShieldCheck width={22} height={22} color={theme.ok} />}
              title="Encrypted end to end"
              detail={`Paired with the words ${mac.words.join(' · ')}`}
            />
            <View style={{ padding: space.lg, paddingTop: 0 }}>
              <Button label="Unpair this phone" tone="danger" small onPress={() => void client.unpair()} />
            </View>
          </>
        )}
      </Card>

      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
        <Row
          icon={<FaceId width={22} height={22} color={theme.t2} />}
          title="Face ID before allowing"
          detail="Allowing a permission, always-allowing, and merging ask for Face ID. Denying never does: saying no is always safe."
        />
        <Divider inset={50} />
        <Row
          icon={<Bell width={22} height={22} color={theme.t2} />}
          title="Notifications"
          detail="What taps you, and what waits for you to look"
          onPress={() => router.push('/notifications')}
        />
      </Card>

      <Text kind="caption" ink="t4" style={{ paddingHorizontal: 4 }}>
        Althar for iPhone · demo data · API version 1
      </Text>
    </ScrollView>
  )
}
