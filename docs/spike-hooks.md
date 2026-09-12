# M0 spike: what the Claude Code hooks actually give us

Measured on 11 September 2026 with Claude Code CLI 2.1.205 on Windows 11, launched from inside a
VS Code extension session. Six headless `claude -p` runs with a throwaway `--settings` file that
registered HTTP hooks for every event and a command hook on SessionStart and Stop, all posting to a
local listener. The kit to repeat this lives in `tools/hook-spike/`.

## Findings that change the PRD

| Question | Answer | Consequence |
| --- | --- | --- |
| Does `claude agents --json` list interactive sessions? | Yes. It listed all eleven live sessions, interactive and headless alike, each with `pid`, `cwd`, `kind`, `startedAt`, `sessionId`, `name`. No state or status fields. | Liveness and alias-to-PID mapping come from this list, keyed by `sessionId`, which every hook payload also carries. FR-2 and FR-25 are solved. |
| Does SessionEnd fire when a session is killed? | No. A forced kill produced no SessionEnd, and the session vanished from the agents list within seconds. Normal completion sends SessionEnd with `reason: "other"`. | `done` is SessionEnd or disappearance from the list, whichever comes first. |
| Does the HTTP SessionStart hook fire? | No, in three of three runs, while the command hook on the same event fired every time. | Detect a session on its first event of any kind, as FR-1 already allows. |
| Is there a permission or waiting event headlessly? | No. In `-p` mode tools ran without any PermissionRequest, PermissionDenied or Notification, even a Write in default permission mode. | The `waiting` transition can only be verified interactively. See the checklist below. |
| Where does context usage come from? | Every assistant record in the transcript JSONL has `message.usage` with `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`. Their sum on the latest record is the context in use, 38,697 tokens in run 1. The status line is not invoked headlessly. | Tail the transcript at `transcript_path` for FR-10. The format is internal, so isolate the parser. |
| How do subagents appear? | The Agent tool's PostToolUse returns in about 30 ms; SubagentStart carries `agent_id` and `agent_type`; the subagent's own PreToolUse and PostToolUse carry the same `agent_id`; SubagentStop carries `agent_transcript_path`; the parent reaches Stop with `background_tasks` listing the running subagent, then a synthetic UserPromptSubmit re-enters the parent when the subagent finishes. | A session whose Stop has non-empty `background_tasks` is still busy, not idle. Subagent count comes from SubagentStart and SubagentStop or from `background_tasks`. |
| What else appears in `background_tasks`? | Besides subagents (`{id, type: "subagent", status, description, agent_type}`), a background shell started with `run_in_background` appears as `{id, type: "shell", status, description, command}`, and it keeps arriving on every Stop for as long as it runs. `command` and `description` are tool input. | Ingest counts only `type: "subagent"` entries, so a session whose only background task is a shell has nothing to wait for and reads idle; the shell's `command` is never copied. |
| What do payloads contain? | See the field lists below. UserPromptSubmit has the full prompt text, PreToolUse the full tool input, PostToolUse the full tool response including file contents and stdout, Stop the last assistant message. | Strip `prompt`, `tool_input`, `tool_response` and `last_assistant_message` at ingest before anything is logged or stored. |

## Payload fields observed

Common to every HTTP event: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and from
UserPromptSubmit onward `prompt_id` and `permission_mode`.

| Event | Extra fields |
| --- | --- |
| UserPromptSubmit | `prompt` |
| PreToolUse | `tool_name`, `tool_input`, `tool_use_id`; inside a subagent also `agent_id`, `agent_type` |
| PostToolUse | as PreToolUse plus `tool_response`, `duration_ms` |
| Stop | `stop_hook_active`, `last_assistant_message`, `background_tasks[]` of `{id, type, status, description, agent_type}`, `session_crons` |
| SessionEnd | `reason` |
| SubagentStart | `agent_id`, `agent_type` |
| SubagentStop | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `background_tasks` |
| MessageDisplay | `turn_id`, `message_id`, `index`, `final`, `delta` |
| SessionStart (command hook only) | `source: "startup"` |

Delivery is a plain JSON POST from axios with keep-alive. Command hooks run through bash on Windows,
three processes below `claude.exe`, and see `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PROJECT_DIR`,
`CLAUDE_CODE_ENTRYPOINT` (`claude-vscode` here) and others. `CLAUDE_PID` was the outer session's PID
in this nested setup, so do not trust it; use the agents list.

## Interactive run, 12 September 2026

One interactive session in the VS Code terminal with `--permission-mode default` and the spike
settings, 25 events.

| Step | What fired |
| --- | --- |
| `whoami` via Bash | PreToolUse, PostToolUse, Stop. No permission event: read-only shell commands are auto-approved in this setup even though they are not in the allow list. |
| AskUserQuestion | PreToolUse, then **PermissionRequest** immediately with `tool_name: "AskUserQuestion"` and the question in `tool_input`, then **Notification** with `notification_type: "permission_prompt"` and `message: "Claude needs your permission"` six seconds later, then PostToolUse when answered. |
| Idle after "thanks" | Nothing within the 28 seconds before exit. Idle notifications remain unmeasured. |
| `/exit` | SessionEnd with `reason: "prompt_input_exit"`. |
| Background | A SubagentStop with an empty `agent_type` and no matching SubagentStart, from the internal session-naming helper. Ignore subagent events whose `agent_type` is empty or that had no SubagentStart. |

Two consequences for the state machine: `waiting` starts on PermissionRequest, not on the
Notification, which lags by six seconds; and a question to the user is a PermissionRequest whose
tool is AskUserQuestion, so no separate handling is needed. Payloads now also carry `effort`.

**The status line answers the context question outright.** Its input JSON, captured under the
statusline label, carries `context_window` with `used_percentage`, `remaining_percentage`,
`context_window_size` and `current_usage`, plus `cost.total_cost_usd`, `rate_limits` for the
five-hour and seven-day windows, `model.display_name`, `session_name`, `workspace` and `version`. It
runs on every update in interactive sessions only. A status line command that posts this to the
local agent gives FR-10 for free; the transcript parser is only needed for headless sessions.
Because `statusLine` is a single setting, the installer must wrap any status line the user already
has and must print a line itself, or the user's status bar goes blank.

## Not yet measured

- PermissionDenied on an explicit deny. Deny an AskUserQuestion prompt with Escape next time.
- Whether an idle notification exists after a longer wait.
- Behaviour with the listener down. The docs say HTTP hook failures never block; this run did not test it.
- Cloud sessions and Remote Control sessions in the agents list.
- Which shell commands prompt in a plain terminal session rather than the VS Code terminal.

## Interactive checklist

1. Start the listener: `node tools/hook-spike/listener.js` (it exits after six minutes).
2. In any repo, start an interactive session with the spike settings layered on: `claude --settings tools/hook-spike/spike-settings.json`.
3. Ask it to write a file you have not pre-approved, and leave the permission prompt unanswered for a minute, then deny it, then approve a second one.
4. Ask it something that makes it use AskUserQuestion.
5. Leave it idle for a minute.
6. Read `tools/hook-spike/spike-events.jsonl`: which events arrived at each step, their `hook_event_name`, and for Notification the `notification_type`. The status line command in the settings logs its input JSON to the same file under `/command-hook/statusline`.

## Practical notes

- Each haiku run cost about eight cents because the system prompt carries every installed plugin.
- Git Bash reports its own process IDs, not Windows ones; kill sessions by the PID from the agents list with `taskkill /PID <pid> /T /F`.
- Nested `claude -p` runs from inside a Claude Code session work.
