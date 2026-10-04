"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

// mango, as an rgb triple so it can be dropped into rgba(...) at varying opacity
const PARTICLE_COLOR = "255, 194, 44";
const LINE_MAX_DISTANCE = 115;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// Trimmed down from an earlier pass (64/42/26) — this canvas runs
// continuously on every page for as long as the tab is open, so its
// baseline cost is a constant tax on top of whatever else is happening at
// any given moment (page transitions, a table mounting, other animations).
// Fewer particles keeps that baseline low enough that bursts of other work
// don't push a frame over budget and read as a stutter.
function particleCountFor(width: number) {
  if (width < 640) return 16;
  if (width < 1024) return 26;
  return 40;
}

/**
 * A single canvas, mounted once at the root layout, that persists across
 * every navigation (root layout.tsx never remounts). Deliberately hand
 * -rolled instead of pulling in a particles library: this needs to run
 * continuously, on every page, for as long as the tab is open, so a small
 * amount of precisely-tuned code beats a general-purpose library's
 * overhead and default config surface.
 *
 * Sits behind all real content via plain DOM order (painted first, before
 * `children`, with no z-index needed) rather than negative z-index tricks
 * against an ancestor's background-color, which is fragile across browsers.
 *
 * Physics and redraw run at half the display's refresh rate (every other
 * animation frame) rather than every frame. The drift is slow and ambient
 * by design, so the visual difference between 30fps and 60fps here is
 * negligible, but it halves this component's CPU cost outright.
 */
export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let animationFrame = 0;
    let isVisible = true;
    let frameCount = 0;

    function createParticles() {
      const count = particleCountFor(width);
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
      }));
    }

    function resize() {
      // Capped at 1.5 rather than the more common 2: on retina displays
      // this keeps the canvas's actual pixel backing store meaningfully
      // smaller (roughly half the pixels of a DPR-2 canvas), which is a
      // real cost for clearRect/fill work happening every frame, for a
      // difference in sharpness that's not perceptible on ambient,
      // constantly-moving background dots.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      createParticles();
    }

    function drawFrame() {
      ctx!.clearRect(0, 0, width, height);

      for (const p of particles) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${PARTICLE_COLOR}, 0.55)`;
        ctx!.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < LINE_MAX_DISTANCE) {
            const opacity = 0.15 * (1 - dist / LINE_MAX_DISTANCE);
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.strokeStyle = `rgba(${PARTICLE_COLOR}, ${opacity})`;
            ctx!.lineWidth = 1;
            ctx!.stroke();
          }
        }
      }
    }

    function step() {
      frameCount++;
      // Only update physics + redraw on every other frame (~30fps).
      if (frameCount % 2 === 0) {
        for (const p of particles) {
          p.x += p.vx * 2; // compensate for the halved update rate so
          p.y += p.vy * 2; // drift speed still looks the same as before
          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;
        }
        drawFrame();
      }
      if (isVisible) animationFrame = requestAnimationFrame(step);
    }

    resize();
    window.addEventListener("resize", resize);

    function handleVisibilityChange() {
      isVisible = document.visibilityState === "visible";
      if (isVisible && !prefersReducedMotion) {
        animationFrame = requestAnimationFrame(step);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Reduced motion: draw the network once, statically, rather than
    // skipping it entirely — keeps the decorative pattern without motion.
    if (prefersReducedMotion) {
      drawFrame();
    } else {
      animationFrame = requestAnimationFrame(step);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0"
    />
  );
}
