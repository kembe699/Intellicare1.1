import React from 'react';
import { Button } from '@/components/ui/button';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ActionButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  label,
  icon: Icon,
  onClick,
  variant = 'default',
  size = 'default',
  disabled = false,
  loading = false,
  className,
}) => {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled || loading}
      className={className}
    >
      <Icon className={cn('h-4 w-4', size !== 'icon' && 'mr-2')} />
      {size !== 'icon' && label}
    </Button>
  );
};
