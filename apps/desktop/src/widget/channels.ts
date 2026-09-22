// The widget bridge's channel names, in a file that imports nothing: the preload needs only these,
// and it is parsed before every widget page. Every widget window shares them; main tells the
// windows apart by the sender.
export const WIDGET_CHANNELS = {
  /** The one call with an answer: the page asks for its state once its scene is mounted. */
  ready: "clawd:widget/ready",
  resize: "clawd:widget/resize",
  dragStart: "clawd:widget/dragStart",
  dragMove: "clawd:widget/dragMove",
  dragEnd: "clawd:widget/dragEnd",
  togglePin: "clawd:widget/togglePin",
  select: "clawd:widget/select",
  menu: "clawd:widget/menu",
  /** Main to the page: the state changed. */
  state: "clawd:widget/state",
} as const;
