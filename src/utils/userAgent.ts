/**
 * User-Agent string helpers.
 *
 * Kept dependency-free so SDK-bundled code (bridge, cli/transports) can
 * import without pulling in auth.ts and its transitive dependency tree.
 */

export function getClaudeCodeUserAgent(): string {
  return sanitizeHeaderValue(`claude-code/${MACRO.VERSION}`)
}

function sanitizeHeaderValue(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
