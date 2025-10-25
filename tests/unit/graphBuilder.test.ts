import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GraphBuilder } from '../../src/graph/GraphBuilder.js';
import { CodeGraph } from '../../src/graph/CodeGraph.js';

describe('GraphBuilder AST enrichment', () => {
  let tempDir: string;
  let graph: CodeGraph;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-builder-'));
    const authFile = `
export class BaseService {
  teardown() {}
}

export class AuthService extends BaseService {
  authenticate() {
    return validateToken();
  }
}

export function validateToken() {
  return true;
}
`;
    await fs.writeFile(path.join(tempDir, 'auth.ts'), authFile, 'utf-8');

    const builder = new GraphBuilder(tempDir);
    graph = await builder.build();
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates extend edges between classes', () => {
    const authService = graph.getAllNodes().find(node => node.name === 'AuthService');
    const baseService = graph.getAllNodes().find(node => node.name === 'BaseService');
    expect(authService).toBeDefined();
    expect(baseService).toBeDefined();

    const extendsEdge = graph
      .getAllEdges()
      .find(edge => edge.type === 'extends' && edge.from === authService?.id);

    expect(extendsEdge).toBeDefined();
    expect(extendsEdge?.to).toBe(baseService?.id);
  });

  it('records call edges from methods to functions', () => {
    const authenticate = graph.getAllNodes().find(node => node.name === 'authenticate');
    const validateToken = graph.getAllNodes().find(node => node.name === 'validateToken');
    expect(authenticate).toBeDefined();
    expect(validateToken).toBeDefined();

    const callEdge = graph
      .getAllEdges()
      .find(edge => edge.type === 'calls' && edge.from === authenticate?.id);

    expect(callEdge).toBeDefined();
    expect(callEdge?.to).toBe(validateToken?.id);
    expect(callEdge?.metadata.source).toBe('ast');
  });

  it('attaches AST metadata to symbol nodes', () => {
    const authService = graph.getAllNodes().find(node => node.name === 'AuthService');
    expect(authService?.metadata.astType).toBeDefined();
    expect(authService?.metadata.signature).toContain('AuthService');
    expect(authService?.metadata.exported).toBe(true);
  });
});

