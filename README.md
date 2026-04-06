# xcoder

**xcoder, the free build of Claude Code.**

All telemetry stripped. All injected security-prompt guardrails removed. All experimental features unlocked. One binary, zero callbacks home.

```bash
curl -fsSL https://raw.githubusercontent.com/lsj-Damon/xcoder/main/install.sh | bash
```

```powershell
powershell -c "irm https://raw.githubusercontent.com/lsj-Damon/xcoder/main/install.ps1 | iex"
```

> The installers check your system, install Bun if needed, clone the repo, build with all features enabled, and put `xcoder` on your PATH. On native Windows, install `Git for Windows` first because the CLI expects `Git Bash` to be available.
> When you run an installer from the repository root, it prefers the current local source tree and only falls back to remote fetch if no valid local source tree is detected.

<p align="center">
  <img src="assets/screenshot.png" alt="xcoder screenshot" width="800" />
</p>

---

## What is this

This is a clean, buildable fork of Anthropic's [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI -- the terminal-native AI coding agent. The upstream source became publicly available on March 31, 2026 through a source map exposure in the npm distribution.

This fork applies three categories of changes on top of that snapshot:

### 1. Telemetry removed

The upstream binary phones home through OpenTelemetry/gRPC, GrowthBook analytics, Sentry error reporting, and custom event logging. In this build:

- All outbound telemetry endpoints are dead-code-eliminated or stubbed
- GrowthBook feature flag evaluation still works locally (needed for runtime feature gates) but does not report back
- No crash reports, no usage analytics, no session fingerprinting

### 2. Security-prompt guardrails removed

Anthropic injects system-level instructions into every conversation that constrain Claude's behavior beyond what the model itself enforces. These include:

- Hardcoded refusal patterns for certain categories of prompts
- Injected "cyber risk" instruction blocks
- Managed-settings security overlays pushed from Anthropic's servers

This build strips those injections. The model's own safety training still applies -- this just removes the extra layer of prompt-level restrictions that the CLI wraps around it.

### 3. Experimental features enabled

Claude Code ships with dozens of feature flags gated behind `bun:bundle` compile-time switches. Most are disabled in the public npm release. This build unlocks all 45+ flags that compile cleanly, including:

| Feature | What it does |
|---|---|
| `ULTRAPLAN` | Remote multi-agent planning on Claude Code web (Opus-class) |
| `ULTRATHINK` | Deep thinking mode -- type "ultrathink" to boost reasoning effort |
| `VOICE_MODE` | Push-to-talk voice input and dictation |
| `AGENT_TRIGGERS` | Local cron/trigger tools for background automation |
| `BRIDGE_MODE` | IDE remote-control bridge (VS Code, JetBrains) |
| `TOKEN_BUDGET` | Token budget tracking and usage warnings |
| `BUILTIN_EXPLORE_PLAN_AGENTS` | Built-in explore/plan agent presets |
| `VERIFICATION_AGENT` | Verification agent for task validation |
| `BASH_CLASSIFIER` | Classifier-assisted bash permission decisions |
| `EXTRACT_MEMORIES` | Post-query automatic memory extraction |
| `HISTORY_PICKER` | Interactive prompt history picker |
| `MESSAGE_ACTIONS` | Message action entrypoints in the UI |
| `QUICK_SEARCH` | Prompt quick-search |
| `SHOT_STATS` | Shot-distribution stats |
| `COMPACTION_REMINDERS` | Smart reminders around context compaction |
| `CACHED_MICROCOMPACT` | Cached microcompact state through query flows |

See [FEATURES.md](FEATURES.md) for the full audit of all 88 flags and their status.

---

## Quick install

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/lsj-Damon/xcoder/main/install.sh | bash
```

### Windows PowerShell

```powershell
powershell -c "irm https://raw.githubusercontent.com/lsj-Damon/xcoder/main/install.ps1 | iex"
```

This will check your system, install Bun if needed, clone the repo, build the binary with all experimental features enabled, and expose it as `xcoder` on your PATH. If `git clone` is corrupted by endpoint/security software on Windows, the installer automatically falls back to the GitHub source ZIP.

### xcoder.yaml

`xcoder` can read a standalone `xcoder.yaml` file from the project root.

Copy [xcoder.yaml.example](/d:/Develop/workspace/free-code/xcoder.yaml.example) to `xcoder.yaml` and choose the active model as `provider:model`.

Example:

```yaml
xcoder:
  model: "relay:claude-sonnet-4-6"

