"use client";

import React from "react";

interface DeleteChatModalProps {
  sessionId: string | null;
  onClose: () => void;
  onConfirm?: (id: string) => void;
  onConfirmDelete?: (id: string) => void;
}

export default function DeleteChatModal({
  sessionId,
  onClose,
  onConfirm,
  onConfirmDelete,
}: DeleteChatModalProps) {
  if (!sessionId) return null;

  const handleConfirm = () => {
    if (onConfirmDelete) {
      onConfirmDelete(sessionId);
    } else if (onConfirm) {
      onConfirm(sessionId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#2a2c2c] border border-zinc-700/50 rounded-xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <h3 className="text-lg font-semibold text-zinc-200 mb-2">Delete chat?</h3>
        <p className="text-sm text-zinc-400 mb-6">
          This will delete the chat history. This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 rounded-md text-sm font-medium bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
