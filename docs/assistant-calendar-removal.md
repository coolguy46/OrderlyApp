# Natural calendar removal

The reported mixed request failed because the model requested a task deletion and the compiler rejected the entire bundle. The user had to learn the word “unschedule.”

- Added a first-class `remove` action. It clears task schedule times while preserving the task, deadline and completion data, and removes events. Mixed removals use the existing atomic transaction and Undo receipt.
- `unschedule` also works for events. Users do not need to know the internal item type or command vocabulary.
- Repeating tasks can lose one occurrence's scheduled time or all their scheduled times, including moved overrides. Their recurrence dates and task records remain. Repeating events can be removed for one occurrence or the whole series.
- Unspecified recurrence scope remains a short clarification. A removal carrying weekday-rule edits is repaired as a repeat-rule update instead of deleting the series.
- Validation feedback repairs a mistaken task-delete representation for a calendar-removal request, without demanding the user rephrase. Explicitly erasing a task from the Tasks list remains a separate Tasks-page action; the assistant must not claim to delete a task record when only its time was cleared.

Tests use synthetic PostgreSQL/PGlite records to verify mixed removal, reloaded data, retry deduplication, Undo, moved occurrences, whole-series time removal, imported/completed task preservation, and scope/ownership checks. No real assignments or paid AI calls are used. No database migration, model or billing changes are needed. Deployment is separate from this local change.
