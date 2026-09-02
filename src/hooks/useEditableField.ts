import { useState } from 'react';

/**
 * Encapsulates the "staged edit buffer + toggle + save/cancel" pattern used by
 * inline-editable fields (e.g. VisitDetails.tsx's Chief Complaints, Clinical Notes,
 * Vital Signs cards) instead of hand-duplicating the same 4 pieces of state per field.
 *
 * `startEdit` takes the current value explicitly (rather than relying on the value
 * passed at hook-call time) so this can safely be called before data has loaded —
 * hooks must run unconditionally, but the real value is only known once it has.
 */
export function useEditableField<T>(initial: T, onSave: (value: T) => Promise<void>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);

  const startEdit = (currentValue: T) => {
    setDraft(currentValue);
    setIsEditing(true);
  };

  const cancelEdit = () => setIsEditing(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (error) {
      console.error('useEditableField save failed:', error);
    } finally {
      setSaving(false);
    }
  };

  return { isEditing, draft, setDraft, startEdit, cancelEdit, save, saving };
}
