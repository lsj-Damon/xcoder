# Platform Layers

This guide summarizes the platform-oriented contracts that now sit underneath xcoder's interactive coding UX.

## Runtime Layers

1. Agent runtime
   Main conversation loop, worker/subagent orchestration, and permission-aware tool execution.

2. Context runtime
   Query-time compaction and preservation flow under `src/services/compact/pipeline/`.

3. Tool registry
   Unified registration seam for built-in and MCP tools under `src/services/tools/registry.ts`.

4. Skill lifecycle
   Skill metadata normalization, trust classification, and lifecycle validation under:
   - `src/services/skills/registry.ts`
   - `src/services/skills/lifecycle.ts`

5. Automation service
   Scheduler-facing runtime contract for task delivery and runtime state under:
   - `src/services/automation/service.ts`

6. Model routing
   Turn-level routing policy for selecting the execution model under:
   - `src/utils/model/routing.ts`

7. Agent policy
   Declarative policy layer for subagent tool isolation under:
   - `src/tools/AgentTool/agentPolicy.ts`

## Context Pipeline

The context runtime is now explicitly staged instead of being a single opaque compact step.

Current phases:
- tool-result budgeting
- snip
- microcompact
- context collapse
- autocompact
- preservation-aware rebuild

The pipeline remains query-driven, but the important shift is architectural: phase policy, preservation planning, and orchestration are now separate concerns.

## Tool Registry Model

`Tool` remains the execution contract. The registry adds an internal assembly and discovery contract on top of it.

Registry responsibilities:
- normalize built-in and MCP tool metadata
- preserve source identity (`builtin` vs `mcp`)
- provide stable registration IDs
- centralize sort/dedupe behavior for prompt-cache-sensitive tool pools

This keeps runtime dispatch stable while making future capability discovery and observability cleaner.

## Skill Lifecycle Model

Skills are still executed as prompt commands, but they now also have an explicit lifecycle interpretation.

Lifecycle concerns:
- trust level
- activation mode (`eager` vs `conditional`)
- shell-execution eligibility
- validation state for description, usage guidance, and model invocation

This gives xcoder a reusable contract for future managed skill mutation without forcing that full UI/tool surface into the current refactor.

## Automation Model

The scheduler core remains in `src/utils/cronScheduler.ts`, but callers now interact through an automation service contract.

Automation responsibilities:
- route fired tasks to the main REPL or teammate mailbox
- expose runtime scheduler state
- hold scheduler startup wiring separate from UI code

This keeps the durable cron machinery intact while making "automation" a recognizable runtime surface instead of a hook-local implementation detail.

## Model Routing Model

Turn-level routing is intentionally conservative.

Current behavior:
- routing is opt-in via `xcoder.yaml`
- plan/maintenance turns stay on the base model
- turns with attachments or larger prompt surfaces stay on the base model
- only small, low-risk turns can use the configured cheap model

The routing layer exists primarily to make selection policy explicit and observable before expanding behavior further.

## Agent Policy Model

Subagent isolation rules now have a dedicated policy layer instead of living only as ad hoc conditionals.

Policy concerns:
- global blocked tools
- custom-agent restrictions
- async-agent allowlists
- plan-mode exceptions
- in-process teammate exceptions

This makes future tightening around workspace inheritance, blocked side effects, and recovery rules easier to implement without rediscovering the current constraints.

## Channel And MCP Model

MCP and channel integrations remain runtime surfaces built around:
- MCP client discovery/refresh
- channel delivery and callback plumbing
- tool registry normalization

The current design still stores live MCP tools as `Tool[]` in app state, but registry-backed normalization now exists at the assembly boundary.

## Intentional Deferrals

The following remain intentionally out of scope for this round:
- full execution-backend abstraction across local/remote/hosted runners
- full create/update/delete managed skill UX
- aggressive automatic main-turn model downgrading

Those are good follow-up steps now that the surrounding platform contracts are more explicit.
