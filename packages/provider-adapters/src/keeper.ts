import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'

import { cleanUp } from './removal'

/*
 * The keeper: how Althar owns the whole tree of a process it starts on
 * Windows (processTrees.ts). Node can't make a Job Object, so a small program
 * does: Althar spawns the keeper with the command, and the keeper starts it
 * suspended, puts it in a job of its own, lets it run, waits for it and exits
 * with its code. Everything the command starts is in that job from its first
 * instruction, however its parents come and go, and the job kills them all
 * once nothing holds it: the keeper alone does, so the tree goes with the
 * keeper, whether it exits or is killed, and with Althar, whose children Node
 * keeps in a job of its own. The command runs in a console of its own whose
 * window is never shown, which the console programs it starts share whether
 * or not they ask to be hidden; with no console, each would open a window of
 * its own. The keeper also says when a process started.
 *
 * It is C# for the .NET Framework 4 that comes with Windows, built at first
 * use by that framework's compiler into Althar's temporary folder, so Althar
 * ships no binary for it, and named by a digest of its source, so a change is
 * built afresh. The command line after `run` is passed on as Node quoted it,
 * so the command gets its arguments as if Node had started it.
 */

export const KEEPER_SOURCE = String.raw`using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

// Althar's keeper (packages/provider-adapters/src/keeper.ts). "run <command line>" runs a command in a Job Object that kills
// everything in it once the keeper has gone, in a console whose window is hidden; "started <pid>" prints when a process started, in UTC.
static class Keeper
{
    const uint KillOnJobClose = 0x2000;
    const int ExtendedLimitInformation = 9;
    const uint CreateSuspended = 0x4;
    const uint CreateNewConsole = 0x10;
    const int UseShowWindow = 0x1;
    const int UseStdHandles = 0x100;
    const short Hide = 0;
    const uint Infinite = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits
    {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int length);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation started);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);

    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 2 && args[0] == "started") return Started(int.Parse(args[1], CultureInfo.InvariantCulture));
            if (args.Length >= 2 && args[0] == "run") return Run(After(Environment.CommandLine, "run"));
            Console.Error.WriteLine("althar-keeper: run <command> [arguments] | started <pid>");
            return 2;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("althar-keeper: " + error.Message);
            return 1;
        }
    }

    // The command line as it was given, after the keeper's own name and the word that says what to do.
    static string After(string line, string word)
    {
        int at = 0;
        if (line.Length > 0 && line[0] == '"')
        {
            int closing = line.IndexOf('"', 1);
            at = closing < 0 ? line.Length : closing + 1;
        }
        else
        {
            while (at < line.Length && line[at] != ' ' && line[at] != '\t') at++;
        }
        while (at < line.Length && (line[at] == ' ' || line[at] == '\t')) at++;
        if (string.CompareOrdinal(line, at, word, 0, word.Length) != 0) throw new ArgumentException("the command line doesn't say " + word);
        at += word.Length;
        while (at < line.Length && (line[at] == ' ' || line[at] == '\t')) at++;
        return line.Substring(at);
    }

    static int Run(string commandLine)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        ExtendedLimits limits = new ExtendedLimits();
        limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
        if (!SetInformationJobObject(job, ExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(ExtendedLimits)))) throw new Win32Exception();

        StartupInfo startup = new StartupInfo();
        startup.cb = Marshal.SizeOf(typeof(StartupInfo));
        // A console of its own, created hidden, for everything it starts to share: a process with none, as under CREATE_NO_WINDOW,
        // would have each console program it starts open a window, unless that program asked to be hidden.
        startup.dwFlags = UseStdHandles | UseShowWindow;
        startup.wShowWindow = Hide;
        startup.hStdInput = GetStdHandle(-10);
        startup.hStdOutput = GetStdHandle(-11);
        startup.hStdError = GetStdHandle(-12);
        ProcessInformation started;
        if (!CreateProcess(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | CreateNewConsole,
                IntPtr.Zero, null, ref startup, out started))
            throw new Win32Exception();
        if (!AssignProcessToJobObject(job, started.hProcess))
        {
            Win32Exception refused = new Win32Exception();
            TerminateProcess(started.hProcess, 1);
            throw refused;
        }
        if (ResumeThread(started.hThread) == Infinite)
        {
            Win32Exception refused = new Win32Exception();
            TerminateProcess(started.hProcess, 1);
            throw refused;
        }
        WaitForSingleObject(started.hProcess, Infinite);
        uint code;
        if (!GetExitCodeProcess(started.hProcess, out code)) throw new Win32Exception();
        return unchecked((int)code);
    }

    static int Started(int pid)
    {
        Process process;
        try
        {
            process = Process.GetProcessById(pid);
        }
        catch (ArgumentException)
        {
            return 3;
        }
        using (process)
        {
            Console.Out.Write(process.StartTime.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
        }
        return 0;
    }
}
`

