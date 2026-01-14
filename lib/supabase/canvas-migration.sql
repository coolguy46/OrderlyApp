-- Canvas Integration Migration
-- Run this in Supabase SQL Editor to add Canvas support to your existing database

-- Add Canvas integration fields to tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'google_classroom', 'canvas')),
ADD COLUMN IF NOT EXISTS external_id TEXT,
ADD COLUMN IF NOT EXISTS external_url TEXT,
ADD COLUMN IF NOT EXISTS course_name TEXT,
ADD COLUMN IF NOT EXISTS assignment_type TEXT CHECK (assignment_type IN ('assignment', 'exam', 'quiz', 'discussion', 'project', 'other'));

-- Add unique constraint for external assignments
ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_user_id_source_external_id_key;

ALTER TABLE tasks
ADD CONSTRAINT tasks_user_id_source_external_id_key UNIQUE(user_id, source, external_id);

-- Create Canvas settings table
CREATE TABLE IF NOT EXISTS canvas_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  ical_url TEXT NOT NULL,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  sync_enabled BOOLEAN DEFAULT true,
  auto_import_assignments BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for canvas_settings
ALTER TABLE canvas_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for canvas_settings
CREATE POLICY "Users can manage their own Canvas settings" ON canvas_settings
  FOR ALL USING (auth.uid() = user_id);

-- Add updated_at trigger for canvas_settings
CREATE TRIGGER update_canvas_settings_updated_at BEFORE UPDATE ON canvas_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create index for external_id lookups
CREATE INDEX IF NOT EXISTS idx_tasks_external_id ON tasks(external_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
CREATE INDEX IF NOT EXISTS idx_canvas_settings_user_id ON canvas_settings(user_id);

COMMENT ON TABLE canvas_settings IS 'Stores Canvas LMS integration settings for users';
COMMENT ON COLUMN tasks.source IS 'Source of the task: manual, google_classroom, or canvas';
COMMENT ON COLUMN tasks.external_id IS 'ID from external system (Canvas UID, Google Classroom ID)';
COMMENT ON COLUMN tasks.external_url IS 'Link to assignment in Canvas/Google Classroom';
COMMENT ON COLUMN tasks.course_name IS 'Name of the course/class';
COMMENT ON COLUMN tasks.assignment_type IS 'Type of assignment: assignment, exam, quiz, discussion, project, other';
