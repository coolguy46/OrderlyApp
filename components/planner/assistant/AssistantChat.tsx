'use client';

import { Fragment, type ReactNode, type RefObject } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface AssistantChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}
interface AssistantUsage {
  remainingDaily: number;
  remainingMonthly: number;
}

interface AssistantChatProps {
  messages: readonly AssistantChatMessage[];
  command: string;
  onCommandChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onNewChat: () => void;
  isThinking: boolean;
  examples: readonly string[];
  onExampleClick: (example: string) => void;
  usage: AssistantUsage | null;
  showQuota: boolean;
  quotaExhausted: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
}

type AssistantMessageBlock =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'unordered-list' | 'ordered-list'; items: string[] };

const BULLET_ITEM_PATTERN = /^\s*[-+*]\s+(.+)$/;
const NUMBERED_ITEM_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const BOLD_PATTERN = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__)/g;

function normalizeAssistantMessageLines(content: string): string[] {
  const recoveredBullets = content
    .replace(/\r\n?/g, '\n')
    // Older stored replies were flattened by the API parser. Recover the
    // provider's most obvious inline list boundaries without interpreting HTML.
    .replace(/[ \t]+(?=[-+*]\s+(?:\*\*|__))/g, '\n');
  return recoveredBullets.split('\n').flatMap(line => {
    const hasNumberedListStart = /(?:^|[ \t])1[.)]\s+(?:\*\*|__|[A-Z])/.test(line);
    return hasNumberedListStart
      ? line.replace(/[ \t]+(?=\d+[.)]\s+(?:\*\*|__|[A-Z]))/g, '\n').split('\n')
      : [line];
  });
}

function parseAssistantMessageBlocks(content: string): AssistantMessageBlock[] {
  const blocks: AssistantMessageBlock[] = [];
  let paragraphLines: string[] = [];
  let canContinueList = false;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paragraphLines });
      paragraphLines = [];
    }
  };
  for (const rawLine of normalizeAssistantMessageLines(content)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      canContinueList = false;
      continue;
    }

    const bullet = line.match(BULLET_ITEM_PATTERN);
    const numbered = line.match(NUMBERED_ITEM_PATTERN);
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? 'unordered-list' : 'ordered-list';
      const item = (bullet || numbered)?.[1] || line;
      const previous = canContinueList ? blocks.at(-1) : null;
      if (previous && previous.kind === kind) {
        previous.items.push(item);
      } else {
        blocks.push({ kind, items: [item] });
      }
      canContinueList = true;
      continue;
    }

    canContinueList = false;
    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

function renderInlineBold(content: string, keyPrefix: string): ReactNode[] {
  const result: ReactNode[] = [];
  let start = 0;
  let match: RegExpExecArray | null;
  BOLD_PATTERN.lastIndex = 0;

  while ((match = BOLD_PATTERN.exec(content)) !== null) {
    if (match.index > start) result.push(content.slice(start, match.index));
    result.push(
      <strong key={`${keyPrefix}-bold-${match.index}`} className="font-semibold">
        {match[0].slice(2, -2)}
      </strong>,
    );
    start = match.index + match[0].length;
  }
  if (start < content.length) result.push(content.slice(start));
  return result;
}

function AssistantMessageContent({ content }: { content: string }) {
  const blocks = parseAssistantMessageBlocks(content);
  return (
    <div className="space-y-3">
      {blocks.map((block, blockIndex) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={`paragraph-${blockIndex}`}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={`paragraph-${blockIndex}-line-${lineIndex}`}>
                  {lineIndex > 0 && <br />}
                  {renderInlineBold(line, `paragraph-${blockIndex}-line-${lineIndex}`)}
                </Fragment>
              ))}
            </p>
          );
        }

        const List = block.kind === 'ordered-list' ? 'ol' : 'ul';
        return (
          <List
            key={`${block.kind}-${blockIndex}`}
            className={cn('space-y-1 pl-5', block.kind === 'ordered-list' ? 'list-decimal' : 'list-disc')}
          >
            {block.items.map((item, itemIndex) => (
              <li key={`${block.kind}-${blockIndex}-item-${itemIndex}`}>
                {renderInlineBold(item, `${block.kind}-${blockIndex}-item-${itemIndex}`)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

export function AssistantChat({
  messages,
  command,
  onCommandChange,
  onSubmit,
  onStop,
  onNewChat,
  isThinking,
  examples,
  onExampleClick,
  inputRef,
  endRef,
}: AssistantChatProps) {
  return (
    <Card className="flex h-[68vh] min-h-[560px] max-h-[760px] flex-col overflow-hidden border-primary/20 bg-card/75 shadow-sm backdrop-blur-sm">
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border/50 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <CardTitle>Chat with Orderly</CardTitle>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">Ask about your week or change your schedule.</p>
          </div>
        </div>
        {(messages.length > 0 || isThinking) && (
          <Button type="button" variant="ghost" size="sm" onClick={onNewChat}>
            New chat
          </Button>
        )}
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-xl font-semibold tracking-tight">What can I help you plan?</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Ask a question about your workload, find an open time, or tell me what you want to change.
            </p>
            <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
              {examples.map(example => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onExampleClick(example)}
                  className="rounded-full border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-5">
            {messages.map(message => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('min-w-0', message.role === 'user' ? 'max-w-[82%]' : 'max-w-[92%]')}>
                  {message.role === 'assistant' && (
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <Sparkles className="h-3 w-3 text-primary" /> Orderly
                    </p>
                  )}
                  <div className={cn(
                    'break-words rounded-2xl px-4 py-3 text-sm leading-6',
                    message.role === 'user'
                      ? 'rounded-br-md bg-primary text-primary-foreground'
                      : 'rounded-bl-md border border-border/60 bg-muted/45 text-foreground',
                  )}>
                    {message.role === 'assistant'
                      ? <AssistantMessageContent content={message.content} />
                      : <span className="whitespace-pre-wrap">{message.content}</span>}
                  </div>
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="flex justify-start" aria-live="polite">
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <Sparkles className="h-3 w-3 text-primary" /> Orderly
                  </p>
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border/60 bg-muted/45 px-4 py-3 text-sm text-muted-foreground">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
                    <span className="ml-1">Thinking</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </CardContent>

      <div className="sticky bottom-0 border-t border-border/50 bg-background/90 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-card px-3 py-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <Textarea
              ref={inputRef}
              value={command}
              onChange={event => onCommandChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (!isThinking) onSubmit();
                }
              }}
              placeholder="Message Orderly…"
              className="max-h-36 min-h-11 flex-1 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0"
              aria-label="Message Orderly"
            />
            {isThinking ? (
              <Button type="button" size="icon" variant="outline" onClick={onStop} aria-label="Stop response" className="mb-0.5 shrink-0 rounded-xl">
                <X className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                onClick={onSubmit}
                disabled={!command.trim()}
                aria-label="Send message"
                className="mb-0.5 shrink-0 rounded-xl"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Orderly can make mistakes. Calendar drafts are saved only after you confirm them.
          </p>
        </div>
      </div>
    </Card>
  );
}
