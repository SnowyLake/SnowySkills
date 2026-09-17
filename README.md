# SnowyAgentSkills

Language: English | [中文](README.zh-CN.md)

## Table of Contents

- [Overview](#overview)
- [Available Skills](#available-skills)
  - [checkpoint](#checkpoint)
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
|-- README.md
|-- README.zh-CN.md
|-- LICENSE
`-- .gitignore
```
