"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut } from "lucide-react";

interface LogoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout?: () => void;
  onConfirm?: () => void;
  user: any;
}

export default function LogoutModal({
  isOpen,
  onClose,
  onLogout,
  onConfirm,
  user,
}: LogoutModalProps) {
  const handleConfirm = onLogout || onConfirm;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#1e2022] p-6 shadow-2xl shadow-black/60 z-10"
          >
            <div className="flex items-center gap-3.5 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-zinc-100">
                  Sign Out
                </h3>
                <p className="text-xs text-zinc-400">
                  Deep Research AI Platform
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed mb-6">
              Are you sure you want to sign out of{" "}
              <span className="font-semibold text-cyan-400">
                {user?.full_name || user?.email}
              </span>
              ? You can sign back in anytime to access your research history and
              workspaces.
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:bg-zinc-800/80 border border-zinc-700/80 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 shadow-md shadow-red-950/50 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
