import React from 'react';
import { create } from 'zustand';
export const useAppStore = create<{ user: { id: string } | null }>(() => ({ user: { id: 'billing-test-alex' } }));
export default function Link(props: React.ComponentProps<'a'>) { return <a {...props} />; }
Object.assign(window, { billingFixture: { signOut: () => useAppStore.setState({ user: null }), signIn: (id: string) => useAppStore.setState({ user: { id } }) } });
