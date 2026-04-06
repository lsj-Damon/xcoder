import { z } from 'zod/v4'
import type { ToolProgressData } from '../../Tool.js'

export const CHANNEL_MIRROR_STATUS_METHOD =
  'notifications/xcoder/channel_status'
export const CHANNEL_MIRROR_STATUS_CAPABILITY = 'xcoder/channel_status'

export const ChannelMirrorStatusNotificationSchema = z.object({
  method: z.literal(CHANNEL_MIRROR_STATUS_METHOD),
  params: z.object({
    text: z.string(),
    dedupeKey: z.string().optional(),
    urgent: z.boolean().optional(),
    category: z
      .enum(['status', 'tool', 'progress', 'assistant', 'permission'])
      .optional(),
  }),
})

export type ChannelMirrorStatusParams = z.infer<
  typeof ChannelMirrorStatusNotificationSchema
>['params']

export type ChannelMirrorCallbacks = {
  notifyStatus(params: ChannelMirrorStatusParams): void
}

function formatCountLabel(count: number, noun: string): string {
  return `${count} ${noun}`
}

export function buildMirrorStatusFromToolProgress(
  data: ToolProgressData,
): ChannelMirrorStatusParams | null {
  if (data.type === 'mcp_progress') {
    const toolName = data.toolName || 'MCP tool'
    if (data.status === 'started') {
      return {
        category: 'tool',
        text: `已开始执行工具：${toolName}`,
        dedupeKey: `tool:${toolName}:started`,
      }
    }
    if (data.status === 'completed') {
      return {
        category: 'tool',
        text: `已完成工具：${toolName}`,
        dedupeKey: `tool:${toolName}:completed`,
      }
    }
    if (data.status === 'failed') {
      return {
        category: 'tool',
        text: `工具执行失败：${toolName}`,
        dedupeKey: `tool:${toolName}:failed`,
        urgent: true,
      }
    }
    if (data.status === 'progress') {
      return {
        category: 'progress',
        text:
          data.progressMessage?.trim() ||
          `工具执行中：${toolName}`,
        dedupeKey: `tool:${toolName}:progress`,
      }
    }
    return null
  }

  if (data.type === 'bash_progress' || data.type === 'powershell_progress') {
    const shellName = data.type === 'bash_progress' ? 'Bash' : 'PowerShell'
    const elapsed =
      typeof data.elapsedTimeSeconds === 'number'
        ? `${data.elapsedTimeSeconds}s`
        : undefined
    const lines =
      typeof data.totalLines === 'number'
        ? formatCountLabel(data.totalLines, 'lines')
        : undefined
    const parts = [elapsed, lines].filter(Boolean)
    return {
      category: 'progress',
      text:
        parts.length > 0
          ? `${shellName} 执行中：${parts.join(' · ')}`
          : `${shellName} 执行中`,
      dedupeKey: `${shellName.toLowerCase()}:progress:${data.taskId || 'active'}`,
    }
  }

  return null
}
