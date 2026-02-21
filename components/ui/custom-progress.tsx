'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  color?: 'indigo' | 'green' | 'yellow' | 'red' | 'purple';
  className?: string;
  shimmer?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  showLabel = true,
  size = 'md',
  color = 'indigo',
  className,
  shimmer = false,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.round((value / max) * 100));
  const [animatedWidth, setAnimatedWidth] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedWidth(percentage), 100);
    return () => clearTimeout(timer);
  }, [percentage]);

  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
  };

  const colorClasses = {
    indigo: 'bg-indigo-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
  };

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('w-full bg-muted rounded-full overflow-hidden', sizeClasses[size])}>
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700 ease-out relative',
            colorClasses[color],
            shimmer && 'shimmer'
          )}
          style={{ width: `${animatedWidth}%` }}
        />
      </div>
      {showLabel && (
        <p className="text-xs text-muted-foreground mt-1">{percentage}%</p>
      )}
    </div>
  );
}

interface CircularProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: 'indigo' | 'green' | 'yellow' | 'red' | 'purple' | string;
  showLabel?: boolean;
  className?: string;
  children?: React.ReactNode;
  animated?: boolean;
}

export function CircularProgress({
  value,
  max = 100,
  size = 80,
  strokeWidth = 8,
  color = 'indigo',
  showLabel = true,
  className,
  children,
  animated = true,
}: CircularProgressProps) {
  const percentage = Math.min(100, Math.round((value / max) * 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const targetOffset = circumference - (percentage / 100) * circumference;
  
  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    if (animated) {
      const timer = setTimeout(() => setOffset(targetOffset), 150);
      return () => clearTimeout(timer);
    } else {
      setOffset(targetOffset);
    }
  }, [targetOffset, circumference, animated]);

  const colorClasses: Record<string, string> = {
    indigo: 'stroke-indigo-500',
    green: 'stroke-green-500',
    yellow: 'stroke-yellow-500',
    red: 'stroke-red-500',
    purple: 'stroke-purple-500',
  };
  
  // Check if color is a hex value or custom color
  const isCustomColor = color.startsWith('#') || color.startsWith('rgb');
  const strokeClass = isCustomColor ? '' : colorClasses[color] || colorClasses.indigo;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-muted"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          className={cn('transition-all duration-1000 ease-out', strokeClass)}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            ...(isCustomColor ? { stroke: color } : {}),
          }}
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      ) : showLabel ? (
        <span className="absolute text-sm font-medium">{percentage}%</span>
      ) : null}
    </div>
  );
}
