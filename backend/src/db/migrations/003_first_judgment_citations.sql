-- Source references form part of an immutable judgment version. Future revisions
-- append a new version and its citations instead of editing prior evidence.
CREATE TRIGGER judgment_citations_no_update BEFORE UPDATE ON judgment_citations
BEGIN SELECT RAISE(ABORT, 'judgment citations are append-only'); END;
CREATE TRIGGER judgment_citations_no_delete BEFORE DELETE ON judgment_citations
BEGIN SELECT RAISE(ABORT, 'judgment citations are append-only'); END;

-- A valid feedback ID from another task must never count as local evidence.
CREATE TRIGGER judgment_citations_same_task BEFORE INSERT ON judgment_citations
WHEN (SELECT task_id FROM judgment_versions WHERE id = NEW.judgment_version_id) !=
     (SELECT task_id FROM feedback_items WHERE id = NEW.feedback_id)
BEGIN SELECT RAISE(ABORT, 'citation feedback belongs to another task'); END;
