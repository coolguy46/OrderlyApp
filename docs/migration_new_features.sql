-- ============================================================
--  Orderly App – New Features Migration
--  Run this in Supabase SQL Editor (Dashboard > SQL Editor)
--  All tables use RLS tied to auth.uid()
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. RESUME ITEMS  (Goals > Resume tab)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resume_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN ('skills','experience','projects','certifications','education')),
  title         text NOT NULL,
  subtitle      text,
  description   text,
  date_label    text,          -- free-text date like "2024", "Jan 2025"
  level         text CHECK (level IN ('beginner','intermediate','advanced','expert')),
  completed     boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.resume_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own resume items"
  ON public.resume_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_resume_items_user ON public.resume_items(user_id);

-- ────────────────────────────────────────────────────────────
-- 2. COLLEGE COURSES  (Goals > College Prep > GPA Calculator)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.college_courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          text NOT NULL,
  grade         text NOT NULL,   -- A+, A, A-, B+, B …
  credits       numeric(4,2) NOT NULL DEFAULT 1,
  weighted      boolean NOT NULL DEFAULT false,  -- AP/IB/Honors
  semester      text NOT NULL DEFAULT '',        -- e.g. "Fall 2025"
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.college_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own courses"
  ON public.college_courses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_college_courses_user ON public.college_courses(user_id);

-- ────────────────────────────────────────────────────────────
-- 3. EXTRACURRICULARS  (Goals > College Prep > Extracurriculars)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.extracurriculars (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name              text NOT NULL,
  role              text NOT NULL DEFAULT '',
  category          text NOT NULL CHECK (category IN ('sports','arts','academic','volunteer','work','leadership','other')),
  years_involved    int NOT NULL DEFAULT 1,
  hours_per_week    numeric(5,1) NOT NULL DEFAULT 0,
  weeks_per_year    int NOT NULL DEFAULT 36,
  description       text NOT NULL DEFAULT '',
  achievements      text,
  highlighted       boolean NOT NULL DEFAULT false,
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.extracurriculars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own extracurriculars"
  ON public.extracurriculars FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_extracurriculars_user ON public.extracurriculars(user_id);

-- ────────────────────────────────────────────────────────────
-- 4. COLLEGE APPLICATIONS  (Goals > College Prep > College List)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.college_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name            text NOT NULL,
  app_type        text NOT NULL CHECK (app_type IN ('reach','match','safety')),
  deadline        date,
  deadline_type   text NOT NULL DEFAULT 'RD' CHECK (deadline_type IN ('ED','EA','RD','Rolling')),
  status          text NOT NULL DEFAULT 'researching'
                    CHECK (status IN ('researching','applying','applied','accepted','rejected','waitlisted','deferred')),
  notes           text,
  scholarships    boolean NOT NULL DEFAULT false,
  essays_done     int NOT NULL DEFAULT 0,
  essays_total    int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.college_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own applications"
  ON public.college_applications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_college_applications_user ON public.college_applications(user_id);

-- ────────────────────────────────────────────────────────────
-- 5. TEST SCORES  (Goals > College Prep > Test Scores)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.test_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_name   text NOT NULL,  -- SAT, ACT, AP, IB, TOEFL, Other …
  score       numeric(8,2) NOT NULL,
  max_score   numeric(8,2) NOT NULL DEFAULT 100,
  date_taken  date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.test_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own test scores"
  ON public.test_scores FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_test_scores_user ON public.test_scores(user_id);

-- ────────────────────────────────────────────────────────────
-- 6. RECOMMENDATIONS  (Goals > College Prep > Recommendations)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recommender_name    text NOT NULL,
  recommender_role    text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'not_asked'
                        CHECK (status IN ('not_asked','asked','confirmed','submitted')),
  deadline            date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own recommendations"
  ON public.recommendations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_recommendations_user ON public.recommendations(user_id);

-- ────────────────────────────────────────────────────────────
-- 7. STUDY SETS  (Exams > Exam Prep)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.study_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exam_id       uuid REFERENCES public.exams(id) ON DELETE SET NULL,
  name          text NOT NULL,
  -- linked task IDs stored as a jsonb array of task UUIDs
  linked_task_ids jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.study_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own study sets"
  ON public.study_sets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_study_sets_user ON public.study_sets(user_id);
CREATE INDEX idx_study_sets_exam  ON public.study_sets(exam_id);

-- ────────────────────────────────────────────────────────────
-- 8. FLASHCARDS  (child of study_sets)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flashcards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id  uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  front         text NOT NULL,
  back          text NOT NULL,
  subject       text,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own flashcards"
  ON public.flashcards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_flashcards_set  ON public.flashcards(study_set_id);
CREATE INDEX idx_flashcards_user ON public.flashcards(user_id);

-- ────────────────────────────────────────────────────────────
-- 9. MCQ QUESTIONS  (child of study_sets)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcq_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id  uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question      text NOT NULL,
  options       jsonb NOT NULL DEFAULT '[]',   -- array of 4 option strings
  correct_index int NOT NULL DEFAULT 0,         -- 0-based index into options
  explanation   text,
  subject       text,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcq_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own MCQ questions"
  ON public.mcq_questions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_mcq_set  ON public.mcq_questions(study_set_id);
CREATE INDEX idx_mcq_user ON public.mcq_questions(user_id);

-- ────────────────────────────────────────────────────────────
-- 10. STUDY SET FILES  (metadata only; actual bytes → Storage)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.study_set_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id  uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_name     text NOT NULL,
  storage_path  text NOT NULL,   -- path inside the "study-materials" bucket
  mime_type     text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.study_set_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own study files"
  ON public.study_set_files FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_study_files_set  ON public.study_set_files(study_set_id);
CREATE INDEX idx_study_files_user ON public.study_set_files(user_id);

-- ────────────────────────────────────────────────────────────
-- 11. SAT/ACT SECTION PROGRESS  (Exams > Exam Prep > SAT/ACT)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sat_act_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_type     text NOT NULL CHECK (test_type IN ('SAT','ACT')),
  section_name  text NOT NULL,   -- e.g. "SAT Math", "ACT English"
  progress_pct  int NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  target_score  text,            -- free text since SAT=1600, ACT=36
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, section_name)
);

ALTER TABLE public.sat_act_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own SAT/ACT progress"
  ON public.sat_act_progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sat_act_user ON public.sat_act_progress(user_id);

-- ────────────────────────────────────────────────────────────
-- 12. AUTO-UPDATING updated_at TRIGGERS
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Apply trigger to every table that has updated_at
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'resume_items',
    'extracurriculars',
    'college_applications',
    'recommendations',
    'study_sets'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON public.%I;
       CREATE TRIGGER set_updated_at
         BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 13. SUPABASE STORAGE BUCKET FOR STUDY MATERIALS
--     Run this separately if the bucket doesn't exist yet.
-- ────────────────────────────────────────────────────────────
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('study-materials', 'study-materials', false)
-- ON CONFLICT DO NOTHING;
--
-- CREATE POLICY "Auth users upload own files"
--   ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'study-materials' AND auth.uid()::text = (storage.foldername(name))[1]);
--
-- CREATE POLICY "Auth users read own files"
--   ON storage.objects FOR SELECT
--   USING (bucket_id = 'study-materials' AND auth.uid()::text = (storage.foldername(name))[1]);
--
-- CREATE POLICY "Auth users delete own files"
--   ON storage.objects FOR DELETE
--   USING (bucket_id = 'study-materials' AND auth.uid()::text = (storage.foldername(name))[1]);
