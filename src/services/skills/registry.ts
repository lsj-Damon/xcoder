import type { Command } from '../../types/command.js'
import { buildSkillLifecycleState, type SkillLifecycleState } from './lifecycle.js'

export type SkillCommand = Extract<Command, { type: 'prompt' }>

export type SkillRegistryEntry = {
  id: string
  name: string
  source: SkillCommand['source']
  loadedFrom: SkillCommand['loadedFrom']
  command: SkillCommand
  lifecycle: SkillLifecycleState
  metadata: {
    argumentHint?: string
    model?: string
    paths?: string[]
    skillRoot?: string
    allowedTools: string[]
    userInvocable: boolean
  }
}

export function isSkillCommand(command: Command): command is SkillCommand {
  return command.type === 'prompt' && command.source !== 'builtin'
}

export function createSkillRegistryEntry(
  command: SkillCommand,
): SkillRegistryEntry {
  return {
    id: `${command.loadedFrom ?? command.source}:${command.name}`,
    name: command.name,
    source: command.source,
    loadedFrom: command.loadedFrom,
    command,
    lifecycle: buildSkillLifecycleState(command),
    metadata: {
      argumentHint: command.argumentHint,
      model: command.model,
      paths: command.paths,
      skillRoot: command.skillRoot,
      allowedTools: command.allowedTools ?? [],
      userInvocable: command.userInvocable ?? true,
    },
  }
}

export function createSkillRegistryEntries(
  commands: readonly Command[],
): SkillRegistryEntry[] {
  return commands.filter(isSkillCommand).map(createSkillRegistryEntry)
}

export function materializeSkillCommandsFromRegistry(
  entries: readonly SkillRegistryEntry[],
): SkillCommand[] {
  return entries.map(entry => entry.command)
}

export function isSkillVisibleToSkillTool(entry: SkillRegistryEntry): boolean {
  if (!entry.lifecycle.validation.isModelInvocable) {
    return false
  }

  return (
    entry.loadedFrom === 'bundled' ||
    entry.loadedFrom === 'skills' ||
    entry.loadedFrom === 'commands_DEPRECATED' ||
    entry.command.hasUserSpecifiedDescription === true ||
    entry.lifecycle.validation.hasWhenToUse
  )
}

export function isSkillVisibleToSlashCommands(
  entry: SkillRegistryEntry,
): boolean {
  return (
    (entry.command.hasUserSpecifiedDescription === true ||
      entry.lifecycle.validation.hasWhenToUse) &&
    (entry.loadedFrom === 'skills' ||
      entry.loadedFrom === 'plugin' ||
      entry.loadedFrom === 'bundled' ||
      entry.command.disableModelInvocation === true)
  )
}
