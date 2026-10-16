# checkpoint

## Table of Contents

- [Overview](#overview)
- [Skills](#skills)
- [Shared References](#shared-references)
- [Terminology](#terminology)
  - [Session Folder](#session-folder)
  - [Checkpoint Files](#checkpoint-files)
- [Usage Examples](#usage-examples)
- [Capabilities](#capabilities)
  - [checkpoint-save](#checkpoint-save)
  - [checkpoint-restore](#checkpoint-restore)
- [Reference Workflows](#reference-workflows)
  - [Single Session](#single-session)
  - [Shared Session Collaboration](#shared-session-collaboration)
  - [Restore Conflict Guard](#restore-conflict-guard)
- [Workflow Boundaries](#workflow-boundaries)

Language: English | [中文](README.zh-CN.md)

## Overview

`checkpoint` is a skill family for long-running or multi-session agent work.

The family is organized around session folders and Markdown checkpoint files. A session folder is the context identity, while agents or conversations are interchangeable collaborators that read from or write to that context according to the skill they run.

Each capability is a standalone skill.

## Skills

This family provides two skills:

- `checkpoint-save`: Create or refresh the current session checkpoint.
- `checkpoint-restore`: Restore context from the current checkpoint or a specified session folder in read-only mode.

## Shared References

`checkpoint-save` is the root skill. It owns the shared checkpoint contract for file structures and information-source rules, relative to this directory:

- `references/checkpoint-contract.md`

`checkpoint-restore` depends on `checkpoint-save`. Save reads the writing contract; restore reads shared rules and section meanings as needed. If this shared contract is unavailable, the dependent skill stops and asks the user to install `checkpoint-save` first. It must not rebuild the contract from memory.

## Terminology

### Session Folder

A session folder is the directory that stores one context line:

```text
.agent-sessions/{YYYYMMDD}-{short-kebab-case-session-summary}/
```

When resolving a session folder, the skills distinguish identified, absent, and ambiguous states. They reuse an identified folder, create a new folder when no usable folder signal exists and the request needs to write a checkpoint, and ask the user when the target is ambiguous.

### Checkpoint Files

Checkpoint files rebuild session context:

- `CONTEXT.md`: Stores only current, still-valid information that affects future work, including the current goal, current state, confirmed decisions, active constraints, known risks, open questions, TODO, next actions, relevant files, and work artifacts.
- `HISTORY.md`: Stores historical summaries, troubleshooting records, rejected or deferred approaches, assumptions, and notes.

`CONTEXT.md` is the primary restore entry point. `HISTORY.md` is consulted for relevant background; saving also checks recent relevant entries before deciding what to append.

## Usage Examples

Use the standalone skill that matches the requested capability:

```text
Use checkpoint-save to save the current session checkpoint.
Use checkpoint-restore to restore context from .agent-sessions/20260605-example-session.
```

## Capabilities

### checkpoint-save

`checkpoint-save` saves the current state and history needed to continue later. It writes only `CONTEXT.md` and `HISTORY.md` in the current session folder.

- Reuses the identified session folder, creates one when absent, and asks when the folder is ambiguous.
- Reads the current snapshot and recent relevant history, expanding historical reading only when needed.
- Preserves information that is costly or impossible to recover from project files: user decisions and scope, reasons, unfinished work, validation coverage, and unresolved assumptions.
- Maintains a clean `CONTEXT.md` snapshot and its `Work Artifacts`. Creates both files on the first save; later appends a history entry only for substantive changes or useful new background.
- Preserves existing history, including unread entries. If both files are complete and nothing substantive changed, leaves them unchanged. If a file is missing, fills in confirmed information and reports the gap without inventing lost history.
- Uses current user instructions for goals and authorization, current files and checks for implementation facts, and checkpoints for prior state and decision context.
- Confirms the required writes and structure, then briefly reports the session path, updated files, key changes, and unresolved matters. Reports partial writes honestly. Does not repeat the snapshot unless requested.

### checkpoint-restore

`checkpoint-restore` rebuilds usable context from the current checkpoint or an explicitly specified session folder. The restore phase is read-only: it does not copy checkpoints, create session folders, or modify files.

- Uses the current session folder when no path is provided, or the specified folder otherwise. Asks for a path if neither is clear.
- Stops before reading either checkpoint if the current session already has checkpoint files and the user specifies a different folder.
- Reads `CONTEXT.md` first, uses `Work Artifacts` to locate prior work, and consults relevant history only when needed.
- Checks only project facts that affect the next action. Distinguishes recorded context, verified current facts, and inference instead of re-investigating the entire project.
- Restores from `CONTEXT.md` alone when available. If only `HISTORY.md` exists, reconstructs background and reports the missing current snapshot. If neither exists, reports that no checkpoint is available.
- Uses the shared information-source rules to handle conflicts. Reports material gaps or uncertainty without modifying the source files.
- Briefly reports the source, goal and progress, constraints or blockers, and next action. Expands the status only when requested; explains uncertainty only when relevant.
- Ends after a standalone restore request. When the user explicitly requests restore and continuation together, completes restore and proceeds with the authorized work without asking again. Checkpoint TODOs alone do not authorize execution; work that depends on failed restoration or missing critical information does not start.

## Reference Workflows

### Single Session

One session runs `checkpoint-save` before context compaction, writing still-valid information into the checkpoint. After `/compact`, it runs `checkpoint-restore` to rebuild session context from the checkpoint and avoid losing useful information.

```text
[Session A work]
      |
      v
[checkpoint-save writes checkpoint]
      |
      v
[/compact compresses context]
      |
      v
[checkpoint-restore rebuilds session context]
      |
      v
[continue work]
      |
      v
[checkpoint-save refreshes checkpoint]
```

### Shared Session Collaboration

Multiple agents or conversations use the same session folder as one shared context line. Each collaborator runs `checkpoint-restore` on that folder, continues the work, then runs `checkpoint-save` to write the new state back.

```text
[Agent A work]
        |
        v
[Agent A checkpoint-save]
        |
        v
[Shared session folder]
        |
        v
[Agent B checkpoint-restore]
        |
        v
[Agent B work]
        |
        v
[Agent B checkpoint-save]
        |
        v
[Shared session folder]
        |
        v
[Agent A checkpoint-restore]
```

### Restore Conflict Guard

If the current conversation already has checkpoint files and the user tries to run `checkpoint-restore` on a different session folder, `checkpoint-restore` stops instead of mixing two context lines. Use the same shared session folder for collaboration.

```text
[Current session already has checkpoint]
      |
      v
[checkpoint-restore another session folder]
      |
      v
[stop]
      |
      +-- collaborate: share the same session folder
```

Future changes to this skill family should preserve these workflow boundaries unless the workflow model is intentionally revised.

## Workflow Boundaries

- Use `checkpoint-save` when the current session state should be persisted.
- Use `checkpoint-restore` when context should be rebuilt without writing files.
