/** The last thing the settings pane saved, or why it couldn't. */
export type Notice = string | null

declare module 'claude-code' {
  interface PluginState {
    limits: { notice: Notice }
  }
}