providers:
  relay:
    type: "anthropic-compatible"
    api_key_env: "ANTHROPIC_API_KEY"
    api_base: "https://your-relay.example.com"

  openai:
    type: "openai"
    api_key_env: "OPENAI_API_KEY"
    api_base: "https://api.openai.com/v1"
```

For an OpenAI-compatible relay such as `https://w.ciykj.cn`, a concrete config looks like:

```yaml
xcoder:
  model: "relay:gpt-5.4"

providers:
  relay:
    type: "openai-compatible"
    api_key_env: "OPENAI_API_KEY"
    api_base: "https://w.ciykj.cn/v1"
```

### Permissions Policy

`xcoder.yaml` can also override the default confirmation behavior:

```yaml
permissions:
  auto_yes_mode: "safe_except_delete_or_choice"
```

This mode auto-approves ordinary fetches, searches, MCP tool calls, and non-destructive shell commands, while still prompting for delete/remove actions, structured choice-style interactions, and explicit safety checks.

### Feishu Channel

`xcoder.yaml` can also declare a Feishu channel server. The recommended local setup is Feishu/Lark long-connection mode (`connectionMode: "websocket"`), which lets `xcoder` keep an outbound connection and receive events without exposing your machine to the public internet.

Recommended local example:

```yaml
channels:
  feishu:
    enabled: true
    mode: "mcp"
    connectionMode: "websocket"
    domain: "feishu"
    dmPolicy: "pairing"
    server_name: "feishu"
    command: "bun"
    args:
      - "run"
      - "./channels/feishu-channel/server.ts"
    accounts:
      main:
        app_id_env: "FEISHU_APP_ID"
        app_secret_env: "FEISHU_APP_SECRET"
        encrypt_key_env: "FEISHU_ENCRYPT_KEY"
        verification_token_env: "FEISHU_VERIFICATION_TOKEN"
        bot_name: "xcoder"
    allow_from: []
    approval:
      enabled: true
    mirror:
      enabled: true
      progress: true
      tool_events: true
      assistant_updates: true
      throttle_ms: 3000
```

Use `domain: "lark"` for the international Lark endpoint instead of mainland Feishu.

If you prefer webhook mode, add a public callback URL:

```yaml
channels:
  feishu:
    connectionMode: "webhook"
    bind_host: "127.0.0.1"
    bind_port: 39876
    callback_path: "/feishu/events"
    public_base_url: "https://your-public-domain.example.com"
```

In webhook mode, the local server listens on:

`http://127.0.0.1:39876/feishu/events`

Expose that path through your own tunnel or reverse proxy and use the public URL in Feishu's event subscription settings. In websocket mode, `public_base_url` is not needed.

To mirror important process updates back to Feishu while the session runs, enable:

```yaml
channels:
  feishu:
    mirror:
      enabled: true
      progress: true
      tool_events: true
      assistant_updates: true
      throttle_ms: 3000
```

This mirrors key milestones such as "message received", tool start/finish/failure, permission results, progress summaries, and plain assistant text replies. It is designed for locked-screen use where the machine stays awake and online.

### Local Source Tree

Run the installer from the repository root to install and launch the code you are currently editing:

```bash
bash ./install.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

After install, run:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
xcoder
```

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
xcoder
```

---

## Requirements

- [Bun](https://bun.sh) >= 1.3.11
- [Git](https://git-scm.com/)
- macOS or Linux for `install.sh`
- Windows 10/11 with PowerShell and Git for Windows (Git Bash) for `install.ps1`
- An Anthropic API key (set `ANTHROPIC_API_KEY` in your environment)

```bash
# Install Bun on macOS / Linux if you don't have it
curl -fsSL https://bun.sh/install | bash
```

```powershell
# Install Bun on Windows PowerShell if you don't have it
powershell -c "irm bun.sh/install.ps1|iex"
```

Some features still require WSL2 or Unix-like environments, including sandboxing, tmux-backed swarms, and `mcp add-from-claude-desktop`.

---

## Build

```bash
# Clone the repo
git clone https://github.com/lsj-Damon/xcoder.git
cd xcoder

