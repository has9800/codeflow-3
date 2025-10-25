export interface AnnResult {
  id: string;
  score: number;
}

interface HnswNode {
  id: string;
  level: number;
  vector: Float32Array;
  neighbors: Map<number, Set<string>>;
}

export interface AnnIndexStats {
  vectors: number;
  maxLevel: number;
  dimension: number;
}

/**
 * Minimal Hierarchical Navigable Small World (HNSW) index implementation.
 * The structure maintains layered small-world graphs that support logarithmic-time
 * approximate nearest-neighbour search while remaining fully in-process.
 */
export class HnswAnnIndex {
  private readonly nodes = new Map<string, HnswNode>();
  private readonly vectors = new Map<string, Float32Array>();
  private vectorDimension: number | null = null;
  private entryPoint: HnswNode | null = null;
  private maxLevel = 0;

  constructor(
    private readonly maxConnections = 16,
    private readonly efConstruction = 200,
    private readonly efSearch = 64
  ) {}

  add(id: string, vector: number[]): void {
    if (vector.length === 0) {
      throw new Error('Cannot index zero-length vector.');
    }

    if (this.nodes.has(id)) {
      this.remove(id);
    }

    if (this.vectorDimension === null) {
      this.vectorDimension = vector.length;
    } else if (vector.length !== this.vectorDimension) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.vectorDimension}, received ${vector.length}`
      );
    }

    const normalized = this.normalize(vector);
    const level = this.randomLevel();
    const node: HnswNode = {
      id,
      level,
      vector: normalized,
      neighbors: new Map<number, Set<string>>(),
    };

    this.nodes.set(id, node);
    this.vectors.set(id, normalized);

    if (!this.entryPoint) {
      this.entryPoint = node;
      this.maxLevel = level;
      return;
    }

    if (level > this.maxLevel) {
      this.maxLevel = level;
    }

    let entry = this.entryPoint;
    let currentLevel = this.maxLevel;

    while (entry && currentLevel > level) {
      entry = this.greedySearchLayer(normalized, entry, currentLevel);
      currentLevel -= 1;
    }

    if (!entry) {
      this.entryPoint = node;
      return;
    }

    for (let layer = Math.min(level, this.maxLevel); layer >= 0; layer -= 1) {
      const neighbours = this.searchLayer(normalized, entry, layer, this.efConstruction);
      const selected = this.selectNeighbors(normalized, neighbours, this.maxConnections);
      node.neighbors.set(layer, new Set(selected.map(neighbor => neighbor.id)));

      for (const neighbor of selected) {
        const connection = neighbor.neighbors.get(layer) ?? new Set<string>();
        connection.add(node.id);
        neighbor.neighbors.set(layer, connection);
        this.pruneNeighbors(neighbor, layer);
      }

      entry = this.greedySearchLayer(normalized, entry, layer);
    }

    if (node.level > (this.entryPoint?.level ?? 0)) {
      this.entryPoint = node;
    }
  }

  remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) {
      return;
    }

    for (const [layer, neighbours] of node.neighbors.entries()) {
      for (const neighbourId of neighbours) {
        const neighbour = this.nodes.get(neighbourId);
        if (!neighbour) continue;
        const connection = neighbour.neighbors.get(layer);
        connection?.delete(id);
      }
    }

    this.nodes.delete(id);
    this.vectors.delete(id);

    if (this.entryPoint?.id === id) {
      this.entryPoint = this.nodes.size > 0 ? this.nodes.values().next().value ?? null : null;
      this.recalculateMaxLevel();
    }
  }

  search(query: number[], topK: number, efSearch = this.efSearch): AnnResult[] {
    if (this.nodes.size === 0) {
      return [];
    }

    if (this.vectorDimension === null) {
      throw new Error('ANN index has not been initialised.');
    }

    if (query.length !== this.vectorDimension) {
      throw new Error(
        `Query dimension mismatch: expected ${this.vectorDimension}, received ${query.length}`
      );
    }

    const normalizedQuery = this.normalize(query);
    let entry = this.entryPoint;

    for (let level = this.maxLevel; level > 0 && entry; level -= 1) {
      entry = this.greedySearchLayer(normalizedQuery, entry, level);
    }

    if (!entry) {
      return [];
    }

    const candidates = this.searchLayer(
      normalizedQuery,
      entry,
      0,
      Math.max(efSearch, topK)
    );

    const scored: AnnResult[] = [];
    const seen = new Set<string>();

    for (const node of candidates) {
      const score = this.dot(normalizedQuery, node.vector);
      scored.push({ id: node.id, score });
      seen.add(node.id);
    }

    const needed = Math.min(topK, this.nodes.size) - scored.length;
    if (needed > 0) {
      for (const [id, vector] of this.vectors.entries()) {
        if (seen.has(id)) continue;
        const score = this.dot(normalizedQuery, vector);
        scored.push({ id, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  reset(): void {
    this.nodes.clear();
    this.vectors.clear();
    this.vectorDimension = null;
    this.entryPoint = null;
    this.maxLevel = 0;
  }

  stats(): AnnIndexStats {
    return {
      vectors: this.nodes.size,
      maxLevel: this.maxLevel,
      dimension: this.vectorDimension ?? 0,
    };
  }

  private randomLevel(): number {
    const levelLambda = 1 / Math.log(this.maxConnections);
    const random = Math.random();
    return Math.max(0, Math.floor(-Math.log(random) * levelLambda));
  }

  private greedySearchLayer(
    query: Float32Array,
    entry: HnswNode,
    layer: number
  ): HnswNode {
    let current = entry;
    let changed = true;

    while (changed) {
      changed = false;
      const neighbours = current.neighbors.get(layer);
      if (!neighbours || neighbours.size === 0) {
        break;
      }

      const currentDistance = this.distance(query, current.vector);

      for (const neighbourId of neighbours) {
        const neighbour = this.nodes.get(neighbourId);
        if (!neighbour) continue;
        const distance = this.distance(query, neighbour.vector);
        if (distance < currentDistance) {
          current = neighbour;
          changed = true;
        }
      }
    }

    return current;
  }

  private normalize(input: number[] | Float32Array): Float32Array {
    const vector =
      input instanceof Float32Array ? new Float32Array(input) : Float32Array.from(input);
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) {
      return new Float32Array(vector.length);
    }
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
    return vector;
  }

  private distance(a: Float32Array, b: Float32Array): number {
    return 1 - this.dot(a, b);
  }

  private dot(a: Float32Array, b: Float32Array): number {
    const length = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private searchLayer(
    query: Float32Array,
    entry: HnswNode,
    layer: number,
    ef: number
  ): HnswNode[] {
    const visited = new Set<string>();
    const candidateQueue: Array<{ node: HnswNode; distance: number }> = [];
    const bestQueue: Array<{ node: HnswNode; distance: number }> = [];

    const pushCandidate = (collection: typeof candidateQueue, item: typeof candidateQueue[0]) => {
      collection.push(item);
      collection.sort((a, b) => a.distance - b.distance);
    };

    const pushBest = (item: typeof bestQueue[0]) => {
      bestQueue.push(item);
      bestQueue.sort((a, b) => a.distance - b.distance);
      if (bestQueue.length > ef) {
        bestQueue.pop();
      }
    };

    const entryDistance = this.distance(query, entry.vector);
    pushCandidate(candidateQueue, { node: entry, distance: entryDistance });
    pushBest({ node: entry, distance: entryDistance });
    visited.add(entry.id);

    while (candidateQueue.length > 0) {
      const current = candidateQueue.shift()!;
      const worstBest = bestQueue[bestQueue.length - 1];
      if (worstBest && current.distance > worstBest.distance) {
        break;
      }

      const neighbours = current.node.neighbors.get(layer);
      if (!neighbours) {
        continue;
      }

      for (const neighbourId of neighbours) {
        if (visited.has(neighbourId)) {
          continue;
        }
        visited.add(neighbourId);
        const neighbour = this.nodes.get(neighbourId);
        if (!neighbour) continue;

        const distance = this.distance(query, neighbour.vector);
        const worst = bestQueue[bestQueue.length - 1];
        if (!worst || bestQueue.length < ef || distance < worst.distance) {
          pushCandidate(candidateQueue, { node: neighbour, distance });
          pushBest({ node: neighbour, distance });
        }
      }
    }

    return bestQueue
      .sort((a, b) => a.distance - b.distance)
      .map(entry => entry.node);
  }

  private selectNeighbors(
    query: Float32Array,
    candidates: HnswNode[],
    max: number
  ): HnswNode[] {
    return candidates
      .map(candidate => ({
        node: candidate,
        distance: this.distance(query, candidate.vector),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, max)
      .map(entry => entry.node);
  }

  private pruneNeighbors(node: HnswNode, layer: number): void {
    const neighbours = node.neighbors.get(layer);
    if (!neighbours) {
      return;
    }

    if (neighbours.size <= this.maxConnections) {
      return;
    }

    const ordered = Array.from(neighbours)
      .map(id => {
        const neighbour = this.nodes.get(id);
        if (!neighbour) {
          return null;
        }
        return {
          id,
          distance: this.distance(node.vector, neighbour.vector),
        };
      })
      .filter(
        (entry): entry is { id: string; distance: number } => entry !== null
      )
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.maxConnections);

    node.neighbors.set(layer, new Set(ordered.map(entry => entry.id)));
  }

  private recalculateMaxLevel(): void {
    let max = 0;
    let best: HnswNode | null = null;
    for (const node of this.nodes.values()) {
      if (node.level > max) {
        max = node.level;
        best = node;
      }
    }
    this.maxLevel = max;
    if (best) {
      this.entryPoint = best;
    }
  }
}


