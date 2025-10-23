import React, { useState, useEffect, useMemo } from 'react';
import type { Key } from 'ink';
import { Box, Text, useApp, useInput } from 'ink';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { FileDiffReview } from './components/FileDiffReview.js';
import { InputBar } from './components/InputBar.js';
import { StatusIndicator } from './components/StatusIndicator.js';
import {
  DependencyAwareRetriever,
  type DependencyContext,
} from '../retrieval/DependencyAwareRetriever.js';
import { TargetResolver } from '../retrieval/TargetResolver.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import {
  OpenRouterClient,
  type ChatRequest,
  type ChatChunk,
} from '../llm/OpenRouterClient.js';
import { FileApplier, type FileEdit } from '../files/FileApplier.js';
import { parseFileEdits } from '../files/EditParser.js';
import { RulesLoader } from '../rules/RulesLoader.js';
import { CodeGraph, type GraphNode } from '../graph/CodeGraph.js';
import { UsageTracker } from '../analytics/UsageTracker.js';

type ConversationRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: ConversationRole;
  content: string;
  timestamp: number;
}

export interface AppProps {
  graph: CodeGraph;
  apiKey: string;
  model: string;
  workingDir: string;
  offline?: boolean;
}

const TOKEN_BUDGET = 6000;

interface ChatClient {
  chat(request: ChatRequest): Promise<AsyncIterable<ChatChunk>>;
}

