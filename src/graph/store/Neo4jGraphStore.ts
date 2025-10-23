import neo4j, { Driver, isInt, Session } from 'neo4j-driver';
import { nanoid } from 'nanoid';
import { CodeGraph, type GraphEdge, type GraphNode } from '../CodeGraph.js';
import type { GraphStore, GraphStoreConfig } from './GraphStore.js';
import { logger } from '../../utils/logger.js';

type StoredNode = GraphNode & { namespace: string; snapshotId: string; validFrom: number; validTo: number | null };

type StoredEdge = GraphEdge & {
  namespace: string;
  snapshotId: string;
  validFrom: number;
  validTo: number | null;
};

const EDGE_LABELS: Record<GraphEdge['type'], string> = {
  contains: 'CONTAINS',
  imports: 'IMPORTS',
  calls: 'CALLS',
  references: 'REFERENCES',
};

const REVERSE_EDGE_LABELS = Object.fromEntries(
  Object.entries(EDGE_LABELS).map(([k, v]) => [v, k])
) as Record<string, GraphEdge['type']>;

export class Neo4jGraphStore implements GraphStore {
  private readonly namespace: string;
  private readonly driver: Driver;
  private initialized = false;
  private connectivityVerified = false;

  constructor(private readonly config: GraphStoreConfig) {
    if (!config.uri || !config.username || !config.password) {
      throw new Error(
        'Neo4j configuration requires uri, username, and password fields.'
      );
    }

    this.namespace = config.namespace ?? process.cwd();
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
      {
        userAgent: 'CodeFlow-CLI',
        maxConnectionPoolSize: config.maxConnectionPoolSize ?? 50,
        connectionTimeout: config.connectionTimeoutMs ?? 15000,
      }
    );
  }

  private async verifyConnectivity(): Promise<void> {
    if (this.connectivityVerified) {
      return;
    }

    await this.driver.verifyConnectivity();
    this.connectivityVerified = true;
  }

  private async withSession<T>(operation: (session: Session) => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown = undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const session = this.driver.session();

      try {
        await this.verifyConnectivity();
        const result = await operation(session);
        await session.close();
        return result;
      } catch (error) {
        lastError = error;
        await session.close().catch(() => {});

        if (attempt === attempts) {
          throw error;
        }

        logger.warn('Neo4j operation failed, retrying...', {
          attempt,
          message: error instanceof Error ? error.message : String(error),
        });

        await delay(Math.min(500 * attempt, 2000));
      }
    }

    throw lastError ?? new Error('Neo4j operation failed after retries.');
  }

  async load(): Promise<CodeGraph | null> {
    await this.ensureSetup();
    return this.withSession(async (session) => {
      const snapshotId = await this.getActiveSnapshotId(session);
      if (!snapshotId) {
        return null;
      }

      const graph = new CodeGraph();
      const nodes = await session.readTransaction(async (tx) => {
        const result = await tx.run(
          `
            MATCH (n:CodeNode {namespace: $namespace, snapshotId: $snapshotId})
            RETURN n
          `,
          { namespace: this.namespace, snapshotId }
        );
        return result.records.map((record) => record.get('n'));
      });

      for (const neoNode of nodes) {
        const props = neoNode.properties as Record<string, unknown>;
        graph.upsertNode({
          id: props.nodeId as string,
          type: props.type as GraphNode['type'],
          name: props.name as string,
          path: props.path as string,
          content: props.content as string,
          startLine: toNumber(props.startLine),
          endLine: toNumber(props.endLine),
          embedding: (props.embedding as number[] | null) ?? undefined,
          metadata: parseStoredMetadata(props.metadata),
        });
      }

      const edges = await session.readTransaction(async (tx) => {
        const result = await tx.run(
          `
            MATCH (from:CodeNode {namespace: $namespace, snapshotId: $snapshotId})-[r]->(to:CodeNode {namespace: $namespace, snapshotId: $snapshotId})
            RETURN from.nodeId AS fromId, to.nodeId AS toId, type(r) AS relType, r
          `,
          { namespace: this.namespace, snapshotId }
        );
        return result.records;
      });

      for (const record of edges) {
        const relProps = record.get('r').properties as Record<string, unknown>;
        const relType = record.get('relType') as string;
        const mappedType = REVERSE_EDGE_LABELS[relType];
        if (!mappedType) continue;

        graph.upsertEdge({
          id: relProps.edgeId as string,
          from: record.get('fromId') as string,
          to: record.get('toId') as string,
          type: mappedType,
          metadata: parseStoredMetadata(relProps.metadata),
        });
      }

      return graph;
    });
  }

  async save(graph: CodeGraph): Promise<void> {
    await this.ensureSetup();
    await this.withSession(async (session) => {
      const now = Date.now();
      const snapshotId = nanoid();

      const nodes = graph.getAllNodes().map((node) => ({
        nodeId: node.id,
        type: node.type,
        name: node.name,
        path: node.path,
        content: node.content,
        startLine: node.startLine,
        endLine: node.endLine,
        embedding: node.embedding ?? null,
        metadata: sanitizeForNeo4j(node.metadata ?? {}) as Record<string, unknown>,
      }));

      const edgesByType = Object.fromEntries(
        Object.keys(EDGE_LABELS).map((type) => [type, [] as StoredEdge[]])
      ) as Record<GraphEdge['type'], StoredEdge[]>;

      for (const edge of graph.getAllEdges()) {
        edgesByType[edge.type].push({
          ...edge,
          namespace: this.namespace,
          snapshotId,
          validFrom: now,
          validTo: null,
          metadata: sanitizeForNeo4j(edge.metadata ?? {}) as Record<string, unknown>,
        });
      }

      await session.writeTransaction(async (tx) => {
        await tx.run(
          `
            MATCH (s:GraphSnapshot {namespace: $namespace})
            WHERE s.validTo IS NULL
            SET s.validTo = $now
          `,
          { namespace: this.namespace, now }
        );

        await tx.run(
          `
            CREATE (s:GraphSnapshot {
              id: $snapshotId,
              namespace: $namespace,
              validFrom: $now,
              validTo: null
            })
          `,
          { snapshotId, namespace: this.namespace, now }
        );

        if (nodes.length > 0) {
          await tx.run(
            `
              UNWIND $nodes AS node
              CREATE (n:CodeNode {
                nodeId: node.nodeId,
                snapshotId: $snapshotId,
                namespace: $namespace,
                type: node.type,
                name: node.name,
                path: node.path,
                content: node.content,
                startLine: node.startLine,
                endLine: node.endLine,
                embedding: node.embedding,
                metadata: node.metadata,
                validFrom: $now,
                validTo: null
              })
            `,
            {
              nodes: nodes.map((node) => ({ ...node, metadata: JSON.stringify(node.metadata) })),
              snapshotId,
              namespace: this.namespace,
              now,
            }
          );
        }

        for (const [type, relLabel] of Object.entries(EDGE_LABELS)) {
          const typedEdges = edgesByType[type as GraphEdge['type']];
          if (!typedEdges || typedEdges.length === 0) continue;

          await tx.run(
            `
              UNWIND $edges AS edge
              MATCH (from:CodeNode {nodeId: edge.from, snapshotId: $snapshotId, namespace: $namespace})
              MATCH (to:CodeNode {nodeId: edge.to, snapshotId: $snapshotId, namespace: $namespace})
              CREATE (from)-[r:${relLabel} {
                edgeId: edge.id,
                snapshotId: $snapshotId,
                namespace: $namespace,
                metadata: edge.metadata,
                validFrom: $now,
                validTo: null
              }]->(to)
            `,
            {
              edges: typedEdges.map((edge) => ({ ...edge, metadata: JSON.stringify(edge.metadata) })),
              snapshotId,
              namespace: this.namespace,
              now,
            }
          );
        }
      });
    });
  }

  async clear(): Promise<void> {
    await this.ensureSetup();
    await this.withSession(async (session) => {
      await session.writeTransaction(async (tx) => {
        await tx.run(
          `
            MATCH (n:CodeNode {namespace: $namespace})
            DETACH DELETE n
          `,
          { namespace: this.namespace }
        );
        await tx.run(
          `
            MATCH (s:GraphSnapshot {namespace: $namespace})
            DETACH DELETE s
          `,
          { namespace: this.namespace }
        );
      });
    });
  }

  private async ensureSetup(): Promise<void> {
    if (this.initialized) return;

    await this.withSession(async (session) => {
      await session.writeTransaction(async (tx) => {
        await tx.run(
          'CREATE CONSTRAINT IF NOT EXISTS FOR (s:GraphSnapshot) REQUIRE s.id IS UNIQUE'
        );
        await tx.run(
          'CREATE INDEX IF NOT EXISTS FOR (n:CodeNode) ON (n.namespace, n.snapshotId, n.nodeId)'
        );
      });
    });

    this.initialized = true;
  }

  private async getActiveSnapshotId(session: Session): Promise<string | null> {
    const result = await session.readTransaction(async (tx) => {
      const res = await tx.run(
        `
          MATCH (s:GraphSnapshot {namespace: $namespace})
          WHERE s.validTo IS NULL
          RETURN s.id AS id
          ORDER BY s.validFrom DESC
          LIMIT 1
        `,
        { namespace: this.namespace }
      );
      return res.records[0]?.get('id') ?? null;
    });
    return result;
  }
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (isInt(value)) {
    return value.toNumber();
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return Number(value);
}

function sanitizeForNeo4j(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeForNeo4j);
  }

  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      result[String(key)] = sanitizeForNeo4j(entry);
    }
    return result;
  }

  if (value instanceof Set) {
    return Array.from(value).map(sanitizeForNeo4j);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeForNeo4j(entry);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
    return result;
  }

  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }

  return String(value);
}

function parseStoredMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { value };
    }
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = entry;
    }
    return result;
  }

  return {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
