// QA visual-regression stabilization. Imported as the very first side-effect
// in `src/main.tsx` so the patches apply before React or any feature module
// reads `Date` or paints animated content.
//
// Activation sources (precedence: Electron preload > URL query > inactive):
//   1. Electron full-stack: `electron/preload.ts` reads `OMT_QA_FAKE_NOW` and
//      `OMT_QA_NO_ANIMATIONS` from `process.env` and exposes them via
//      `contextBridge.exposeInMainWorld('__qaConfig', { fakeNow, noAnimations })`.
//   2. Renderer-only: launch with `?qa-fake-now=<ISO>&qa-no-animations=1`.
//      `scripts/qa-launch-renderer.sh` documents the canonical URL.
//
// Why both knobs are gated on explicit env: a misfire in production would
// freeze "time ago" labels and disable transitions for real users. Env
// gating + URL-param gating means neither path activates without an
// explicit QA invocation.

interface QaStabilizationConfig {
  fakeNow: string | null;
  noAnimations: boolean;
}

declare global {
  interface Window {
    __qaConfig?: { fakeNow?: string | null; noAnimations?: boolean };
  }
}

function readQaConfig(): QaStabilizationConfig {
  const fromPreload = window.__qaConfig;
  if (fromPreload && typeof fromPreload === "object") {
    return {
      fakeNow: fromPreload.fakeNow ?? null,
      noAnimations: !!fromPreload.noAnimations,
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    fakeNow: params.get("qa-fake-now"),
    noAnimations: params.get("qa-no-animations") === "1",
  };
}

function applyFakeNow(iso: string): void {
  const fakeMs = new Date(iso).getTime();
  if (Number.isNaN(fakeMs)) {
    console.warn("[qa-stabilization] OMT_QA_FAKE_NOW invalid ISO:", iso);
    return;
  }
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(fakeMs);
      } else {
        // RealDate constructor accepts (string | number | Date) or
        // (number, number, ...) — defer to the platform implementation.
        // @ts-expect-error variadic constructor dispatch
        super(...args);
      }
    }
    static now(): number {
      return fakeMs;
    }
  }
  // The function-form `Date()` (without `new`) is not supported by class
  // extension — it is rarely used in this codebase (`new Date()` dominates).
  // If a dependency relies on the function form, fall back to a Proxy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = FakeDate;
}

const NO_ANIMATIONS_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
`;

function applyNoAnimations(): void {
  const style = document.createElement("style");
  style.setAttribute("data-qa-no-animations", "1");
  style.textContent = NO_ANIMATIONS_CSS;
  // `document.head` exists at module-eval time when this file is bundled
  // into the renderer entry — Vite emits the entry script after </head>.
  if (document.head) {
    document.head.appendChild(style);
  } else {
    // Defensive: if some HTML host loads this script before <head>, defer.
    document.addEventListener("DOMContentLoaded", () => {
      document.head.appendChild(style);
    });
  }
}

const config = readQaConfig();
if (config.fakeNow) {
  applyFakeNow(config.fakeNow);
}
if (config.noAnimations) {
  applyNoAnimations();
}

export {};
