-- Add recurrence and due_time columns to tasks table
-- Run this in Supabase SQL Editor

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS due_time TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));