class OfflineClient implements ChatClient {
  async chat(request: ChatRequest): Promise<AsyncIterable<ChatChunk>> {
    const lastUser = [...request.messages].reverse().find(msg => msg.role === 'user');
    const prompt = lastUser?.content ?? '';

    async function* generator(): AsyncIterable<ChatChunk> {
      const chunk: ChatChunk = {
        id: 'offline',
        choices: [
          {
            delta: {
              content: `\n[Offline mode]\nPretend response for:\n${prompt}\n`,
            },
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
      yield chunk;
    }

    return generator();
  }
}

export function App({ graph, apiKey, model, workingDir, offline = false }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [pendingEdits, setPendingEdits] = useState<FileEdit[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [tokensSaved, setTokensSaved] = useState(0);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [status, setStatus] = useState('Ready');
  const [interruptMode, setInterruptMode] = useState(false);

  const embedder = useMemo(() => new QwenEmbedder(), []);
  const retriever = useMemo(
    () => new DependencyAwareRetriever(graph, { embedder }),
    [graph, embedder]
  );
  const resolver = useMemo(() => new TargetResolver(graph, embedder), [graph, embedder]);
  const client = useMemo<ChatClient>(
    () => (offline ? new OfflineClient() : new OpenRouterClient(apiKey)),
    [offline, apiKey]
  );
  const fileApplier = useMemo(() => new FileApplier(workingDir), [workingDir]);
  const rulesLoader = useMemo(() => new RulesLoader(workingDir), [workingDir]);
  const tracker = useMemo(() => new UsageTracker(), []);

  useEffect(() => {
    retriever.initialize().catch(error => {
      setStatus(`Failed to initialise embeddings: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [retriever]);

  useInput((_, key: Key) => {
    if (key.escape && streaming) {
      setInterruptMode(true);
      setStatus('Interrupted - type your feedback');
    } else if (key.escape) {
      exit();
    }
  });

  const processCommand = (raw: string): boolean => {
    if (!raw.startsWith('/')) return false;
    const trimmed = raw.slice(1).trim();
    if (trimmed.length === 0) return true;

    const [command] = trimmed.split(/\s+/);
    const arg = trimmed.slice(command.length).trim();

    switch (command.toLowerCase()) {
      case 'file':
      case 'focus': {
        if (!arg) {
          setStatus('Usage: /file <relative-path>');
          return true;
        }
        setActiveFilePath(arg);
        setRecentFiles(prev => {
          const next = [arg, ...prev.filter(item => item !== arg)];
          return next.slice(0, 5);
        });
        setStatus(`Focusing on ${arg}`);
        break;
      }
      case 'where': {
        if (activeFilePath) {
          setStatus(`Current focus: ${activeFilePath}`);
        } else {
          setStatus('No active file selected yet.');
        }
        break;
      }
      default: {
        setStatus(`Unknown command: /${command}`);
      }
    }

    return true;
  };

  const handleSubmit = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || streaming) return;

    if (processCommand(trimmed)) {
      setInput('');
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setStreaming(true);
    setStatus('Resolving target files...');

    try {
      const resolution = await resolver.resolve(trimmed, {
        recentPaths: [activeFilePath, ...recentFiles].filter(Boolean),
        limit: 3,
      });

      if (!resolution.primary) {
        setStatus('Could not infer which file to edit. Use /file <path> or mention a symbol.');
        const clarification: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content:
            'I could not determine which files you want to edit. Try `/file path/to/file.ts` or include the function name in your request.',
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, clarification]);
        return;
      }

      const targetPath = resolution.primary.path;
      setActiveFilePath(targetPath);
      setRecentFiles(prev => {
        const next = [targetPath, ...prev.filter(item => item !== targetPath)];
        return next.slice(0, 5);
      });

      const rules = await rulesLoader.load();
      const retrievalResult = await retriever.buildContextForChange(
        trimmed,
        targetPath,
        TOKEN_BUDGET,
        { candidateFilePaths: resolution.candidates.map(candidate => candidate.path) }
      );

      const inferredReason = resolution.primary.reasons[0] ?? 'Heuristic match';
      setStatus(
        `Context (${targetPath} • ${inferredReason}): ` +
          `${retrievalResult.targetNodes.length} targets, ` +
          `${retrievalResult.backwardDeps.length} dependents, ` +
          `${retrievalResult.forwardDeps.length} dependencies`
      );
      setTokensSaved(prev => prev + retrievalResult.tokensSaved);
      setTokensUsed(prev => prev + retrievalResult.tokensUsed);

      const systemMessage = {
        role: 'system' as const,
        content: rules,
        cache_control: { type: 'ephemeral' as const },
      };

      const contextMessage = {
        role: 'user' as const,
        content: `${formatDependencyContext(retrievalResult)}\n\n${trimmed}`,
      };

      const stream = await client.chat({
        model,
        messages: [systemMessage, contextMessage],
        stream: true,
      });

      let assistantContent = '';
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      setStatus('Waiting for model...');

      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) {
          assistantContent += chunk.choices[0].delta.content;
          setMessages(prev =>
            prev.map(message =>
              message.id === assistantMessage.id ? { ...message, content: assistantContent } : message
            )
          );
        }

        const totalTokensUsed = chunk.usage?.total_tokens;
        if (typeof totalTokensUsed === 'number') {
          setTokensUsed(prev => prev + totalTokensUsed);
        }
      }

      const edits = parseFileEdits(assistantContent);
      if (edits.length > 0) {
        setPendingEdits(edits);
        setStatus(`${edits.length} file changes proposed`);
      } else {
        setStatus('Ready');
      }

      await tracker.track({
        tokensUsed: retrievalResult.tokensUsed,
        tokensSaved: retrievalResult.tokensSaved,
        model,
        searchType: retrievalResult.searchType,
      });
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setStatus('Error occurred');
    } finally {
      setStreaming(false);
      setInterruptMode(false);
    }
  };

  const handleApplyEdit = async (edit: FileEdit) => {
    setStatus(`Applying changes to ${edit.path}...`);
    const result = await fileApplier.apply(edit);

    if (result.success) {
      setPendingEdits(prev => prev.filter(e => e.path !== edit.path));
      setStatus(result.syntaxValid ? 'Changes applied' : 'Applied with syntax warnings');
    } else {
      setStatus(`Failed to apply: ${result.error}`);
    }
  };

  const handleApplyAll = async () => {
    for (const edit of pendingEdits) {
      await handleApplyEdit(edit);
    }
  };

  const handleSkipEdit = (edit: FileEdit) => {
    setPendingEdits(prev => prev.filter(e => e.path !== edit.path));
    setStatus('Change skipped');
  };

  const savingsPercent = tokensUsed > 0 ? Math.round((tokensSaved / (tokensUsed + tokensSaved)) * 100) : 0;

  return (
    <Box flexDirection="column" height="100%">
      <Header model={model} tokensSaved={tokensSaved} savingsPercent={savingsPercent} status={status} />

      <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1}>
        <MessageList messages={messages} streaming={streaming} />
      </Box>

      {pendingEdits.length > 0 && (
        <Box flexDirection="column" borderStyle="single" marginX={1} marginY={1}>
          {pendingEdits.map((edit, idx) => (
            <FileDiffReview key={idx} edit={edit} onApply={() => handleApplyEdit(edit)} onSkip={() => handleSkipEdit(edit)} />
          ))}
          <Box marginTop={1} gap={2}>
            <Text color="green">Apply all changes</Text>
            <Text color="yellow">Review each change</Text>
            <Text dimColor>ESC: Stop & reply</Text>
          </Box>
        </Box>
      )}

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={streaming && !interruptMode}
        placeholder={streaming ? 'Press ESC to interrupt...' : 'What would you like to do?'}
      />

      {streaming && <StatusIndicator text={status} />}
    </Box>
  );
}

function formatDependencyContext(ctx: DependencyContext): string {
  return [
    '# Code Context',
    '',
    '## Target (being modified):',
    ctx.targetNodes.map(formatNode).join('\n\n') || 'None',
    '',
    '## Dependencies (what this code imports/calls):',
    ctx.forwardDeps.map(formatNode).join('\n\n') || 'None',
    '',
    '## Dependents (who imports/calls this code - MUST update these too):',
    ctx.backwardDeps.map(formatNode).join('\n\n') || 'None',
    '',
    '## Related context:',
    ctx.relatedByQuery.map(formatNode).join('\n\n') || 'None',
  ].join('\n');
}

function formatNode(node: GraphNode): string {
  return [
    `${node.type.toUpperCase()}: ${node.name}`,
    `File: ${node.path} (lines ${node.startLine}-${node.endLine})`,
    '```',
    node.content.trim(),
    '```',
  ].join('\n');
}
