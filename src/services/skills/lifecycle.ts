import type { Command } from '../../types/command.js'

export type SkillTrustLevel =
  | 'managed'
  | 'workspace'
  | 'user'
  | 'plugin'
  | 'bundled'
  | 'remote'

export type SkillActivationMode = 'eager' | 'conditional'

export type SkillLifecycleValidation = {
  hasDescription: boolean
  hasWhenToUse: boolean
  isModelInvocable: boolean
  hasAllowedTools: boolean
}

export type SkillLifecycleState = {
  trustLevel: SkillTrustLevel
  activationMode: SkillActivationMode
  shellExecutionAllowed: boolean
  validation: SkillLifecycleValidation
}

type SkillLifecycleInput = Pick<
  Command,
  | 'description'
  | 'disableModelInvocation'
  | 'loadedFrom'
  | 'paths'
  | 'source'
  | 'type'
  | 'whenToUse'
> & {
  allowedTools?: string[]
}

function normalizeLoadedFrom(
  command: Pick<Command, 'loadedFrom' | 'source'>,
): Command['loadedFrom'] | Command['source'] | undefined {
  return command.loadedFrom ?? command.source
}

export function getSkillTrustLevel(
  command: Pick<Command, 'loadedFrom' | 'source'>,
): SkillTrustLevel {
  switch (normalizeLoadedFrom(command)) {
    case 'managed':
    case 'policySettings':
      return 'managed'
    case 'skills':
    case 'commands_DEPRECATED':
    case 'projectSettings':
      return 'workspace'
    case 'userSettings':
      return 'user'
    default:
      break
  }

  const loadedFrom = normalizeLoadedFrom(command)
  if (loadedFrom === 'plugin') return 'plugin'
  if (loadedFrom === 'bundled') return 'bundled'
  if (loadedFrom === 'mcp') return 'remote'
  return 'user'
}

export function canExecuteInlineShellForSkill(
  command: Pick<Command, 'loadedFrom' | 'source'>,
): boolean {
  return normalizeLoadedFrom(command) !== 'mcp'
}

export function buildSkillLifecycleState(
  command: SkillLifecycleInput,
): SkillLifecycleState {
  const hasDescription = command.description.trim().length > 0
  const hasWhenToUse = (command.whenToUse?.trim().length ?? 0) > 0

  return {
    trustLevel: getSkillTrustLevel(command),
    activationMode:
      command.paths && command.paths.length > 0 ? 'conditional' : 'eager',
    shellExecutionAllowed: canExecuteInlineShellForSkill(command),
    validation: {
      hasDescription,
      hasWhenToUse,
      isModelInvocable: !command.disableModelInvocation,
      hasAllowedTools:
        Array.isArray(command.allowedTools) && command.allowedTools.length > 0,
    },
  }
}
