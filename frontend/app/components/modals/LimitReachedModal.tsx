"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, UserCheck, LogOut } from "lucide-react";

interface LimitReachedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignUp?: () => void;
  onLogIn?: () => void;
  onOpenAuthModal?: (mode: "signin" | "signup") => void;
}

export default function LimitReachedModal({
  isOpen,
  onClose,
  onSignUp,
  onLogIn,
  onOpenAuthModal,
}: LimitReachedModalProps) {
  const handleSignUp = () => {
    onClose();
    if (onSignUp) onSignUp();
    else if (onOpenAuthModal) onOpenAuthModal("signup");
  };

  const handleLogIn = () => {
    onClose();
    if (onLogIn) onLogIn();
    else if (onOpenAuthModal) onOpenAuthModal("signin");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-md bg-[#1e2020] border border-cyan-500/40 rounded-3xl p-6 sm:p-8 shadow-[0_0_60px_rgba(6,182,212,0.18)] z-10 text-center overflow-hidden"
          >
            {/* Glowing cyan top accent */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_rgba(6,182,212,0.9)]" />

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Glowing Icon */}
            <div className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mb-4 text-cyan-400 shadow-[0_0_24px_rgba(6,182,212,0.25)]">
              <Sparkles className="w-7 h-7" />
            </div>

            {/* Heading */}
            <h3 className="text-xl font-bold text-white mb-2 tracking-tight">
              Guest Research Limit Reached
            </h3>

            {/* Message */}
            <p className="text-sm text-zinc-300 leading-relaxed mb-6">
              You’ve used all 5 free guest queries. Sign up or log in to continue
              researching with 50 queries per day, saved history, and full deep
              research access.
            </p>

            {/* Direct Sign Up & Log In Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={handleSignUp}
                className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserCheck className="w-4 h-4" />
                <span>Sign Up Free</span>
              </button>

              <button
                type="button"
                onClick={handleLogIn}
                className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-[#2a2c2c] hover:bg-[#323535] border border-zinc-700/80 text-zinc-200 hover:text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4 rotate-180" />
                <span>Log In</span>
              </button>
            </div>

            <div className="mt-4 text-[11px] text-zinc-500">
              Takes less than 30 seconds • No credit card required
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
