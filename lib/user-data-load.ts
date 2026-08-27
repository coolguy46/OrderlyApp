import type { Exam, Goal, StudySession, Subject, Task } from './supabase/types';
import type { FriendWithProfile } from './supabase/services';

export interface UserDataSnapshot {
  tasks: Task[];
  goals: Goal[];
  studySessions: StudySession[];
  exams: Exam[];
  subjects: Subject[];
  friends: FriendWithProfile[];
}

export interface UserDataReaders {
  getTasks: (userId: string) => Promise<Task[]>;
  getGoals: (userId: string) => Promise<Goal[]>;
  getStudySessions: (userId: string) => Promise<StudySession[]>;
  getExams: (userId: string) => Promise<Exam[]>;
  getSubjects: (userId: string) => Promise<Subject[]>;
  getFriends: (userId: string) => Promise<FriendWithProfile[]>;
}

/**
 * Read one complete user snapshot. A failed collection rejects the whole read,
 * allowing callers to keep the last known-good state instead of publishing a
 * mixture of fresh data and failure-shaped empty arrays.
 */
export async function readUserDataSnapshot(
  userId: string,
  readers: UserDataReaders,
): Promise<UserDataSnapshot> {
  const [tasks, goals, studySessions, exams, subjects, friends] = await Promise.all([
    readers.getTasks(userId),
    readers.getGoals(userId),
    readers.getStudySessions(userId),
    readers.getExams(userId),
    readers.getSubjects(userId),
    readers.getFriends(userId),
  ]);

  return { tasks, goals, studySessions, exams, subjects, friends };
}
