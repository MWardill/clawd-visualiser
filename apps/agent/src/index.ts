// The agent's public surface for hosts other than the CLI. The desktop app runs the agent in its
// own main process through these.
export { PortInUseError, startAgent, type AgentOptions, type RunningAgent } from "./agent";
export { ConfigError, DEFAULT_PORT, agentPaths, defaultConfig, defaultHome, defaultSettingsPath, defaultTranscriptsDir, detailLevel, readConfig, saveConfig, type AgentConfig, type AgentPaths } from "./config";
export { saveDetail, setDetail } from "./detail";
export { install, installHooks, removeFromAllowlist, setAllowlist, uninstall, uninstallHooks, type AllowlistResult, type HooksResult, type UninstallResult } from "./install/installer";
export { HOOK_SCRIPTS, applyInstall, hookCommand, hookStatus, installedRuntimeExe, isJsonObject, nodeRuntime, statusCommand, type HookStatus, type InstallOptions, type JsonObject } from "./install/settings";
export { readJsonFile, writeJsonAtomic, type JsonRead } from "./json-file";
export { createLogger, silentLogger, type LogCode, type LogFields, type Logger } from "./log";
export { AGENT_VERSION } from "./version";