# Install dependencies
bun install

# Standard build -- produces ./cli
bun run build

# Dev build -- dev version stamp, experimental GrowthBook key
bun run build:dev

# Dev build with ALL experimental features enabled -- produces ./cli-dev
bun run build:dev:full

# Compiled build (alternative output path) -- produces ./dist/cli
bun run compile
```

On Windows PowerShell, the native installer is the easiest path. If you build manually, run the resulting binary as `.\cli-dev.exe` and make sure `Git Bash` is installed.

### Build variants

| Command | Output | Features | Notes |
|---|---|---|---|
| `bun run build` | `./cli` | `VOICE_MODE` only | Production-like binary |
| `bun run build:dev` | `./cli-dev` | `VOICE_MODE` only | Dev version stamp |
| `bun run build:dev:full` | `./cli-dev` | All 45+ experimental flags | The full unlock build |
| `bun run compile` | `./dist/cli` | `VOICE_MODE` only | Alternative output directory |

### Individual feature flags

You can enable specific flags without the full bundle:

```bash
# Enable just ultraplan and ultrathink
bun run ./scripts/build.ts --feature=ULTRAPLAN --feature=ULTRATHINK

# Enable a specific flag on top of the dev build
bun run ./scripts/build.ts --dev --feature=BRIDGE_MODE
```

---

## Run

```bash
# Run the built binary directly
./cli

# Or the dev binary
./cli-dev

# Or run from source without compiling (slower startup)
bun run dev

# Set your API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Or use Claude.ai OAuth
./cli /login
```

```powershell
# Windows PowerShell
.\cli-dev.exe

# Set your API key for this session
$env:ANTHROPIC_API_KEY="sk-ant-..."

# Or use Claude.ai OAuth
xcoder /login
```

### Quick test

```bash
# One-shot mode
./cli -p "what files are in this directory?"

# Interactive REPL (default)
./cli

# With specific model
./cli --model claude-sonnet-4-6-20250514
```

---

## Project structure

```
scripts/
  build.ts              # Build script with feature flag system

src/
  entrypoints/cli.tsx   # CLI entrypoint
  commands.ts           # Command registry (slash commands)
  tools.ts              # Tool registry (agent tools)
  QueryEngine.ts        # LLM query engine
  screens/REPL.tsx      # Main interactive UI

  commands/             # /slash command implementations
  tools/                # Agent tool implementations (Bash, Read, Edit, etc.)
  components/           # Ink/React terminal UI components
  hooks/                # React hooks
  services/             # API client, MCP, OAuth, analytics
  state/                # App state store
  utils/                # Utilities
  skills/               # Skill system
  plugins/              # Plugin system
  bridge/               # IDE bridge
  voice/                # Voice input
  tasks/                # Background task management
```

---

## Tech stack

| | |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript |
| Terminal UI | React + [Ink](https://github.com/vadimdemedes/ink) |
| CLI parsing | [Commander.js](https://github.com/tj/commander.js) |
| Schema validation | Zod v4 |
| Code search | ripgrep (bundled) |
| Protocols | MCP, LSP |
| API | Anthropic Messages API |

---

## IPFS Mirror

A full copy of this repository is permanently pinned on IPFS via Filecoin:

- **CID:** `bafybeiegvef3dt24n2znnnmzcud2vxat7y7rl5ikz7y7yoglxappim54bm`
- **Gateway:** https://w3s.link/ipfs/bafybeiegvef3dt24n2znnnmzcud2vxat7y7rl5ikz7y7yoglxappim54bm

If this repo gets taken down, the code lives on.

---

## License

The original Claude Code source is the property of Anthropic. This fork exists because the source was publicly exposed through their npm distribution. Use at your own discretion.
