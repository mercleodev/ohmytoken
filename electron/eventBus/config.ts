// HUD subsystem opt-out. Reads `OMT_HUD_ENABLED` from the process env;
// the env var is parsed only against the literal string "0" so that any
// other value (unset, "1", "true", "") preserves the default-on behavior
// shipped in PR #302. The boolean flows into `bootEventBus({ enabled })`
// at app start — when false, the WebSocket server never binds and no
// provider emitters register, leaving dashboard/tray/shortcut/watchers
// untouched.
export function isHudEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OMT_HUD_ENABLED !== "0";
}
