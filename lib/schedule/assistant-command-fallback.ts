export interface AssistantCommandMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface AssistantCommandPreviewLike {
  status: string;
  summary: string;
  actions: readonly unknown[];
}

export interface AssistantCommandRecovery<Preview extends AssistantCommandPreviewLike> {
  command: string;
  preview: Preview;
  recovered: boolean;
}

function isSchoolOverlap(preview: AssistantCommandPreviewLike): boolean {
  return preview.status === 'clarification'
    && /\boverlaps?\b[\s\S]*\bschool day\b/i.test(preview.summary);
}

function hasExplicitClockRange(value: string): boolean {
  const range = /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(value);
  if (!range) return false;
  return Boolean(range[3] || range[6]) || Boolean(range[2] && range[5]);
}

/**
 * Model prose is never authoritative evidence that a calendar mutation was
 * applied, rejected, or conflicted. These phrases require a deterministic
 * command preview before they may be shown as calendar facts.
 */
export function isUnverifiedCalendarOutcome(value: string): boolean {
  return /\b(?:overlaps?|conflicts?)\b/i.test(value)
    || /\b(?:i|orderly)\s+(?:can(?:not|'t)?|could(?:\s+not|n't)?|did(?:\s+not|n't)?|will|would|have|has)\s+(?:add|schedule|create|move|resize|repeat|remove|place|apply)\b/i.test(value)
    || /\b(?:added|scheduled|created|moved|resized|repeated|removed|placed|applied)\b[\s\S]{0,80}\b(?:calendar|schedule|task|event|change)\b/i.test(value);
}

/**
 * Recovers an explicit user clock range when an AI rewrite accidentally
 * changes its meridiem or duration and creates a false school-time conflict.
 */
export function recoverExplicitRangeFromFalseSchoolConflict<
  Preview extends AssistantCommandPreviewLike,
>(options: {
  messages: readonly AssistantCommandMessage[];
  normalizedCommand: string;
  normalizedPreview: Preview;
  interpret: (command: string) => Preview;
}): AssistantCommandRecovery<Preview> {
  const {
    messages,
    normalizedCommand,
    normalizedPreview,
    interpret,
  } = options;

  if (!isSchoolOverlap(normalizedPreview)) {
    return { command: normalizedCommand, preview: normalizedPreview, recovered: false };
  }

  const recentUserMessages = messages
    .filter((message): message is AssistantCommandMessage & { role: 'user' } => message.role === 'user')
    .slice(-2)
    .reverse();

  for (const message of recentUserMessages) {
    if (!hasExplicitClockRange(message.content)) continue;
    const directPreview = interpret(message.content);
    if (directPreview.status !== 'ready' || directPreview.actions.length === 0) continue;
    return { command: message.content, preview: directPreview, recovered: true };
  }

  return { command: normalizedCommand, preview: normalizedPreview, recovered: false };
}
