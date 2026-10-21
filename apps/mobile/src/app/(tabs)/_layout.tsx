import { Tabs } from 'expo-router'
import { Folder, HomeSimple, Settings } from 'iconoir-react-native'

import { useHome } from '../../client/react'
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
  const count = home.data === undefined ? 0 : needsCount(home.data)
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.t1,
        tabBarInactiveTintColor: theme.t3,
        tabBarStyle: { backgroundColor: theme.raised, borderTopColor: theme.line2 },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
        tabBarItemStyle: { paddingTop: 4 },
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
        options={{ title: 'Projects', tabBarIcon: ({ color, size }) => <Folder color={color} width={size} height={size} strokeWidth={1.8} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Settings color={color} width={size} height={size} strokeWidth={1.8} /> }}
      />
    </Tabs>
  )
}
