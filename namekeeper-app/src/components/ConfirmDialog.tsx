'use client';

import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  details,
  confirmLabel = 'Confirm',
  confirmVariant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  const confirmClasses = confirmVariant === 'danger'
    ? 'bg-red-500 text-white hover:bg-red-600'
    : 'bg-amber-500 text-white hover:bg-amber-600';

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="fixed inset-0 z-50 m-auto w-full max-w-sm rounded-xl bg-white shadow-2xl border border-slate-200 p-0 backdrop:bg-black/30"
    >
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      </div>
      <div className="px-6 py-4">
        <p className="text-sm text-slate-600">{message}</p>
        {details && details.length > 0 && (
          <ul className="mt-3 space-y-1">
            {details.map((d, i) => (
              <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                <span className="text-slate-300 mt-0.5">-</span>
                {d}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`px-4 py-2 text-sm rounded-lg transition-colors font-medium ${confirmClasses}`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
