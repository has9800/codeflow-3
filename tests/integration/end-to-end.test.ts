import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { GraphBuilder } from '../../src/graph/GraphBuilder.js';
import { GraphManager } from '../../src/graph/GraphManager.js';
import { InMemoryGraphStore } from '../../src/graph/store/InMemoryGraphStore.js';
import { TargetResolver } from '../../src/retrieval/TargetResolver.js';
import { DependencyAwareRetriever } from '../../src/retrieval/DependencyAwareRetriever.js';
import { PromptBuilder } from '../../src/llm/PromptBuilder.js';
import { ResponseParser } from '../../src/llm/ResponseParser.js';

const AUTH_FILE = `export async function authenticateUser(name: string, password: string) {
  return name && password ? { name } : null;
}

export function handleLogin() {
  return authenticateUser('demo', 'secret');
}
`;

const UI_FILE = `import { handleLogin } from './auth';

export function render() {
  return handleLogin();
}
`;

describe('End-to-end workflow', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-e2e-'));
    await fs.writeFile(path.join(tempDir, 'auth.ts'), AUTH_FILE, 'utf-8');
    await fs.writeFile(path.join(tempDir, 'ui.ts'), UI_FILE, 'utf-8');
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('builds the graph, retrieves context, and parses an assistant response', async () => {
    const builder = new GraphBuilder(tempDir);
    const graph = await builder.build();

    const manager = new GraphManager({
      rootDir: tempDir,
      store: new InMemoryGraphStore(),
      builder: { build: async () => graph },
    });
    await manager.initialize(true);

    const resolver = new TargetResolver(graph, {
      embed: async () => [0.01, 0.02, 0.03],
    });
    const resolution = await resolver.resolve('Fix authenticateUser logic');
    expect(resolution.primary?.path).toContain('auth.ts');

    const retriever = new DependencyAwareRetriever(graph, {
      embedder: {
        initialize: async () => {},
        embed: async () => [0.1, 0.1, 0.8],
      },
    });
    await retriever.initialize();

    const context = await retriever.buildContextForChange(
      'adjust authenticateUser validation',
      'auth.ts'
    );

    expect(context.targetNodes.some(node => node.name === 'authenticateUser')).toBe(true);
    expect(context.backwardDeps.some(node => node.name === 'handleLogin')).toBe(true);

    const prompt = new PromptBuilder().build({
      userMessage: 'Ensure missing credentials throw errors.',
      dependencyContext: context.formattedContext,
      rules: '# Rules\n- Avoid breaking callers',
    });

    expect(prompt[0]?.role).toBe('system');
    expect(prompt[prompt.length - 1]?.content).toContain('missing credentials');

    const sampleResponse = `Summary: Added validation\n\n` +
      'auth.ts\n```ts\nexport async function authenticateUser(name: string, password: string) {\n' +
      '  if (!name || !password) {\n    throw new Error("Missing credentials");\n  }\n' +
      '  return { name };\n}\n```\n';

    const parsed = new ResponseParser().parse(sampleResponse);
    expect(parsed.summary).toContain('Summary');
    expect(parsed.codeBlocks).toHaveLength(1);
  });
});
