---
title: "Filter Tasks by Priority"
tags: ["crud", "query"]
description: "Create tasks with different priorities, then filter the list."
---

# Filter Tasks by Priority

## Goal

Show how to manage multiple tasks and use the filter parameter.

## Steps

1. **Create three tasks** with priorities `high`, `medium`, `low`.
2. **List all tasks** — call `task.list` with no filter.
3. **Filter active** — call `task.list` with `filter: "active"`.
4. **Complete the high-priority task** — call `task.update`.
5. **Filter completed** — call `task.list` with `filter: "completed"`.
6. **Delete a task** — call `task.delete`.

## Expected Result

- After step 5, only the high-priority task appears in the completed list.
- After step 6, the deleted task no longer appears in any list.

## Functions Used

- `task.create`
- `task.list`
- `task.update`
- `task.delete`
