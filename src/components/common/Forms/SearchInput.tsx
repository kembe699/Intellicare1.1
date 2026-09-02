import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Search, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  loading?: boolean;
  className?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onSearch,
  placeholder = 'Search...',
  debounceMs = 300,
  loading = false,
  className,
}) => {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(localValue);
      onSearch?.(localValue);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [localValue, debounceMs, onChange, onSearch]);

  const handleClear = () => {
    setLocalValue('');
    onChange('');
    onSearch?.('');
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
        ) : localValue ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-7 w-7 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
};
