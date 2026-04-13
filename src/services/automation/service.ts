import {
  getScheduledTasksEnabled,
  getSessionCronTasks,
} from '../../bootstrap/state.js'
import {
  createCronScheduler,
  type CronScheduler,
} from '../../utils/cronScheduler.js'
import type { CronJitterConfig, CronTask } from '../../utils/cronTasks.js'

export type AutomationDelivery =
  | {
      kind: 'lead'
      task: CronTask
    }
  | {
      kind: 'teammate'
      agentId: string
      task: CronTask
    }

export type AutomationRuntimeState = {
  scheduledTasksEnabled: boolean
  sessionTaskCount: number
}

export type AutomationService = {
  start: () => void
  stop: () => void
  getNextFireTime: () => number | null
  getRuntimeState: () => AutomationRuntimeState
}

type AutomationServiceOptions = {
  assistantMode?: boolean
  getJitterConfig?: () => CronJitterConfig
  isKilled?: () => boolean
  isLoading: () => boolean
  onLeadPrompt: (prompt: string) => void
  onDelivery: (delivery: AutomationDelivery) => void
}

export function getAutomationRuntimeState(): AutomationRuntimeState {
  return {
    scheduledTasksEnabled: getScheduledTasksEnabled(),
    sessionTaskCount: getSessionCronTasks().length,
  }
}

export function resolveAutomationDelivery(task: CronTask): AutomationDelivery {
  if (task.agentId) {
    return {
      kind: 'teammate',
      agentId: task.agentId,
      task,
    }
  }

  return {
    kind: 'lead',
    task,
  }
}

export function createAutomationService(
  options: AutomationServiceOptions,
): AutomationService {
  const scheduler: CronScheduler = createCronScheduler({
    onFire: options.onLeadPrompt,
    onFireTask: task => {
      options.onDelivery(resolveAutomationDelivery(task))
    },
    isLoading: options.isLoading,
    assistantMode: options.assistantMode,
    getJitterConfig: options.getJitterConfig,
    isKilled: options.isKilled,
  })

  return {
    start: scheduler.start,
    stop: scheduler.stop,
    getNextFireTime: scheduler.getNextFireTime,
    getRuntimeState: getAutomationRuntimeState,
  }
}
