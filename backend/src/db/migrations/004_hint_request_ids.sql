-- A retry with the same client request ID returns the saved hint instead of
-- creating another append-only event. Concurrent calls can still both reach
-- the model, but only one validated hint is committed.
ALTER TABLE hint_events ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX hint_events_request_idx
ON hint_events(task_id, requester_id, request_id)
WHERE request_id IS NOT NULL;
