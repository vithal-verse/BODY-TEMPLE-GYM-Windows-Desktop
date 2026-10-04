"use client";

import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/**
 * Animates a number counting up from 0 to `target` whenever `target`
 * changes. When the user prefers reduced motion, the animation runs with
 * a duration of 0 so it resolves to the final value immediately instead
 * of skipping the shared animate()/onUpdate path entirely — keeping a
 * single code path rather than a second, synchronous setState branch.
 */
export function useCountUp(target: number, duration = 1.4) {
  const [display, setDisplay] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const controls = animate(0, target, {
      duration: prefersReducedMotion ? 0 : duration,
      ease: [0.16, 1, 0.3, 1] as const,
      onUpdate: (value) => setDisplay(value),
    });

    return () => controls.stop();
  }, [target, duration, prefersReducedMotion]);

  return display;
}
