-- Timer State table: persists active timer state across sessions/devices
CREATE TABLE timer_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  timer_type TEXT NOT NULL DEFAULT 'pomodoro' CHECK (timer_type IN ('pomodoro', 'stopwatch')),
  mode TEXT NOT NULL DEFAULT 'focus' CHECK (mode IN ('focus', 'shortBreak', 'longBreak')),
  is_running BOOLEAN NOT NULL DEFAULT false,
  pomodoro_started_at TIMESTAMP WITH TIME ZONE,
  stopwatch_started_at TIMESTAMP WITH TIME ZONE,
  time_left INTEGER NOT NULL DEFAULT 1500,
  stopwatch_time INTEGER NOT NULL DEFAULT 0,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  pomodoro_started BOOLEAN NOT NULL DEFAULT false,
  stopwatch_started BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE timer_states ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can only manage their own timer state
CREATE POLICY "Users can manage their own timer state" ON timer_states
  FOR ALL USING (auth.uid() = user_id);
