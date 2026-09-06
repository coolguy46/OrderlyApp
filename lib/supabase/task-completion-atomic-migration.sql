-- Complete a task and create the next occurrence of a repeating series in one
-- transaction. Apply before deploying the matching application release.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_task_with_successor(
  p_task_id UUID,
  p_successor JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_task public.tasks%ROWTYPE;
  completed_task public.tasks%ROWTYPE;
  successor_task public.tasks%ROWTYPE;
  successor_subject_id UUID;
BEGIN
  SELECT *
  INTO current_task
  FROM public.tasks
  WHERE id = p_task_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;

  IF current_task.status = 'completed' THEN
    RETURN jsonb_build_object(
      'changed', FALSE,
      'completed', to_jsonb(current_task),
      'successor', NULL
    );
  END IF;

  UPDATE public.tasks
  SET status = 'completed', completed_at = statement_timestamp()
  WHERE id = current_task.id
  RETURNING * INTO completed_task;

  IF p_successor IS NOT NULL THEN
    IF NULLIF(BTRIM(p_successor->>'title'), '') IS NULL THEN
      RAISE EXCEPTION 'A recurring successor requires a title'
        USING ERRCODE = '22023';
    END IF;

    successor_subject_id := CASE
      WHEN NULLIF(p_successor->>'subject_id', '') IS NULL THEN NULL
      ELSE (p_successor->>'subject_id')::UUID
    END;

    IF successor_subject_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.subjects AS subject
         WHERE subject.id = successor_subject_id
           AND subject.user_id = current_task.user_id
       ) THEN
      RAISE EXCEPTION 'Recurring successor subject is not owned by the task owner'
        USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.tasks (
      user_id,
      subject_id,
      title,
      description,
      priority,
      status,
      due_date,
      due_time,
      recurrence,
      recurrence_days,
      completed_at
    ) VALUES (
      current_task.user_id,
      successor_subject_id,
      BTRIM(p_successor->>'title'),
      p_successor->>'description',
      COALESCE(NULLIF(p_successor->>'priority', ''), 'medium'),
      'pending',
      CASE
        WHEN NULLIF(p_successor->>'due_date', '') IS NULL THEN NULL
        ELSE (p_successor->>'due_date')::TIMESTAMP WITH TIME ZONE
      END,
      NULLIF(p_successor->>'due_time', ''),
      COALESCE(NULLIF(p_successor->>'recurrence', ''), 'none'),
      NULLIF(p_successor->'recurrence_days', 'null'::JSONB),
      NULL
    )
    RETURNING * INTO successor_task;
  END IF;

  RETURN jsonb_build_object(
    'changed', TRUE,
    'completed', to_jsonb(completed_task),
    'successor', CASE
      WHEN successor_task.id IS NULL THEN NULL
      ELSE to_jsonb(successor_task)
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_task_with_successor(UUID, JSONB)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_task_with_successor(UUID, JSONB)
TO authenticated;

COMMIT;
