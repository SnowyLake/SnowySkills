# SnowyAgentSkills

Language: English | [中文](README.zh-CN.md)

## Table of Contents

- [Overview](#overview)
- [Available Skills](#available-skills)
  - [checkpoint](#checkpoint)
  - [cursor-cli](#cursor-cli)
  - [grok-cli](#grok-cli)
  - [hybrid-work](#hybrid-work)
  - [unity-shader-analysis](#unity-shader-analysis)
  - [snapdragon-profiler-statistics](#snapdragon-profiler-statistics)
- [Add Skills](#add-skills)
- [Repository Layout](#repository-layout)

## Overview

SnowyAgentSkills is a collection repository for reusable agent skills.

Each skill lives under `<skill-name>/` at the repository root as a self-contained folder. The repository is intended to stay agent-neutral so different agent runtimes can adopt the skill content that fits their own loading model.

## Available Skills

### [checkpoint](checkpoint-save/README.md)

- Description: Checkpoint skill family for saving, restoring, handing off, listing status, and reviewing session context in long-running, multi-session, handoff-based, or review-driven agent work.

- Skills: `checkpoint-save`, `checkpoint-restore`, `checkpoint-handoff`, `checkpoint-status`, `checkpoint-review`.

- Agent scope: All agents.

### [cursor-cli](cursor-cli/SKILL.md)

Use Cursor's agent CLI for non-interactive coding tasks, structured output, and session continuation.

### [grok-cli](grok-cli/SKILL.md)

Use the Grok Build CLI (`grok`) for non-interactive coding tasks, structured output, and session continuation.

### [hybrid-work](hybrid-work/SKILL.md)

- Description: Keep decisions and acceptance with the primary agent while dynamically delegating bounded implementation, debugging, and validation to GPT-6 Sol with `xhigh` reasoning, without a persistent worker configuration.
- Requirements: Codex only, with `spawn_agent`, explicit model selection, and `fork_turns: "none"`. Invoke `$hybrid-work` once to enable it for the conversation until you explicitly pause it; later tasks need no repeat invocation. The primary agent handles the work if the required capability is unavailable.

### [unity-shader-analysis](unity-shader-analysis/SKILL.md)

- Description: Analyze controlled Unity shader variants with Mali Offline Compiler and export Excel reports with source-backed optimization recommendations.
- Requirements: PowerShell, Unity Editor with uloop, MaliOC; Node.js with `@oai/artifact-tool` and `jszip` for reports. Explicit invocation only.

### [snapdragon-profiler-statistics](snapdragon-profiler-statistics/SKILL.md)

- Description: Summarize Unity URP Snapdragon Profiler CSV exports into per-scene Excel sheets with Pass Clocks and main-camera ALU/EFU statistics.
- Requirements: Node.js with `@oai/artifact-tool` and CSV exports containing the supported camera markers.

## Add Skills

Add new skills under:

```text
<skill-name>/
```

Each skill folder must include:

- `SKILL.md`: Required skill metadata and instructions.

Optional resources can be added only when the skill needs them:

- `README.md`
- `README.zh-CN.md`
- `agents/`
- `scripts/`
- `references/`
- `assets/`

Use `agents/` for optional runtime-specific metadata, such as `agents/openai.yaml`.

Keep each skill self-contained and avoid placing skill-specific documentation in the repository root.

## Repository Layout

```text
SnowyAgentSkills/
|-- checkpoint-save/
|   |-- README.md
|   |-- README.zh-CN.md
|   |-- SKILL.md
|   |-- agents/
|   `-- references/
|-- checkpoint-restore/
|-- checkpoint-handoff/
|-- checkpoint-status/
|-- checkpoint-review/
|-- cursor-cli/
|-- grok-cli/
|-- hybrid-work/
|-- unity-shader-analysis/
|-- snapdragon-profiler-statistics/
|-- README.md
|-- README.zh-CN.md
|-- LICENSE
`-- .gitignore
```
