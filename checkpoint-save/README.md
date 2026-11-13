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
  - [checkpoint-read](#checkpoint-read)
- [Reference Workflows](#reference-workflows)
  - [Single Session](#single-session)
  - [Shared Session Collaboration](#shared-session-collaboration)
  - [Cross-Session Review](#cross-session-review)
- [Workflow Boundaries](#workflow-boundaries)

Language: English | [中文](README.zh-CN.md)

## Overview

`checkpoint` is a skill family for long-running or multi-session agent work.

The family is organized around session folders and Markdown checkpoint files. Saving records the current session; reading provides background from the current or another session for continuation, review, or questions. Reading a source folder does not make it the current session's save destination.

Each capability is a standalone skill.

## Skills

This family provides two skills:

- `checkpoint-save`: Create or refresh the current session checkpoint.
- `checkpoint-read`: Read the current checkpoint or a specified session folder for continuation, review, or questions without modifying files.

## Shared References

`checkpoint-save` is the root skill. It owns the shared checkpoint contract for file structures and information-source rules, relative to this directory:

- `references/checkpoint-contract.md`

`checkpoint-read` depends on `checkpoint-save`. Save reads the writing contract; read uses shared rules and section meanings as needed. If this shared contract is unavailable, the dependent skill stops and asks the user to install `checkpoint-save` first. It must not rebuild the contract from memory.

## Terminology

### Session Folder

A session folder is the directory that stores one context line:

```text
.agent-sessions/{YYYYMMDD}-{short-kebab-case-session-summary}/
```

Saving distinguishes an identified, absent, or ambiguous current session folder. It reuses an identified folder, creates one when absent, and asks when ambiguous. Reading uses the specified source or defaults to the identified current session folder; if neither is clear, it asks for an existing folder. A path used only as a reading source is not a save destination candidate.

### Checkpoint Files

Checkpoint files record session context:

- `CONTEXT.md`: Stores the current objective, requirements, decisions, work state, next actions, relevant files, and essential context for continuation.
- `HISTORY.md`: Optional history for failure evidence, rejected or deferred approaches, and important decision changes. Ordinary progress updates belong only in `CONTEXT.md`.

`CONTEXT.md` is the primary reading entry point. `HISTORY.md` is consulted for relevant background; saving checks existing relevant entries before deciding what to append. Its absence is normal.

The snapshot follows the seven sections from [OpenCode v2.3.0 session compaction](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/compaction.ts#L173-L254): `Objective`, `Requirements`, `Decisions`, `Work State`, `Next Move`, `Relevant Files`, and `Important Context`. `Work State` groups completed, active, and blocked goals. Inapplicable sections can be omitted, and short checkpoints need no table of contents.

The file workflow adds explicit validation results and coverage, plus working-directory or external-artifact locations needed across sessions. Recoverable code and repository rules are referenced instead of restated. Unresolved requests remain in the snapshot; resolved or stale material is removed. `Relevant Files` lists at most 15 useful entry points, using directories or diff references for larger scopes rather than maintaining a second artifact list. See the [shared contract](references/checkpoint-contract.md) for the template and update rules.

Reading supports older headings and history layouts without rewriting them. A later save with substantive updates organizes that session's snapshot using the current structure; it does not migrate other checkpoints or rewrite existing history.

## Usage Examples

Use the standalone skill that matches the requested capability:

```text
Use checkpoint-save to save the current session checkpoint.
Use checkpoint-read to read .agent-sessions/20260605-example-session.
Use checkpoint-read to read .agent-sessions/20260605-example-session and review the actual changes.
```

## Capabilities

### checkpoint-save

`checkpoint-save` saves the current state and history for later reading, continuation, or review. It writes only `CONTEXT.md` and `HISTORY.md` in the current session folder.

- Reuses the identified session folder, creates one when absent, and asks when the folder is ambiguous.
- Reading another session does not change the save destination. A shared folder becomes the current session folder only when the user explicitly designates it as such.
- Reads the current snapshot and recent relevant history, expanding historical reading only when needed.
- Preserves information that is costly or impossible to recover from project files: user decisions and scope, reasons, unfinished work, validation coverage, and unresolved assumptions.
- Maintains a concise snapshot, reconciles work state with next actions, and removes resolved or stale content while preserving outstanding requests. Validation records include their scope and any relevant gaps; saving does not itself require rerunning tests.
- Creates `CONTEXT.md` on the first save. Creates or appends `HISTORY.md` only for new background worth tracing, without repeating routine progress or automatically archiving everything removed from the snapshot.
- Preserves existing history, including unread entries. If nothing substantive changed, leaves the files unchanged, including older snapshots. Missing optional history is normal; a missing snapshot or known information loss is reported, and only confirmed information is reconstructed.
- Uses current user instructions for goals and authorization, current files and checks for implementation facts, and checkpoints for prior state and decision context.
- Confirms the required writes and structure, then briefly reports the session path, updated files, key changes, and unresolved matters. Reports partial writes honestly. Does not repeat the snapshot unless requested.

### checkpoint-read

`checkpoint-read` reads the goals, state, decisions, constraints, and work artifacts of the current or a specified session. The reading phase does not copy checkpoints, create session folders, or modify files. The current request determines the task; source goals and TODOs are not automatically adopted.

- Uses the current session folder when no path is provided, or the specified folder otherwise. Asks for a path if neither is clear.
- Allows reading another session even when the current session already has a checkpoint. Keeps the source folder separate from the current session folder and leaves the save destination unchanged.
- Reads `CONTEXT.md` first, uses `Relevant Files` to locate related work, and consults relevant history only when needed. Older headings and `Work Artifacts` remain readable; the new template is not a prerequisite for reading.
- Checks only project facts that affect the current request. Distinguishes recorded context, verified current facts, and inference instead of re-investigating the entire project just to read a checkpoint.
- Reads `CONTEXT.md` alone when available. If only `HISTORY.md` exists, reconstructs background and reports the missing current snapshot without treating old history as current state. If neither exists, reports that no checkpoint is available.
- Uses the shared information-source rules to handle conflicts. Reports material gaps or uncertainty without modifying the source files.
- Briefly reports the source, its goal and progress, and constraints or blockers relevant to the current request. Expands the status only when requested; explains uncertainty only when relevant.
- Ends after a standalone read request. When the user also requests review, continuation, or answers, proceeds with that authorized work without asking again. Checkpoint TODOs alone do not authorize execution; work that depends on incomplete reading or missing critical information does not start.
- For review, checks actual files, changes, and necessary validation. File indexes only help locate the work; checkpoint completion claims and validation reports do not replace independent review.

## Reference Workflows

### Single Session

One session runs `checkpoint-save` before context compaction, writing still-valid information into the checkpoint. After `/compact`, it runs `checkpoint-read` to rebuild session context from the checkpoint and continues when requested.

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
[checkpoint-read rebuilds session context]
      |
      v
[continue authorized work]
      |
      v
[checkpoint-save refreshes checkpoint]
```

### Shared Session Collaboration

When the user explicitly designates the same folder as each collaborator's current session folder, multiple agents or conversations can share one context line. Each collaborator reads that folder, continues the authorized work, then saves the new state there. Reading alone does not establish this shared save destination.

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
[Agent B checkpoint-read]
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
[Agent A checkpoint-read]
```

### Cross-Session Review

Session B may read session A's checkpoint even when B already has its own checkpoint. If the user requests a review, B uses A's record to locate the work and checks the actual changes. A's TODOs do not become B's task, and a later save still records B in B's own folder.

```text
[Session B already has its own checkpoint]
      |
      v
[checkpoint-read session A for requested review]
      |
      v
[review actual files and changes]
      |
      v
[checkpoint-save session B when requested]
```

Future changes to this skill family should preserve these workflow boundaries unless the workflow model is intentionally revised.

## Workflow Boundaries

- Use `checkpoint-save` when the current session state should be persisted.
- Use `checkpoint-read` to understand recorded work without writing files; the current request determines any subsequent review, continuation, or answers.
