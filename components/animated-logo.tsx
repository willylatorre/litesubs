"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AnimatedLogoProps {
  className?: string;
  textClassName?: string;
  iconClassName?: string;
}

export function AnimatedLogo({ className, textClassName, iconClassName }: AnimatedLogoProps) {
  return (
    <div className={cn("flex items-center gap-2 group cursor-default", className)}>
      <motion.div
        whileHover={{ rotate: 90 }}
        transition={{ type: "spring", stiffness: 200, damping: 10 }}
        className="text-foreground"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("size-8 md:size-10", iconClassName)}
        >
          <path d="M5.636 5.636a9 9 0 1 0 12.728 12.728a9 9 0 0 0 -12.728 -12.728z" />
          <path d="M16.243 7.757a6 6 0 0 0 -8.486 0" />
        </svg>
      </motion.div>
      <span className={cn("text-4xl md:text-5xl font-bold tracking-tight select-none font-sans", textClassName)}>
        liteSubs
      </span>
    </div>
  );
}
