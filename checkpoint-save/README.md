# checkpoint

## Table of Contents

- [Overview](#overview)
- [Skills](#skills)
- [Shared References](#shared-references)
- [Terminology](#terminology)
  - [Session Folder](#session-folder)
  - [Checkpoint Files](#checkpoint-files)
  - [Review File](#review-file)
- [Usage Examples](#usage-examples)
- [Capabilities](#capabilities)
  - [checkpoint-save](#checkpoint-save)
  - [checkpoint-restore](#checkpoint-restore)
  - [checkpoint-handoff](#checkpoint-handoff)
  - [checkpoint-status](#checkpoint-status)
  - [checkpoint-review](#checkpoint-review)
- [Reference Workflows](#reference-workflows)
  - [Single Session](#single-session)
  - [Shared Session Collaboration](#shared-session-collaboration)
  - [Review Feedback Loop](#review-feedback-loop)
  - [Handoff or Branching](#handoff-or-branching)
  - [Restore Conflict Guard](#restore-conflict-guard)
- [Workflow Boundaries](#workflow-boundaries)

Language: English | [中文](README.zh-CN.md)

## Overview

`checkpoint` is a skill family for long-running, multi-session, handoff-based, or review-driven agent work.

The family is organized around session folders and Markdown checkpoint files. A session folder is the context identity, while agents or conversations are interchangeable collaborators that read from or write to that context according to the skill they run.

Each capability is a standalone skill.

## Skills

This family provides five skills:

- `checkpoint-save`: Create or refresh the current session checkpoint.
- `checkpoint-restore`: Restore context from the current checkpoint or a specified session folder in read-only mode.
- `checkpoint-handoff`: Rebuild context from another session folder, then save it into the current target session folder.
- `checkpoint-status`: List the current goal, state, risks, open questions, TODO, next actions, and open review findings.
- `checkpoint-review`: Review the actual work referenced by checkpoint files, then write the result to `REVIEW.md`.

## Shared References

`checkpoint-save` is the root skill. It owns the shared references, relative to this directory:

- `references/file-contracts.md`
- `references/common-rules.md`
- `references/status-summary.md`

Other `checkpoint-*` skills depend on `checkpoint-save`. If these shared references are unavailable, the dependent skill stops and asks the user to install `checkpoint-save` first. It must not rebuild the contracts from memory.

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
- `HISTORY.md`: Stores historical summaries, troubleshooting records, rejected or deferred approaches, assumptions, notes, and handoff audit entries.

`CONTEXT.md` is the primary restore entry point. `HISTORY.md` is read only when historical background is needed.

### Review File

`REVIEW.md` stores the latest review result for a session folder. It is created by `checkpoint-review` and may be read by `checkpoint-restore` as a navigation hint.

`REVIEW.md` is not a checkpoint file. Its findings have stable IDs, statuses, and severities. `Open` findings must be re-verified against current project files before follow-up work.

## Usage Examples

Use the standalone skill that matches the requested capability:

```text
Use checkpoint-save to save the current session checkpoint.
Use checkpoint-restore to restore context from .agent-sessions/20260605-example-session.
Use checkpoint-handoff to take over context from .agent-sessions/20260605-example-session into the current session.
Use checkpoint-status to list current checkpoint status.
Use checkpoint-review to review .agent-sessions/20260605-example-session.
```

## Capabilities

### checkpoint-save

`checkpoint-save` creates or refreshes the current session checkpoint.

Permissions:

- May read existing checkpoint files and related project files.
- May write only `CONTEXT.md` and `HISTORY.md` in the current session folder.
- Must not modify project files or other session artifacts.

Behavior:

- Resolves the current session folder.
- Reads existing `CONTEXT.md` and `HISTORY.md` when present.
- Prioritizes current project files over conflicting checkpoint content.
- Rewrites `CONTEXT.md` as a clean current-state snapshot, moving stale, rejected, or no longer useful content out of `CONTEXT.md`.
- Appends one new `HISTORY.md` entry instead of merging new history into old entries.
- Outputs the current session folder status summary after successful completion.

### checkpoint-restore

`checkpoint-restore` rebuilds session context from the current session checkpoint or checkpoint files in an explicitly specified session folder.

Permissions:

- Read-only by default.
- May read checkpoint files, `REVIEW.md`, and related project files.
- Must not copy checkpoint files, write session folders, modify project files, or execute TODO items unless the user explicitly asks for follow-up work.

Behavior:

- Uses the current session folder when no path is provided.
- Uses the specified folder as the restore source when a path is provided.
- Treats plain "rebuild context from this checkpoint or session folder" requests as restore unless the user also asks to save, migrate, branch, take over, or write into a target session folder.
- Stops if the current session already has checkpoint files and the user specifies a different session folder.
- Reads `CONTEXT.md` first when available.
- Reads `HISTORY.md` only when historical background is needed.
- Skips `Resolved` and `Won't Fix` findings in `REVIEW.md`, verifies `Open` findings within their referenced scope, and surfaces findings that still match current project facts.
- Reports missing or partial checkpoint files instead of guessing.
- Prioritizes current project files over conflicting checkpoint content.
- After successful completion, outputs restore source, files read, information source, and confidence notes first, then outputs the restore source status summary.
- When `REVIEW.md` exists, outputs each `Open` finding verification result as a child item under `Open Review Findings`. Each verification result must include a category and an explanation, using only `Still Applies`, `Needs Review`, or `No Longer Applies` as the category.

### checkpoint-handoff

`checkpoint-handoff` rebuilds session context from another session checkpoint, then saves the rebuilt checkpoint into the current target session folder.

Permissions:

- Source session folder is read-only.
- Target session folder is readable and writable.
- May copy only still-relevant non-checkpoint artifacts located inside the source session folder.
- Must not copy files from outside the source session folder.

Behavior:

- Requires the source session folder to contain `CONTEXT.md`.
- Stops when source validation fails.
- Stops when the target session folder already contains `CONTEXT.md` or `HISTORY.md`, without reading, merging, copying, or modifying either checkpoint.
- Requires an explicit save, migrate, branch, take-over, or target-write intent. The word `rebuild` alone is not enough to select `checkpoint-handoff`.
- Does not create missing source checkpoint files.
- Does not search other folders unless the user explicitly asks for discovery.
- Classifies source-folder non-checkpoint artifacts before copying.
- Does not copy the source `REVIEW.md` as the target `REVIEW.md`. If the user explicitly asks to preserve it, keeps it only as a renamed historical review artifact without rewriting `Reviewed Session`.
- Writes a concise provenance note in target `CONTEXT.md`.
- Appends a handoff audit entry to target `HISTORY.md`.
- After successful completion, outputs source session folder, target session folder, updated files, copied artifacts, discarded artifacts, and reference rewrites first, then outputs the target session folder status summary.

### checkpoint-status

`checkpoint-status` read-only lists the current state and pending items from a checkpoint.

Permissions:

- Reads the current session folder by default.
- Reads the specified session folder when a path is provided.
- May read `CONTEXT.md` and optional `REVIEW.md`.
- Does not read `HISTORY.md` unless the user explicitly asks for historical background.
- Must not write checkpoint files, write `REVIEW.md`, modify project files, or execute TODO items.

Behavior:

- Outputs `Current Goal`, `Current State`, `Known Risks`, `Open Questions`, `TODO`, `Next Actions`, and `Open Review Findings`.
- Preserves the original `CONTEXT.md` content for every section except `Open Review Findings`.
- Lists all `Open` findings under `Open Review Findings` by default, using `[Open][High] F-003: Short finding title`.
- Does not expand finding impact, evidence, or recommended fix.
- Does not verify whether findings still match current project facts.
- After successful `checkpoint-save`, `checkpoint-restore`, and `checkpoint-handoff`, the agent also outputs the same status summary. `checkpoint-restore` and `checkpoint-handoff` output their skill-specific details first, then output the status summary.

### checkpoint-review

`checkpoint-review` objectively reviews the actual work referenced by checkpoint files in the current session folder or a specified session folder, then writes the result to `REVIEW.md` in that folder, without restoring or continuing implementation.

Permissions:

- Uses the current session folder when no path is provided.
- Uses the specified reviewed session folder when a path is provided.
- May read checkpoint files, reviewed-session-folder artifacts, and related project files.
- May write only `REVIEW.md` in the reviewed session folder.
- Must not modify reviewed checkpoint files, project files, other artifacts, or execute TODO items.

Behavior:

- Requires `CONTEXT.md` in the reviewed session folder.
- Treats `HISTORY.md` in the reviewed session folder as optional historical background.
- Uses `CONTEXT.md`, `HISTORY.md`, and `Work Artifacts` as the review brief and navigation index.
- Reviews the actual referenced work, such as modified project files, generated artifacts, tests, configuration, or documentation.
- First checks whether the session completed `Current Goal`.
- Then checks for defects, logic gaps, edge cases, missing validation, conflicts, or inconsistencies.
- Uses stable `F-001`-style IDs for findings, and includes status, severity, impact, evidence, and recommended fix for each finding.
- When an existing `REVIEW.md` is present, re-verifies old `Open` findings. Findings that still apply remain `Open`, findings that no longer apply are marked `Resolved` and kept for one review cycle, and explicitly declined fixes are marked `Won't Fix`.
- Places checkpoint-only quality issues under `Checkpoint Quality`, not `Findings`, unless they directly prevent assessing the actual work or hide the work scope.
- Writes `REVIEW.md` in the reviewed session folder, overwriting any previous `REVIEW.md` without automatically archiving old reviews, and also returns the review in the response.

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

### Review Feedback Loop

A reviewer can run `checkpoint-review` against the shared session folder, writing the result to that folder's `REVIEW.md`. The implementer then runs `checkpoint-restore` on the same folder, consumes the review findings, fixes or continues the work, and runs `checkpoint-save` again. Repeat this loop until review passes. The reviewer may run a final `checkpoint-restore` to rebuild the completed shared context and close the loop.

```text
[Agent A plan]
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
[Agent B implement]
          |
          v
[Agent B checkpoint-save]
          |
          v
[Agent A checkpoint-review actual work]
          |
          v
[write REVIEW.md]
          |
          v
[Agent B checkpoint-restore review findings]
          |
          v
[Agent B fix and checkpoint-save]
          |
          v
[repeat until review passes]
          |
          v
[Agent A final checkpoint-restore]
```

### Handoff or Branching

One session folder is used as the read-only source session folder, while the current session folder becomes the writable target session folder. Use this when context should migrate or branch into a different session folder.

```text
[Source session folder]
  CONTEXT.md
  HISTORY.md
  artifacts
      |
      v
[checkpoint-handoff rebuilds context]
      |
      v
[Target session folder]
  CONTEXT.md
  HISTORY.md
  copied artifacts
```

### Restore Conflict Guard

If the current conversation already has checkpoint files and the user tries to run `checkpoint-restore` on a different session folder, `checkpoint-restore` stops instead of mixing two context lines. Use `checkpoint-handoff` for migration or use the same shared session folder for collaboration.

`checkpoint-handoff` also protects existing checkpoint files in the target session folder. If the target session folder already contains `CONTEXT.md` or `HISTORY.md`, `checkpoint-handoff` stops and the user should choose a new empty target session folder.

```text
[Current session already has checkpoint]
      |
      v
[checkpoint-restore another session folder]
      |
      v
[stop]
      |
      +-- migrate or branch: use checkpoint-handoff
      |
      +-- collaborate: share the same session folder
```

Future changes to this skill family should preserve these workflow boundaries unless the workflow model is intentionally revised.

## Workflow Boundaries

- Use `checkpoint-save` when the current session state should be persisted.
- Use `checkpoint-restore` when context should be rebuilt without writing files.
- Use `checkpoint-handoff` when context should be migrated, branched, or taken over into another session folder.
- Use `checkpoint-status` when only current state and pending work should be listed.
- Use `checkpoint-review` when actual work referenced by checkpoint files should be reviewed.
