import type { Tool } from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { getDestructiveCommandWarning as getBashDestructiveCommandWarning } from '../../tools/BashTool/destructiveCommandWarning.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { getDestructiveCommandWarning as getPowerShellDestructiveCommandWarning } from '../../tools/PowerShellTool/destructiveCommandWarning.js'
import type { PermissionAskDecision } from './PermissionResult.js'
import { getConfiguredAutoYesMode } from '../xcoderConfig.js'

function hasDeleteLikeValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }

  return ['delete', 'deleted', 'remove'].includes(value.toLowerCase())
}

function isDestructiveToolAction(
  tool: Tool,
  input: Record<string, unknown>,
): boolean {
  const command =
    typeof input.command === 'string' ? input.command : undefined

  if (
    tool.name === BASH_TOOL_NAME &&
    command &&
    getBashDestructiveCommandWarning(command)
  ) {
    return true
  }

  if (
    tool.name === POWERSHELL_TOOL_NAME &&
    command &&
    getPowerShellDestructiveCommandWarning(command)
  ) {
    return true
  }

  if (tool.name.includes('Delete')) {
    return true
  }

  if (
    hasDeleteLikeValue(input.status) ||
    hasDeleteLikeValue(input.edit_mode) ||
    hasDeleteLikeValue(input.editMode) ||
    hasDeleteLikeValue(input.action) ||
    hasDeleteLikeValue(input.mode) ||
    hasDeleteLikeValue(input.operation)
  ) {
    return true
  }

  return false
}

export function shouldAutoApprovePermissionRequest(
  tool: Tool,
  input: Record<string, unknown>,
  decision: PermissionAskDecision,
): boolean {
  if (getConfiguredAutoYesMode() !== 'safe_except_delete_or_choice') {
    return false
  }

  if (tool.requiresUserInteraction?.()) {
    return false
  }

  if (decision.decisionReason?.type === 'safetyCheck') {
    return false
  }

  if (isDestructiveToolAction(tool, input)) {
    return false
  }

  return true
}
