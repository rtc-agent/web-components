---
title: "Create and Complete a Task"
tags: ["crud", "basic"]
description: "End-to-end flow: create a task, then mark it complete."
---

# Create and Complete a Task

## Goal

Demonstrate the basic task lifecycle: create → update.

## Steps

1. **Create a task** — call `task.create` with a title and priority.
2. **List tasks** — call `task.list` to verify the new task appears.
3. **Mark complete** — call `task.update` with `completed: true`.
4. **Verify** — call `task.list` with filter `completed` to see it.

## Expected Result

- A new task exists in the list with `completed: true`.
- The task's `priority` and `title` match what was passed to `create`.

## Functions Used

- `task.create`
- `task.list`
- `task.update`
