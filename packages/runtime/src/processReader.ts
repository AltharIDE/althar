import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * How a Mac's processes are read for the load meter (machine.ts) where `ps`
 * can't say enough: the CPU time a process has used counts only its own, so
 * every command that starts and ends between two readings, a test run's
 * workers or a hundred `git` calls, would count as nothing. The kernel keeps
 * what a process's children used once it has reaped them, and its children's
 * reaped children before them (`proc_pid_rusage`), and Node can't ask for it,
 * so a small program does: each process this user runs, with its parent,
 * when it started, its CPU time with its reaped children's, and its memory
 * footprint, as Activity Monitor shows it; or, given pids, the value one
 * variable has in each one's environment (`KERN_PROCARGS2`). macOS keeps the
 * environment of its own programs, such as `/bin/sh`, to itself.
 *
 * It is C, built at first use with the compiler of the Xcode Command Line
 * Tools, which git on a Mac comes with, into Althar's temporary folder, so
 * Althar ships no binary for it; named by a digest of its source, so a change
 * is built afresh. Without the tools nothing is built, and `ps` reads them.
 * A listing of 800 processes takes it about 10 ms, a third of what `ps` does.
 */

export const READER_SOURCE = String.raw`#include <libproc.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/sysctl.h>

/* Althar's process reader (packages/runtime/src/processReader.ts). With no arguments, a line for each process this user runs:
   its pid, its parent's, when it started in microseconds, the CPU time it and the children it reaped used in milliseconds, and
   its memory footprint in bytes. With a variable's name and pids, "pid value" for each whose environment sets it. */

static void value(pid_t pid, const char *name, char *buffer, size_t max) {
  int mib[3] = {CTL_KERN, KERN_PROCARGS2, pid};
  size_t size = max;
  if (sysctl(mib, 3, buffer, &size, NULL, 0) != 0 || size < sizeof(int)) return;
  int argc;
  memcpy(&argc, buffer, sizeof argc);
  char *at = buffer + sizeof argc, *end = buffer + size;
  /* The path it was started from, the padding after it, then its arguments: the environment follows them. */
  at = memchr(at, 0, (size_t)(end - at));
  if (at == NULL) return;
  while (at < end && *at == 0) at++;
  for (int i = 0; i < argc && at < end; i++) {
    at = memchr(at, 0, (size_t)(end - at));
    if (at == NULL) return;
    at++;
  }
  size_t length = strlen(name);
  while (at < end && *at != 0) {
    size_t n = strnlen(at, (size_t)(end - at));
    if (n > length && memcmp(at, name, length) == 0 && at[length] == '=') {
      const char *set = at + length + 1;
      if (set[0] != 0 && at + n < end && strpbrk(set, " \t\r\n") == NULL) printf("%d %s\n", pid, set);
      return;
    }
    at += n + 1;
  }
}

static int marks(int argc, char **argv) {
  int mib[2] = {CTL_KERN, KERN_ARGMAX};
  int argmax = 0;
  size_t size = sizeof argmax;
  if (sysctl(mib, 2, &argmax, &size, NULL, 0) != 0 || argmax <= 0) argmax = 1 << 20;
  char *buffer = malloc((size_t)argmax);
  if (buffer == NULL) return 1;
  for (int i = 2; i < argc; i++) value((pid_t)atoi(argv[i]), argv[1], buffer, (size_t)argmax);
  return 0;
}

int main(int argc, char **argv) {
  if (argc > 1) return marks(argc, argv);
  mach_timebase_info_data_t base;
  mach_timebase_info(&base);
  int count = proc_listallpids(NULL, 0);
  if (count <= 0) return 1;
  int room = count + 256;
  pid_t *pids = malloc(sizeof(pid_t) * (size_t)room);
  if (pids == NULL) return 1;
  count = proc_listallpids(pids, (int)(sizeof(pid_t) * (size_t)room));
  for (int i = 0; i < count; i++) {
    struct proc_bsdinfo info;
    struct rusage_info_v2 usage;
    if (proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &info, sizeof info) != sizeof info) continue;
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V2, (rusage_info_t *)&usage) != 0) continue;
    /* In the processor's ticks on Apple silicon, nanoseconds on Intel: the timebase says which. */
    unsigned long long ticks = usage.ri_user_time + usage.ri_system_time + usage.ri_child_user_time + usage.ri_child_system_time;
    printf("%d %u %llu %llu %llu\n", pids[i], info.pbi_ppid,
           (unsigned long long)info.pbi_start_tvsec * 1000000ULL + (unsigned long long)info.pbi_start_tvusec,
           ticks / base.denom * base.numer / 1000000ULL, (unsigned long long)usage.ri_phys_footprint);
  }
  return 0;
}
`

/** The reader's file name: its source's digest in it, so a changed reader is built afresh. */
export const readerName = `althar-processes-${createHash('sha256').update(READER_SOURCE).digest('hex').slice(0, 16)}`

/** What a command printed, or null where it couldn't run or failed. */
const output = (command: string, args: ReadonlyArray<string>, timeout = 5_000): Promise<string | null> =>
  new Promise((resolve) => {
    try {
      execFile(command, [...args], { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error === null ? stdout : null))
    } catch {
      resolve(null)
    }
  })

/**
 * The reader, built where it isn't yet; null where it can't be, as on a Mac
 * without the Command Line Tools. Their compiler is asked for only once
 * `xcode-select` says where they are: otherwise macOS would offer to install
 * them. Two built at once each build their own and the first in place stays.
 */
const build = async (folder: string): Promise<string | null> => {
  const path = join(folder, readerName)
  if (existsSync(path)) return path
  const tools = (await output('/usr/bin/xcode-select', ['-p']))?.trim()
  if (tools === undefined || tools === '' || !existsSync(tools)) return null
  let work: string
  try {
    mkdirSync(folder, { recursive: true })
    work = mkdtempSync(join(folder, 'build-'))
    writeFileSync(join(work, 'reader.c'), READER_SOURCE)
  } catch {
    return null
  }
  const built = await output('/usr/bin/xcrun', ['clang', '-O2', '-o', join(work, readerName), join(work, 'reader.c')], 60_000)
  try {
    if (built !== null) renameSync(join(work, readerName), path)
  } catch {
    // Another build put its reader in place first.
  }
  rmSync(work, { recursive: true, force: true })
  return existsSync(path) ? path : null
}

let reader: { path: string | null } | undefined
let building: Promise<string | null> | undefined

/** The reader, built once however often asked: its path, or null where it can't be. */
export const buildReader = (folder: string = join(tmpdir(), 'althar')): Promise<string | null> => {
  building ??= build(folder)
    .catch(() => null)
    .then((path) => {
      reader = { path }
      return path
    })
  return building
}

/**
 * The reader's path once it is built; null while it is being built, the
 * first time it is asked for, and where it can't be. Building takes a few
 * seconds at most and never holds a reading up.
 */
export const processReader = (): string | null => {
  if (reader !== undefined) return reader.path
  void buildReader()
  return null
}

/** What the reader prints, run as it is: every process, or with a variable's name and pids, the value each one's environment gives it. */
export const runReader = (path: string, args: ReadonlyArray<string> = []): Promise<string | null> => output(path, args)
