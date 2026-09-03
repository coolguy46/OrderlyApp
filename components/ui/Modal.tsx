'use client';

import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const sizeClasses = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          'left-1/2 right-auto flex w-[calc(100%-2rem)] -translate-x-1/2 flex-col gap-0 overflow-hidden border-white/10 bg-gray-900/95 p-0 text-white shadow-2xl shadow-black/50 backdrop-blur-xl',
          'sm:max-h-[90dvh] sm:overflow-hidden sm:rounded-2xl',
          sizeClasses[size]
        )}
        style={{ maxHeight: 'min(calc(100dvh - 2rem), 900px)' }}
      >
        <DialogHeader className="shrink-0 flex-row items-center justify-between space-y-0 px-6 pb-4 pt-6 text-left">
          <DialogTitle className={cn('text-xl text-white', !title && 'sr-only')}>
            {title || 'Dialog'}
          </DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close dialog"
              className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <X size={20} />
            </button>
          </DialogClose>
        </DialogHeader>

        <DialogBody
          role="region"
          aria-label={title ? `${title} content` : 'Dialog content'}
          tabIndex={0}
          className="px-6 pb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
        >
          {children}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
