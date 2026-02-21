import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, formatDistanceToNow, differenceInDays, differenceInHours } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM d, yyyy');
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM d, yyyy h:mm a');
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function getDaysUntil(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return differenceInDays(d, new Date());
}

export function getHoursUntil(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return differenceInHours(d, new Date());
}

export function getRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function getProgressPercentage(current: number, target: number): number {
  if (target === 0) return 0;
  return Math.min(Math.round((current / target) * 100), 100);
}

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Calculate suggested priority based on due date
// 0-24 hours = high, 25-72 hours = medium, 72+ hours = low, overdue = high
export function calculateSuggestedPriority(dueDate: string | Date | null): 'high' | 'medium' | 'low' {
  if (!dueDate) return 'medium';
  
  const hoursUntil = getHoursUntil(dueDate);
  
  if (hoursUntil < 0) return 'high'; // Overdue
  if (hoursUntil <= 24) return 'high'; // 0-24 hours
  if (hoursUntil <= 72) return 'medium'; // 25-72 hours
  return 'low'; // More than 72 hours
}

// Check if a task is overdue
export function isTaskOverdue(dueDate: string | Date | null, status: string): boolean {
  if (!dueDate || status === 'completed') return false;
  const hoursUntil = getHoursUntil(dueDate);
  return hoursUntil < 0;
}
