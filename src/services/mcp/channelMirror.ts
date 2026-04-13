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
      .enum(['status', 'tool', 'progress', 'assistant', 'permission', 'error'])
      .optional(),
  }),
})

export type ChannelMirrorStatusParams = z.infer<
  typeof ChannelMirrorStatusNotificationSchema
>['params']

export type ChannelMirrorCallbacks = {
  notifyStatus(params: ChannelMirrorStatusParams): void
}

type TerminalErrorMirrorSource = 'query' | 'remote-task'

type TerminalErrorMirrorInput = {
  source: TerminalErrorMirrorSource
  summary: string
  details?: string
  scopeId?: string
  subject?: string
}

const MAX_ERROR_SUBJECT_LENGTH = 80
const MAX_ERROR_SUMMARY_LENGTH = 120
const MAX_ERROR_DETAILS_LENGTH = 280

function formatCountLabel(count: number, noun: string): string {
  return `${count} ${noun}`
}

function normalizeMirrorText(text: string | undefined): string {
  return text?.replace(/\s+/g, ' ').trim() || ''
}

function truncateMirrorText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function buildMirrorDedupeSegment(value: string | undefined): string {
  const normalized = normalizeMirrorText(value)
  if (!normalized) {
    return 'none'
  }
  return encodeURIComponent(normalized.toLowerCase()).slice(0, 96)
}

export function buildTerminalErrorMirrorStatus(
  input: TerminalErrorMirrorInput,
): ChannelMirrorStatusParams {
  const sourceLabel = input.source === 'query' ? '主查询' : '远程任务'
  const summary = truncateMirrorText(
    normalizeMirrorText(input.summary),
    MAX_ERROR_SUMMARY_LENGTH,
  )
  const subject = truncateMirrorText(
    normalizeMirrorText(input.subject),
    MAX_ERROR_SUBJECT_LENGTH,
  )
  const details = truncateMirrorText(
    normalizeMirrorText(input.details),
    MAX_ERROR_DETAILS_LENGTH,
  )

  const lines = ['任务中断', `来源：${sourceLabel}`]
  if (subject) {
    lines.push(`任务：${subject}`)
  }
  lines.push(`原因：${summary}`)
  if (details && details !== summary) {
    lines.push(`详情：${details}`)
  }

  return {
    category: 'error',
    text: lines.join('\n'),
    urgent: true,
    dedupeKey: `error:${input.source}:${buildMirrorDedupeSegment(input.scopeId)}:${buildMirrorDedupeSegment(
      [subject, summary, details].filter(Boolean).join('|'),
    )}`,
  }
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
