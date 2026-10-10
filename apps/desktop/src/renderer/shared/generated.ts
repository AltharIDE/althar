/*
 * Files a tool made rather than someone wrote: lockfiles, snapshots, minified
 * and mapped files, build output, and files named or kept as generated. They
 * go last in a task's changes, their diffs folded until asked for.
 */

const MADE: ReadonlyArray<RegExp> = [
  // lockfiles
  /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|deno\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|flake\.lock|Podfile\.lock|Package\.resolved|mix\.lock|pubspec\.lock|packages\.lock\.json)$/,
  // snapshots
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  // minified and mapped
  /\.min\.(js|css)$/,
  /\.map$/,
  // build output
  /(^|\/)(dist|build|out|\.next|coverage)\//,
  // named so
  /(^|\/)(__generated__|generated)\//,
  /\.generated\.\w+$/,
  /\.pb\.go$/,
  /_pb2(_grpc)?\.py$/,
  /\.g\.dart$/,
]

export const isGenerated = (path: string): boolean => MADE.some((pattern) => pattern.test(path))
