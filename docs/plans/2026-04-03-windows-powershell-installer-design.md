# Native Windows PowerShell Installer Design

## Goal

Add a first-party Windows installation path without disturbing the existing Unix installer.

## Chosen Approach

Create a new `install.ps1` that mirrors the behavior of `install.sh`, but uses native PowerShell conventions:

- Require native Windows
- Check for `git`, `Git Bash`, and `bun >= 1.3.11`
- Install or upgrade Bun with the official PowerShell installer when needed
- Clone or update the repository in the user's home directory
- Run `bun install` and `bun run build:dev:full`
- Create a `free-code.cmd` launcher in a user-owned bin directory
- Add the launcher directory to the user's PATH

## Why This Approach

This keeps the current Unix workflow stable, avoids editing the locally modified `install.sh`, and fits the runtime's existing Windows expectations that route shell execution through Git Bash.

## User Experience

Users get a single PowerShell command for installation and a persistent `free-code` command after setup. The installer remains user-level and avoids symlink/admin requirements by using a `.cmd` launcher instead of a symlink.

## Known Limits

Native Windows still does not provide full parity with WSL2. The documentation should call out that sandboxing, tmux-backed swarms, and some integration paths remain WSL-only.
