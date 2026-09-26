import * as React from 'react';
import { Bold, Italic, Underline, List, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}

// A minimal contentEditable + document.execCommand toolbar — no rich-text
// dependency exists in this app yet, and a full editor library is more than
// a single formatted report field needs. execCommand is deprecated but still
// broadly supported for this narrow use (bold/italic/underline/lists), and
// the app already targets evergreen desktop browsers for its print flows.
export function RichTextEditor({ value, onChange, readOnly, placeholder, className }: RichTextEditorProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Starts at a sentinel no real value can equal (not the initial `value`
  // itself) so the first effect run always syncs the DOM — the contentEditable
  // div starts with no HTML of its own, so skipping that first sync (which an
  // initial `useRef(value)` did, since it'd equal `value` immediately) left a
  // loaded report's content never actually rendered.
  const lastValue = React.useRef<string | null>(null);

  // Only push external value changes into the DOM (e.g. loading a saved
  // report) — never on every keystroke, which would fight the caret position.
  React.useEffect(() => {
    if (ref.current && value !== lastValue.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = value || '';
      lastValue.current = value;
    }
  }, [value]);

  const exec = (command: string) => {
    if (readOnly) return;
    ref.current?.focus();
    document.execCommand(command, false);
    handleInput();
  };

  const handleInput = () => {
    const html = ref.current?.innerHTML || '';
    lastValue.current = html;
    onChange(html);
  };

  const isEmpty = !value || value === '<br>' || value === '<p></p>';

  return (
    <div className={cn('rounded-lg border border-input bg-background', className)}>
      {!readOnly && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Underline className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-4 w-px bg-border" />
          <button type="button" title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <List className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="relative">
        {isEmpty && placeholder && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">{placeholder}</p>
        )}
        <div
          ref={ref}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onInput={handleInput}
          className={cn(
            'min-h-[220px] max-w-none px-3 py-2 text-sm text-foreground focus-visible:outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
            readOnly && 'cursor-default',
          )}
        />
      </div>
    </div>
  );
}
