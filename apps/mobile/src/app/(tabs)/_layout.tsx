import { Tabs } from 'expo-router'
import { Platform } from 'react-native'
import { Folder, HomeSimple, Settings } from 'iconoir-react-native'

import { useConnection, useHome } from '../../client/react'
import { needsCount } from '../../model/home'
import { useTheme } from '../../theme/Theme'
import { fonts } from '../../theme/tokens'

/*
 * Three places: the home (what needs you, what's at work), the projects,
 * and the phone's own settings. The home's badge counts what needs you, as
 * the desktop's home tab does.
 */
export default function TabsLayout() {
  const theme = useTheme()
  const home = useHome()
  const paired = useConnection().state !== 'unpaired'
  const count = home.data === undefined || !paired ? 0 : needsCount(home.data)
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.t1,
        tabBarInactiveTintColor: theme.t3,
        /* On the web, the bar's own height clips Inter's labels; a phone sizes it by its insets. */
        tabBarStyle: { backgroundColor: theme.raised, borderTopColor: theme.line2, ...(Platform.OS === 'web' ? { height: 60 } : {}) },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
        tabBarBadgeStyle: { backgroundColor: theme.signal, color: theme.onSignal, fontFamily: fonts.semibold, fontSize: 11 },
        sceneStyle: { backgroundColor: theme.page },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarBadge: count > 0 ? count : undefined,
          tabBarIcon: ({ color, size }) => <HomeSimple color={color} width={size} height={size} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, size }) => <Folder color={color} width={size} height={size} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings color={color} width={size} height={size} strokeWidth={1.8} />,
        }}
      />
    </Tabs>
  )
}
