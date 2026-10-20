import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface ResponsiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md sm:max-w-lg',
  lg: 'max-w-lg sm:max-w-2xl',
  full: 'w-full max-w-none',
};

export const ResponsiveModal: React.FC<ResponsiveModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`p-0 ${sizeClasses[size]} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between p-4 sm:p-6 pr-12 border-b border-border flex-shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-heading truncate">
            {title}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
};
