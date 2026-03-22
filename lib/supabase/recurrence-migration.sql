-- Add recurrence, due_time, and recurrence_days columns to tasks table
-- Run this in Supabase SQL Editor

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS due_time TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
ADD COLUMN IF NOT EXISTS recurrence_days JSONB DEFAULT NULL;
