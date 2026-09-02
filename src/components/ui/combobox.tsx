import * as React from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  /** Custom rendering for the trigger's selected-value display (defaults to the option label). */
  renderSelected?: (option: ComboboxOption) => React.ReactNode;
  /** Custom rendering for each dropdown row (defaults to the option label). */
  renderOption?: (option: ComboboxOption) => React.ReactNode;
}

/** Single-select searchable dropdown. Replaces hand-rolled absolute/portal-positioned search dropdowns. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  className,
  disabled,
  renderSelected,
  renderOption,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const selected = options.find((o) => o.value === value);

  // A catalog-sized options list (hundreds to thousands of drugs/services) made this
  // unusable — cmdk's default behavior mounts every option as a DOM node up front, then
  // re-scores all of them against the typed text on every keystroke. That's what turned
  // "pick one item" into a multi-second-to-minutes freeze on the pharmacy drug picker.
  // Filtering ourselves (a cheap substring match) and always rendering a capped slice
  // keeps both the DOM size and the per-keystroke work bounded no matter how big
  // `options` gets.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return matches.slice(0, 100);
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground', className)}
        >
          <span className="truncate">
            {selected ? (renderSelected ? renderSelected(selected) : selected.label) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] max-w-none p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup className="max-h-64 overflow-auto">
              {filtered.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4 shrink-0', value === option.value ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1">{renderOption ? renderOption(option) : option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {options.length > filtered.length && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Showing first {filtered.length} of {options.length} — keep typing to narrow down.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface MultiSelectComboboxProps {
  options: ComboboxOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  /** When set, typing a value not present in `options` shows an "Add ..." item that adds the raw text to `values`. */
  allowCreate?: boolean;
}

/** Multi-select searchable checklist dropdown. Selecting an item keeps the popover open. */
export function MultiSelectCombobox({
  options,
  values,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  className,
  disabled,
  allowCreate = false,
}: MultiSelectComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const toggle = (optionValue: string) => {
    onChange(values.includes(optionValue) ? values.filter((v) => v !== optionValue) : [...values, optionValue]);
  };

  const trimmedSearch = search.trim();
  const canCreate =
    allowCreate &&
    trimmedSearch.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmedSearch.toLowerCase()) &&
    !values.some((v) => v.toLowerCase() === trimmedSearch.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', values.length === 0 && 'text-muted-foreground', className)}
        >
          <span className="truncate">
            {values.length > 0 ? `${values.length} selected` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] max-w-none p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup className="max-h-64 overflow-auto">
              {canCreate && (
                <CommandItem
                  value={`__create__${trimmedSearch}`}
                  onSelect={() => {
                    onChange([...values, trimmedSearch]);
                    setSearch('');
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add "{trimmedSearch}"
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => toggle(option.value)}
                >
                  <Check className={cn('mr-2 h-4 w-4', values.includes(option.value) ? 'opacity-100' : 'opacity-0')} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
