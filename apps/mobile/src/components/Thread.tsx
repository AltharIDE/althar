import type { ThreadItem } from '@althar/contracts'
import { CheckCircle, NavArrowDown, NavArrowRight, WarningTriangle, XmarkCircle } from 'iconoir-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { blocksOf, type Block } from '../model/thread'
import { since, whoWorks } from '../model/words'
import { useTheme } from '../theme/Theme'
import { radius, space } from '../theme/tokens'
import { Chip, LiveDot, Text, Well } from './ui'

/*
 * A task's thread on a phone: what you asked, what agents said, each round
 * of the lead's work as one line that opens, and what steps reported, with
 * what the lead checked and what it couldn't.
 */

type Report = Extract<ThreadItem, { readonly kind: 'step_result' }>

const stepNames = { implement: 'Implement', review: 'Review', settle: 'Settle the review', publish: 'Pull request' } as const

export function ReportCard({ report }: { readonly report: Report }) {
  const theme = useTheme()
  const { content } = report
  const passed = content.verdict === 'pass'
  return (
    <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: theme.raised, borderWidth: 1, borderColor: theme.line2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text kind="label" ink="t3">
          {stepNames[content.step]}
          {content.step === 'review' ? ` · round ${content.round + 1}` : ''}
        </Text>
        {content.verdict === null ? null : <Chip label={passed ? 'Passed' : 'Changes asked'} tone={passed ? 'ok' : 'warm'} />}
        <Text kind="caption" ink="t4" style={{ marginLeft: 'auto' }}>
          {whoWorks(content.agentId, null)}
        </Text>
      </View>
      <Text kind="body">{content.summary}</Text>
      {content.findings.map((finding, index) => (
        <View key={index} style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip label={finding.severity} tone={finding.severity === 'blocking' || finding.severity === 'major' ? 'danger' : 'plain'} />
          <View style={{ flex: 1 }}>
            <Text kind="sub">{finding.claim}</Text>
            {finding.file === null ? null : (
              <Text kind="monoSmall" ink="t3">
                {finding.file}
                {finding.line === null ? '' : `:${finding.line}`}
              </Text>
            )}
          </View>
        </View>
      ))}
      {content.evidence.length === 0 ? null : (
        <View style={{ gap: 4 }}>
          <Text kind="caption" ink="t3">
            What it checked
          </Text>
          {content.evidence.map((evidence, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
              {evidence.exit === 0 ? (
                <CheckCircle width={15} height={15} color={theme.ok} style={{ marginTop: 2 }} />
              ) : (
                <XmarkCircle width={15} height={15} color={theme.danger} style={{ marginTop: 2 }} />
              )}
              <View style={{ flex: 1 }}>
                <Text kind="sub">{evidence.caption}</Text>
                {evidence.command === null ? null : (
                  <Text kind="monoSmall" ink="t3">
                    {evidence.command}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
      {content.unverified === null || content.unverified.length === 0 ? null : (
        <View style={{ gap: 4 }}>
          <Text kind="caption" ink="t3">
            Not checked
          </Text>
          {content.unverified.map((line) => (
            <View key={line} style={{ flexDirection: 'row', gap: space.sm }}>
              <WarningTriangle width={15} height={15} color={theme.warm} style={{ marginTop: 2 }} />
              <Text kind="sub" style={{ flex: 1 }}>
                {line}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function Work({ block }: { readonly block: Extract<Block, { readonly kind: 'work' }> }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}
      >
        {block.working ? <LiveDot size={6} /> : null}
        <Text kind="sub" ink={block.working ? 'live' : 't3'}>
          {block.words}
        </Text>
        {open ? <NavArrowDown width={14} height={14} color={theme.t4} /> : <NavArrowRight width={14} height={14} color={theme.t4} />}
      </Pressable>
      {open ? (
        <View style={{ gap: 6, paddingLeft: space.md, borderLeftWidth: 1, borderLeftColor: theme.line2, marginTop: 4 }}>
          {block.tools.map((tool) => (
            <View key={tool.id} style={{ gap: 2 }}>
              <Text kind="sub" ink="t2">
                {tool.content.title}
              </Text>
              {tool.content.command === null ? null : (
                <Text kind="monoSmall" ink="t3">
                  $ {tool.content.label ?? tool.content.command}
                  {tool.content.exit === null || tool.content.exit === 0 ? '' : `  → exit ${tool.content.exit}`}
                </Text>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Item({ item, now }: { readonly item: ThreadItem; readonly now: number }) {
  const theme = useTheme()
  switch (item.kind) {
    case 'user_message':
      return (
        <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: theme.pressed, borderRadius: radius.lg, borderBottomRightRadius: 6, padding: space.md, gap: 4 }}>
          <Text kind="body">{item.content.text}</Text>
          <Text kind="caption" ink="t4" style={{ alignSelf: 'flex-end' }}>
            {item.input?.state === 'queued' ? 'Queued · ' : ''}
            {since(item.createdAt, now)}
          </Text>
        </View>
      )
    case 'agent_message':
      return (
        <View style={{ gap: 4 }}>
          <Text kind="caption" ink="t3">
            {whoWorks(item.agentId, null)}
          </Text>
          <Text kind="body" selectable>
            {item.content.text}
          </Text>
        </View>
      )
    case 'notice':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.line2 }} />
          <Text kind="caption" ink={item.content.severity === 'error' ? 'danger' : 't3'} style={{ maxWidth: '80%', textAlign: 'center' }}>
            {item.content.title}
            {item.content.description === null ? '' : `: ${item.content.description}`}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.line2 }} />
        </View>
      )
    case 'step_result':
      return <ReportCard report={item} />
    case 'question':
      return (
        <Well>
          <Text kind="sub" ink="signal">
            Asked: {item.content.fields[0]?.question ?? item.content.message}
          </Text>
        </Well>
      )
    default:
      return null
  }
}

export function Thread({
  items,
  now,
  streamed,
}: {
  readonly items: ReadonlyArray<ThreadItem>
  readonly now: number
  readonly streamed: { readonly agentId: string; readonly text: string } | null
}) {
  const blocks = blocksOf(items, now)
  return (
    <View style={{ gap: space.lg }}>
      {blocks.map((block) => (block.kind === 'work' ? <Work key={block.id} block={block} /> : <Item key={block.item.id} item={block.item} now={now} />))}
      {streamed === null ? null : (
        <View style={{ gap: 4 }} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <LiveDot size={5} />
            <Text kind="caption" ink="live">
              {whoWorks(streamed.agentId, null)} is writing
            </Text>
          </View>
          <Text kind="body">{streamed.text}</Text>
        </View>
      )}
    </View>
  )
}
