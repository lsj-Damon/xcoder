import uniqBy from 'lodash-es/uniqBy.js'
import type { Tool, Tools } from '../../Tool.js'

export type ToolRegistrySource = 'builtin' | 'mcp'

export type ToolRegistryMetadata = {
  alwaysLoad?: boolean
  searchHint?: string
  mcp?: {
    serverName: string
    toolName: string
  }
}

export type ToolRegistryEntry<T extends Tool = Tool> = {
  id: string
  name: string
  source: ToolRegistrySource
  tool: T
  metadata: ToolRegistryMetadata
}

function getToolRegistrySource(
  tool: Pick<Tool, 'isMcp' | 'mcpInfo'>,
): ToolRegistrySource {
  return tool.isMcp === true || tool.mcpInfo !== undefined ? 'mcp' : 'builtin'
}

export function createToolRegistryEntry<T extends Tool>(
  tool: T,
): ToolRegistryEntry<T> {
  const source = getToolRegistrySource(tool)
  const metadata: ToolRegistryMetadata = {}

  if (tool.alwaysLoad === true) {
    metadata.alwaysLoad = true
  }

  if (typeof tool.searchHint === 'string' && tool.searchHint.length > 0) {
    metadata.searchHint = tool.searchHint
  }

  if (tool.mcpInfo) {
    metadata.mcp = {
      serverName: tool.mcpInfo.serverName,
      toolName: tool.mcpInfo.toolName,
    }
  }

  return {
    id:
      metadata.mcp !== undefined
        ? `mcp:${metadata.mcp.serverName}:${metadata.mcp.toolName}`
        : `builtin:${tool.name}`,
    name: tool.name,
    source,
    tool,
    metadata,
  }
}

export function createToolRegistryEntries<T extends Tool>(
  tools: readonly T[],
): ToolRegistryEntry<T>[] {
  return tools.map(tool => createToolRegistryEntry(tool))
}

export function materializeToolsFromRegistry(
  entries: readonly ToolRegistryEntry[],
): Tools {
  return entries.map(entry => entry.tool)
}

export function sortAndDedupeToolRegistryEntries<T extends ToolRegistryEntry>(
  entries: readonly T[],
): T[] {
  const builtInEntries: T[] = []
  const mcpEntries: T[] = []

  for (const entry of entries) {
    if (entry.source === 'mcp') {
      mcpEntries.push(entry)
      continue
    }

    builtInEntries.push(entry)
  }

  const byName = (a: ToolRegistryEntry, b: ToolRegistryEntry) =>
    a.name.localeCompare(b.name)

  return uniqBy(
    [...builtInEntries].sort(byName).concat([...mcpEntries].sort(byName)),
    'name',
  )
}
