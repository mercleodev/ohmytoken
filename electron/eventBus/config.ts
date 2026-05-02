// HUD subsystem opt-in. During the v1.0.0 stabilization period the HUD
// (eventBus WebSocket on port 8781 + provider emitters introduced in
// PR #302) is off by default — only `OMT_HUD_ENABLED=1` boots it. The
// env var is parsed against the literal string "1" so any other value
// (unset, "0", "", "true", "yes") leaves the HUD disabled. Once v1.0.0
// ships and the HUD is promoted from experimental to released, this
// helper's default flips back to enabled (or the call site stops
// gating altogether). Until then the boolean flows into
// `bootEventBus({ enabled })` at app start; when false the WebSocket
// server never binds and no provider emitters register, leaving
// dashboard / tray / shortcut / notification / watchers / DB import
// untouched.
export function isHudEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OMT_HUD_ENABLED === "1";
}
