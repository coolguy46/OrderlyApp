/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated browser boundary, not a production store. */
/* eslint-disable @next/next/no-img-element -- The fixture replaces Next's image/network boundary. */
import React from 'react';
import { create } from 'zustand';

const mutationCalls: string[] = [];
const navigationCalls: string[] = [];
const forbiddenMutation = (name: string) => () => {
  mutationCalls.push(name);
  throw new Error(`Tutorial attempted an account mutation: ${name}`);
};
export const useAppStore = create<any>(() => ({
  user: { id: 'tutorial-test-alex', full_name: 'Alex Morgan', email: 'alex@example.invalid', tasks_completed: 0 },
  tasks: [{ id: 'biology', title: 'Biology Worksheet', status: 'pending', priority: 'medium' }],
  goals: [{ id: 'essay', title: 'Finish the Essay Outline', current_value: 0, target_value: 1, unit: 'outline' }],
  exams: [],
  integrations: [],
  addTask: forbiddenMutation('addTask'),
  updateTask: forbiddenMutation('updateTask'),
  deleteTask: forbiddenMutation('deleteTask'),
  completeTask: forbiddenMutation('completeTask'),
  updateUser: forbiddenMutation('updateUser'),
  logout: forbiddenMutation('logout'),
}));

const router = { push: (path: string) => navigationCalls.push(path), replace: (path: string) => navigationCalls.push(path), refresh: () => {} };
export const useRouter = () => router;
export const usePathname = () => '/';
export const useSearchParams = () => new URLSearchParams();

// Render the real component tree without asking a Next server to optimize images
// or navigate away from the isolated fixture.
export default function NextBoundary(props: any) {
  const { priority: _priority, unoptimized: _unoptimized, fill: _fill, quality: _quality, onLoadingComplete: _onLoadingComplete, ...rest } = props;
  void _priority; void _unoptimized; void _fill; void _quality; void _onLoadingComplete;
  if ('src' in rest) return <img {...rest} alt={rest.alt || ''} />;
  return <a {...rest} onClick={(event) => { event.preventDefault(); navigationCalls.push(String(rest.href)); rest.onClick?.(event); }} />;
}

export const tutorialBoundary = {
  mutationCalls,
  navigationCalls,
  accountState: () => {
    const { user, tasks, goals, exams, integrations } = useAppStore.getState();
    return { user, tasks, goals, exams, integrations };
  },
};
