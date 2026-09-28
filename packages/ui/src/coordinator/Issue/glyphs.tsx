/*
 * An issue tracker's small glyphs for workflow state and priority, drawn at
 * 12px in currentColor. Drawings only; Issue decides where they go.
 */
import type { ReactNode } from 'react'

import { IssuePriority, IssueStatus, unreachable } from '../../foundations/vocabulary'

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">
    {children}
  </svg>
)

export function StatusGlyph({ status }: { status: IssueStatus }) {
  switch (status) {
    case IssueStatus.Backlog:
      return (
        <Svg>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.6 1.6" />
        </Svg>
      )
    case IssueStatus.Todo:
      return (
        <Svg>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </Svg>
      )
    case IssueStatus.InProgress:
      return (
        <Svg>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" />
        </Svg>
      )
    case IssueStatus.Done:
      return (
        <Svg>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path d="m4.5 7.2 1.7 1.7 3.4-3.6" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )
    case IssueStatus.Cancelled:
      return (
        <Svg>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path d="m5 5 4 4m0-4-4 4" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
        </Svg>
      )
    default:
      return unreachable(status)
  }
}

const bar = (x: number, y: number, on: boolean) => (
  <rect key={x} x={x} y={y} width="2.5" height={12.5 - y} rx="0.6" fill="currentColor" opacity={on ? 1 : 0.3} />
)

export function PriorityGlyph({ priority }: { priority: IssuePriority }) {
  switch (priority) {
    case IssuePriority.None:
      return (
        <Svg>
          <path d="M1.5 7h2.5m1.75 0h2.5m1.75 0h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </Svg>
      )
    case IssuePriority.Urgent:
      return (
        <Svg>
          <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
          <path d="M7 3.8v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="10.1" r="0.95" fill="#fff" />
        </Svg>
      )
    case IssuePriority.High:
      return <Svg>{[bar(1.5, 8, true), bar(5.75, 5, true), bar(10, 2, true)]}</Svg>
    case IssuePriority.Medium:
      return <Svg>{[bar(1.5, 8, true), bar(5.75, 5, true), bar(10, 2, false)]}</Svg>
    case IssuePriority.Low:
      return <Svg>{[bar(1.5, 8, true), bar(5.75, 5, false), bar(10, 2, false)]}</Svg>
    default:
      return unreachable(priority)
  }
}
