'use client';

import { cn } from '@/lib/utils';
import { Badge } from './Badge';
import { Card, CardContent } from './Card';
import { ReactNode } from 'react';

// Priority Badge
interface PriorityBadgeProps {
  priority: 'low' | 'medium' | 'high' | 'urgent';
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const variants = {
    low: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    medium: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    high: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    urgent: 'bg-red-500/20 text-red-300 border-red-500/30',
  };

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
      variants[priority],
      className
    )}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

// Status Badge
interface StatusBadgeProps {
  status: 'todo' | 'in_progress' | 'completed' | 'active' | 'paused' | 'pending';
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variants = {
    todo: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    pending: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    in_progress: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    completed: 'bg-green-500/20 text-green-300 border-green-500/30',
    active: 'bg-green-500/20 text-green-300 border-green-500/30',
    paused: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  };

  const labels = {
    todo: 'To Do',
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    active: 'Active',
    paused: 'Paused',
  };

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
      variants[status],
      className
    )}>
      {labels[status]}
    </span>
  );
}

// Subject Badge
interface SubjectBadgeProps {
  name: string;
  color: string;
  className?: string;
}

export function SubjectBadge({ name, color, className }: SubjectBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-white/10',
        className
      )}
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}

// Stat Card
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  color?: 'indigo' | 'green' | 'yellow' | 'red' | 'purple';
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  color = 'indigo',
  className,
}: StatCardProps) {
  const colorClasses = {
    indigo: 'from-indigo-500/10 to-indigo-500/5',
    green: 'from-green-500/10 to-green-500/5',
    yellow: 'from-yellow-500/10 to-yellow-500/5',
    red: 'from-red-500/10 to-red-500/5',
    purple: 'from-purple-500/10 to-purple-500/5',
  };

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-4">
        <div className={cn('absolute inset-0 bg-gradient-to-br opacity-50', colorClasses[color])} />
        <div className="relative flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            {trend && (
              <div className={cn(
                'flex items-center gap-1 text-xs font-medium',
                trend.isPositive ? 'text-green-400' : 'text-red-400'
              )}>
                <span>{trend.isPositive ? '↑' : '↓'}</span>
                <span>{trend.value}%</span>
              </div>
            )}
          </div>
          {icon && (
            <div className="p-2 rounded-lg bg-background/50">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