/** The keeper's file name: its source's digest in it, so a changed keeper is built afresh. */
export const keeperName = `althar-keeper-${createHash('sha256').update(KEEPER_SOURCE).digest('hex').slice(0, 16)}.exe`

/** Where Windows keeps the .NET Framework 4 compiler, 64-bit first; undefined where it has none. */
export const compilerOf = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined =>
  ['Framework64', 'Framework']
    .map((framework) => `${env.SystemRoot ?? 'C:\\Windows'}\\Microsoft.NET\\${framework}\\v4.0.30319\\csc.exe`)
    .find(exists)

let built: string | undefined

/**
 * The keeper's path, built where it isn't yet; why it can't be, where it
 * can't. Two built at once each build their own and the first in place stays.
 */
export const keeper = (folder: string = join(tmpdir(), 'althar')): Effect.Effect<string, string> =>
  Effect.suspend(() => {
    const path = join(folder, keeperName)
    if (built === path || existsSync(path)) {
      built = path
      return Effect.succeed(path)
    }
    const compiler = compilerOf()
    if (compiler === undefined)
      return Effect.fail("Windows has no .NET Framework 4 compiler, which Althar builds the keeper of its agents' processes with")
    return Effect.callback<string, string>((resume) => {
      let work: string
      try {
        mkdirSync(folder, { recursive: true })
        work = mkdtempSync(join(folder, 'build-'))
        writeFileSync(join(work, 'keeper.cs'), KEEPER_SOURCE)
      } catch (error) {
        return resume(Effect.fail(`Althar couldn't build the keeper of its agents' processes: ${String(error)}`))
      }
      execFile(
        compiler,
        ['/nologo', '/target:exe', '/optimize+', `/out:${join(work, keeperName)}`, join(work, 'keeper.cs')],
        { cwd: work, timeout: 60_000, windowsHide: true },
        (error, stdout) => {
          try {
            if (error === null) renameSync(join(work, keeperName), path)
          } catch {
            // Another build put its keeper in place first.
          }
          // Where it was built goes, but a folder Windows still holds after the compiler leaves no keeper unbuilt.
          resume(
            Effect.andThen(
              cleanUp(work, "where the keeper of agents' processes was built"),
              Effect.suspend(() => {
                if (!existsSync(path))
                  return Effect.fail(
                    `Althar couldn't build the keeper of its agents' processes: ${(stdout || (error?.message ?? "it couldn't be put in place")).trim().slice(-500)}`,
                  )
                built = path
                return Effect.succeed(path)
              }),
            ),
          )
        },
      )
    })
  })

/** When the keeper says a process started, as ISO 8601, or undefined where it can't say, as for one that has exited. */
export const keeperStartedAt = (path: string, pid: number): Effect.Effect<string | undefined> =>
  Effect.callback((resume) => {
    execFile(path, ['started', String(pid)], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
      const started = error === null ? new Date(stdout.trim()) : undefined
      resume(Effect.succeed(started !== undefined && !Number.isNaN(started.getTime()) ? started.toISOString() : undefined))
    })
  })
