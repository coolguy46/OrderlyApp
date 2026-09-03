-- Enforce account ownership for UUID relationships that previously relied on
-- single-column foreign keys. RLS on a child row is not sufficient: without
-- this migration a child owned by user A can reference user B's subject/task/
-- exam UUID. Apply after the timer table exists and before deploying code that
-- writes these relationships. Safe to run repeatedly after preflight succeeds.

BEGIN;

-- Never repair cross-account references by guessing. Back up and resolve any
-- row reported by these equivalent preflight joins before rerunning.
DO $preflight$
DECLARE
  invalid_relationship_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.tasks child
    JOIN public.subjects parent ON parent.id = child.subject_id
    WHERE parent.user_id <> child.user_id
    UNION ALL
    SELECT 1 FROM public.exams child
    JOIN public.subjects parent ON parent.id = child.subject_id
    WHERE parent.user_id <> child.user_id
    UNION ALL
    SELECT 1 FROM public.study_sessions child
    JOIN public.subjects parent ON parent.id = child.subject_id
    WHERE parent.user_id <> child.user_id
    UNION ALL
    SELECT 1 FROM public.study_sessions child
    JOIN public.tasks parent ON parent.id = child.task_id
    WHERE parent.user_id <> child.user_id
  ) INTO invalid_relationship_exists;

  IF invalid_relationship_exists THEN
    RAISE EXCEPTION
      'Relationship ownership preflight failed for a core subject/task reference; back up and repair the reported rows first';
  END IF;

  IF to_regclass('public.timer_states') IS NOT NULL THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM public.timer_states child
        JOIN public.subjects parent ON parent.id = child.subject_id
        WHERE parent.user_id <> child.user_id
      )
    $query$ INTO invalid_relationship_exists;

    IF invalid_relationship_exists THEN
      RAISE EXCEPTION
        'Relationship ownership preflight failed for timer_states.subject_id';
    END IF;
  END IF;

  IF to_regclass('public.planner_blocks') IS NOT NULL THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM public.planner_blocks child
        JOIN public.subjects parent ON parent.id = child.subject_id
        WHERE parent.user_id <> child.user_id
        UNION ALL
        SELECT 1 FROM public.planner_blocks child
        JOIN public.tasks parent ON parent.id = child.task_id
        WHERE parent.user_id <> child.user_id
        UNION ALL
        SELECT 1 FROM public.planner_blocks child
        JOIN public.exams parent ON parent.id = child.exam_id
        WHERE parent.user_id <> child.user_id
      )
    $query$ INTO invalid_relationship_exists;

    IF invalid_relationship_exists THEN
      RAISE EXCEPTION
        'Relationship ownership preflight failed for planner_blocks';
    END IF;
  END IF;

  IF to_regclass('public.planner_feedback') IS NOT NULL THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM public.planner_feedback child
        JOIN public.subjects parent ON parent.id = child.subject_id
        WHERE parent.user_id <> child.user_id
        UNION ALL
        SELECT 1 FROM public.planner_feedback child
        JOIN public.tasks parent ON parent.id = child.task_id
        WHERE parent.user_id <> child.user_id
        UNION ALL
        SELECT 1 FROM public.planner_feedback child
        JOIN public.exams parent ON parent.id = child.exam_id
        WHERE parent.user_id <> child.user_id
      )
    $query$ INTO invalid_relationship_exists;

    IF invalid_relationship_exists THEN
      RAISE EXCEPTION
        'Relationship ownership preflight failed for planner_feedback';
    END IF;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enforce_owned_subject_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.subject_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.subjects parent
       WHERE parent.id = NEW.subject_id
         AND parent.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'subject_id must belong to the row owner'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_owned_task_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.task_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.tasks parent
       WHERE parent.id = NEW.task_id
         AND parent.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'task_id must belong to the row owner'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_owned_exam_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.exam_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.exams parent
       WHERE parent.id = NEW.exam_id
         AND parent.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'exam_id must belong to the row owner'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_owned_subject_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_owned_task_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_owned_exam_reference() FROM PUBLIC;

DROP TRIGGER IF EXISTS tasks_enforce_owned_subject ON public.tasks;
CREATE TRIGGER tasks_enforce_owned_subject
  BEFORE INSERT OR UPDATE OF user_id, subject_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subject_reference();

DROP TRIGGER IF EXISTS exams_enforce_owned_subject ON public.exams;
CREATE TRIGGER exams_enforce_owned_subject
  BEFORE INSERT OR UPDATE OF user_id, subject_id ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subject_reference();

DROP TRIGGER IF EXISTS study_sessions_enforce_owned_subject ON public.study_sessions;
CREATE TRIGGER study_sessions_enforce_owned_subject
  BEFORE INSERT OR UPDATE OF user_id, subject_id ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subject_reference();

DROP TRIGGER IF EXISTS study_sessions_enforce_owned_task ON public.study_sessions;
CREATE TRIGGER study_sessions_enforce_owned_task
  BEFORE INSERT OR UPDATE OF user_id, task_id ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_task_reference();

DO $optional_triggers$
BEGIN
  IF to_regclass('public.timer_states') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS timer_states_enforce_owned_subject ON public.timer_states';
    EXECUTE 'CREATE TRIGGER timer_states_enforce_owned_subject
      BEFORE INSERT OR UPDATE OF user_id, subject_id ON public.timer_states
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subject_reference()';
  END IF;

  IF to_regclass('public.planner_blocks') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS planner_blocks_enforce_owned_subject ON public.planner_blocks';
    EXECUTE 'CREATE TRIGGER planner_blocks_enforce_owned_subject
      BEFORE INSERT OR UPDATE OF user_id, subject_id ON public.planner_blocks
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subject_reference()';
    EXECUTE 'DROP TRIGGER IF EXISTS planner_blocks_enforce_owned_task ON public.planner_blocks';
    EXECUTE 'CREATE TRIGGER planner_blocks_enforce_owned_task
      BEFORE INSERT OR UPDATE OF user_id, task_id ON public.planner_blocks
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_task_reference()';
    EXECUTE 'DROP TRIGGER IF EXISTS planner_blocks_enforce_owned_exam ON public.planner_blocks';
    EXECUTE 'CREATE TRIGGER planner_blocks_enforce_owned_exam
      BEFORE INSERT OR UPDATE OF user_id, exam_id ON public.planner_blocks
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_exam_reference()';
  END IF;

  IF to_regclass('public.planner_feedback') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS planner_feedback_enforce_owned_subject ON public.planner_feedback';
    EXECUTE 'CREATE TRIGGER planner_feedback_enforce_owned_subject
      BEFORE INSERT OR UPDATE OF user_id, subject_id ON public.planner_feedback
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_subject_reference()';
    EXECUTE 'DROP TRIGGER IF EXISTS planner_feedback_enforce_owned_task ON public.planner_feedback';
    EXECUTE 'CREATE TRIGGER planner_feedback_enforce_owned_task
      BEFORE INSERT OR UPDATE OF user_id, task_id ON public.planner_feedback
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_task_reference()';
    EXECUTE 'DROP TRIGGER IF EXISTS planner_feedback_enforce_owned_exam ON public.planner_feedback';
    EXECUTE 'CREATE TRIGGER planner_feedback_enforce_owned_exam
      BEFORE INSERT OR UPDATE OF user_id, exam_id ON public.planner_feedback
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_exam_reference()';
  END IF;
END;
$optional_triggers$;

COMMIT;
