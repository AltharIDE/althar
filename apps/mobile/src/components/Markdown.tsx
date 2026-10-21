import { Linking, ScrollView, Text as NativeText, View } from 'react-native'

import { markdownBlocks, type Span } from '../model/markdown'
import { useTheme } from '../theme/Theme'
import { fonts, radius, space, type } from '../theme/tokens'

/*
 * An agent's markdown, drawn for a phone: its blocks from model/markdown.ts,
 * in the app's type; code in mono, a block of it scrolling sideways rather
 * than wrapping, as code reads.
 */

function Spans({ spans }: { readonly spans: ReadonlyArray<Span> }) {
  const theme = useTheme()
  return spans.map((span, index) => (
    <NativeText
      key={index}
      accessibilityRole={span.href === undefined ? undefined : 'link'}
      onPress={span.href === undefined ? undefined : () => void Linking.openURL(span.href ?? '')}
      style={[
        span.strong === true ? { fontFamily: fonts.semibold } : null,
        span.em === true ? { fontStyle: 'italic' } : null,
        span.struck === true ? { textDecorationLine: 'line-through' } : null,
        span.code === true ? { fontFamily: fonts.mono, fontSize: 13.5, backgroundColor: theme.pressed, borderRadius: 4 } : null,
        span.href === undefined ? null : { color: theme.live, textDecorationLine: 'underline' },
      ]}
    >
      {span.text}
    </NativeText>
  ))
}

export function Markdown({ source, selectable = true }: { readonly source: string; readonly selectable?: boolean }) {
  const theme = useTheme()
  const body = [type.body, { color: theme.t1 }]
  return (
    <View style={{ gap: space.sm }}>
      {markdownBlocks(source).map((block, index) => {
        switch (block.kind) {
          case 'paragraph':
            return (
              <NativeText key={index} selectable={selectable} style={body}>
                <Spans spans={block.spans} />
              </NativeText>
            )
          case 'heading':
            return (
              <NativeText
                key={index}
                accessibilityRole="header"
                style={[block.level <= 2 ? type.headline : type.bodyMedium, { color: theme.t1 }]}
              >
                <Spans spans={block.spans} />
              </NativeText>
            )
          case 'list':
            return (
              <View key={index} style={{ gap: 4 }}>
                {block.items.map((item, at) => (
                  <View key={at} style={{ flexDirection: 'row', gap: space.sm }}>
                    <NativeText style={[body, { color: theme.t3, minWidth: block.ordered ? 18 : 10 }]}>
                      {block.ordered ? `${block.start + at}.` : '•'}
                    </NativeText>
                    <NativeText selectable={selectable} style={[body, { flex: 1 }]}>
                      <Spans spans={item} />
                    </NativeText>
                  </View>
                ))}
              </View>
            )
          case 'quote':
            return (
              <View key={index} style={{ borderLeftWidth: 3, borderLeftColor: theme.line3, paddingLeft: space.md }}>
                <NativeText selectable={selectable} style={[body, { color: theme.t2 }]}>
                  <Spans spans={block.spans} />
                </NativeText>
              </View>
            )
          case 'code':
            return (
              <ScrollView
                key={index}
                horizontal
                style={{ backgroundColor: theme.well, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.line }}
                contentContainerStyle={{ padding: space.md }}
              >
                <NativeText selectable={selectable} style={[type.mono, { color: theme.t1 }]}>
                  {block.text}
                </NativeText>
              </ScrollView>
            )
          case 'rule':
            return <View key={index} style={{ height: 1, backgroundColor: theme.line2 }} />
        }
      })}
    </View>
  )
}
