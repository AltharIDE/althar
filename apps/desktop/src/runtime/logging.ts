import { Logger } from 'effect'

import type { AgentStderr } from '@althar/runtime'

import { type LogFile, openLogFile } from '../logs/logFile'

/*
 * What the runtime's process logs (DEV-61). Its own lines go to stdout in
 * logfmt, without a time: the main process reads them and keeps them in
 * runtime.log, stamped as they arrive, so a crash's last words land there
 * too. What each agent's process writes to stderr goes to agents.log, which
 * this process alone writes, each line tagged with the agent and its pid.
 */

/** The runtime's log line: level, message, cause and annotations, as logfmt, without the time or the fiber. */
const line = Logger.map(Logger.formatLogFmt, (formatted) => formatted.replace(/^timestamp=\S+ /, '').replace(/ fiber=#\d+/, ''))

/** Writes each of the runtime's log lines to stdout, for the main process to keep. */
export const stdoutLogger = Logger.make((options) => {
  process.stdout.write(`${line.log(options)}\n`)
})

/** The most agents' processes whose half-written line is held at once; the oldest is written out to make room. */
const HELD = 64

/** The log of what agents' processes say on stderr, in `dir`; null where the main process gave no folder. */
export const agentsLog = (dir: string | undefined): { readonly file: LogFile; readonly stderr: AgentStderr } | null => {
  if (dir === undefined || dir === '') return null
  const file = openLogFile({ dir, name: 'agents' })
  const streams = new Map<number, ReturnType<LogFile['stream']>>()
  return {
    file,
    stderr: (agentId, chunk, pid) => {
      let stream = streams.get(pid)
      if (stream === undefined) {
        stream = file.stream(`${agentId}[${pid}]`)
        streams.set(pid, stream)
        if (streams.size > HELD) {
          const [oldest] = streams
          if (oldest !== undefined) {
            oldest[1].end()
            streams.delete(oldest[0])
          }
        }
      }
      stream.write(chunk)
    },
  }
}
