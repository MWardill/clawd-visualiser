// The agent's public surface for hosts other than the CLI. The desktop app runs the agent in its
// own main process through these.
export { PortInUseError, startAgent, type AgentOptions, type RunningAgent } from "./agent";
export { ConfigError, DEFAULT_PORT, agentPaths, defaultConfig, defaultHome, readConfig, saveConfig, type AgentConfig, type AgentPaths } from "./config";
export { createLogger, silentLogger, type LogCode, type LogFields, type Logger } from "./log";
