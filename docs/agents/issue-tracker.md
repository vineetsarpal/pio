# Issue tracker: Linear

Issues and PRDs for this repository live in the Linear `pio` team.

## Conventions

- Use the installed Linear plugin for all issue operations.
- Create issues with `save_issue`, setting `team` to `pio`.
- Leave project, cycle, assignee, priority, and due date unset unless requested.
- Read an issue with `get_issue`, including relations when relevant.
- List or search issues before bulk updates.
- Add discussion with `save_comment`.
- Read existing labels before changing them because `save_issue.labels` replaces the complete label set.
- Use the team's configured states: Backlog, Todo, In Progress, In Review, Done, Canceled, and Duplicate.

## When a skill says “publish to the issue tracker”

Create a Linear issue in the `pio` team.

## When a skill says “fetch the relevant ticket”

Retrieve the referenced Linear issue by identifier.
