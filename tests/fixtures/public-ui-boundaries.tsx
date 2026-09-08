/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic browser fixture boundary. */
/* eslint-disable @next/next/no-img-element -- Isolated Next image boundary. */
import React from 'react';
import { create } from 'zustand';

const calls: string[] = [];
const router = { push: (path: string) => calls.push(`navigate:${path}`), replace: (path: string) => calls.push(`navigate:${path}`) };
export const useRouter = () => router;
export const supabase = { auth: { getUser: async () => ({ data: { user: null } }) } };
export const signInWithGoogle = async () => { calls.push('google'); };
export const resetPassword = async () => { calls.push('reset-email'); };
export const markSetupComplete = async () => { calls.push('setup-complete'); return true; };
export const upsertCanvasSettings = async () => { throw new Error('No real Canvas connection in UI fixture'); };
export const useAppStore = create<any>(() => ({
  user: { id: 'public-ui-fictional', full_name: 'Alex Morgan', email: 'alex@example.invalid' },
  subjects: [], theme: 'dark',
  login: async () => { calls.push('login'); return true; },
  register: async () => { calls.push('register'); return 'confirmation-required'; },
  updateUserProfile: async () => { calls.push('profile'); return true; },
  addSubject: async (subject: unknown) => { calls.push('subject'); return subject; },
  setTheme: () => { calls.push('theme'); },
}));
export const publicUiBoundary = { calls };

export default function NextBoundary(props: any) {
  const { priority: _priority, ...rest } = props;
  void _priority;
  if ('src' in rest) return <img {...rest} alt={rest.alt || ''} />;
  return <a {...rest} onClick={(event) => { event.preventDefault(); calls.push(`navigate:${rest.href}`); rest.onClick?.(event); }} />;
}
