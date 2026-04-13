import { buildPostCompactMessages } from '../compact.js'
import { queryCheckpoint } from '../../../utils/queryProfiler.js'
import { applyToolResultBudget } from '../../../utils/toolResultStorage.js'
import { recordContentReplacement } from '../../../utils/sessionStorage.js'
import { logError } from '../../../utils/log.js'
import type { Message } from '../../../types/message.js'
import type { MicrocompactResult } from '../microCompact.js'
import type {
  CompressionPipelineInput,
  CompressionPipelineResult,
} from './types.js'
import { deriveCompressionSignals } from './signals.js'
import { buildCompressionPolicy } from './policy.js'

export async function* runCompressionPipeline(
  input: CompressionPipelineInput,
): AsyncGenerator<Message, CompressionPipelineResult> {
  const signals = deriveCompressionSignals(input)
  const policy = buildCompressionPolicy(signals)
  let messagesForQuery = input.messages
  let tracking = input.tracking
  let preCompactMessages: Message[] | undefined

  // Enforce per-message budget on aggregate tool result size before any
  // compaction stage runs so later phases work on the already-trimmed view.
  if (policy.applyToolResultBudget) {
    messagesForQuery = await applyToolResultBudget(
      messagesForQuery,
      input.toolUseContext.contentReplacementState,
      policy.persistReplacements
        ? records =>
            void recordContentReplacement(
              records,
              input.toolUseContext.agentId,
            ).catch(logError)
        : undefined,
      new Set(
        input.toolUseContext.options.tools
          .filter(t => !Number.isFinite(t.maxResultSizeChars))
          .map(t => t.name),
      ),
    )
  }

  let snipTokensFreed = 0
  if (policy.applySnip && input.snipModule) {
    queryCheckpoint('query_snip_start')
    const snipResult = input.snipModule.snipCompactIfNeeded(messagesForQuery)
    messagesForQuery = snipResult.messages
    snipTokensFreed = snipResult.tokensFreed
    if (snipResult.boundaryMessage) {
      yield snipResult.boundaryMessage
    }
    queryCheckpoint('query_snip_end')
  }

  let microcompactResult: MicrocompactResult = { messages: messagesForQuery }
  if (policy.applyMicrocompact) {
    queryCheckpoint('query_microcompact_start')
    microcompactResult = await input.deps.microcompact(
      messagesForQuery,
      input.toolUseContext,
      input.querySource,
    )
    messagesForQuery = microcompactResult.messages
    queryCheckpoint('query_microcompact_end')
  }

  if (policy.applyContextCollapse && input.contextCollapse) {
    const collapseResult = await input.contextCollapse.applyCollapsesIfNeeded(
      messagesForQuery,
      input.toolUseContext,
      input.querySource,
    )
    messagesForQuery = collapseResult.messages
  }

  let compactionResult: CompressionPipelineResult['compactionResult']
  let consecutiveFailures: number | undefined
  if (policy.applyAutocompact) {
    queryCheckpoint('query_autocompact_start')
    const autoCompactResult = await input.deps.autocompact(
      messagesForQuery,
      input.toolUseContext,
      {
        systemPrompt: input.systemPrompt,
        userContext: input.userContext,
        systemContext: input.systemContext,
        toolUseContext: input.toolUseContext,
        forkContextMessages: messagesForQuery,
      },
      input.querySource,
      tracking,
      snipTokensFreed,
    )
    compactionResult = autoCompactResult.compactionResult
    consecutiveFailures = autoCompactResult.consecutiveFailures
    queryCheckpoint('query_autocompact_end')
  }

  if (compactionResult) {
    preCompactMessages = messagesForQuery
    const postCompactMessages = buildPostCompactMessages(compactionResult)
    for (const message of postCompactMessages) {
      yield message
    }
    messagesForQuery = postCompactMessages
  } else if (consecutiveFailures !== undefined) {
    tracking = {
      ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
      consecutiveFailures,
    }
  }

  return {
    messages: messagesForQuery,
    tracking,
    compactionResult,
    preCompactMessages,
    preservationPlan: signals.preservationPlan,
    pendingCacheEdits: microcompactResult.compactionInfo?.pendingCacheEdits,
    snipTokensFreed,
  }
}
