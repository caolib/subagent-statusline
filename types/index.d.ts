export type AgentActivity = {
  /** 工具名，如 Read。 */
  tool: string;
  /** 工具的主要参数，已截断。 */
  target: string;
  /** 记录时间，用于淘汰旧条目。 */
  at: number;
};

declare module 'claude-code' {
  interface PluginState {
    'subagent-statusline': {
      activity: Shaped<Record<string, AgentActivity>>;
    };
  }
}
