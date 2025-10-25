import type { GraphNode } from '../graph/CodeGraph.js';
import type { FusedCandidate } from './CandidateFusion.js';
import { normalizeScores } from './ScoreUtils.js';
import type { CrossEncoder } from './CrossEncoder.js';

export interface RerankInput {
  candidate: FusedCandidate;
  node: GraphNode | undefined;
}

export interface RerankResult {
  id: string;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  structuralScore: number;
  crossScore?: number;
}

export interface HybridRerankerOptions {
  weightSemantic?: number;
  weightLexical?: number;
  weightStructure?: number;
  weightCross?: number;
  crossEncoder?: CrossEncoder;
}

export class HybridReranker {
  private readonly weightSemantic: number;
  private readonly weightLexical: number;
  private readonly weightStructure: number;
  private readonly weightCross: number;
  private readonly crossEncoder?: CrossEncoder;

  constructor(options: HybridRerankerOptions = {}) {
    const {
      weightSemantic = 0.5,
      weightLexical = 0.3,
      weightStructure = 0.2,
      weightCross = 0.2,
      crossEncoder,
    } = options;

    this.crossEncoder = crossEncoder;

    if (this.crossEncoder) {
      const total = weightSemantic + weightLexical + weightStructure + weightCross;
      this.weightSemantic = weightSemantic / total;
      this.weightLexical = weightLexical / total;
      this.weightStructure = weightStructure / total;
      this.weightCross = weightCross / total;
    } else {
      const total = weightSemantic + weightLexical + weightStructure;
      this.weightSemantic = weightSemantic / total;
      this.weightLexical = weightLexical / total;
      this.weightStructure = weightStructure / total;
      this.weightCross = 0;
    }
  }

  async rerank(query: string, inputs: RerankInput[], topK: number): Promise<RerankResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    const semanticScores = inputs.map(input => input.candidate.sources.get('ANN') ?? 0);
    const lexicalScores = inputs.map(input => input.candidate.sources.get('BM25') ?? 0);
    const structuralSignals = inputs.map(input => this.deriveStructuralSignal(input.node));

    const normalizedSemantic = normalizeScores(semanticScores);
    const normalizedLexical = normalizeScores(lexicalScores);
    const normalizedStructural = normalizeScores(structuralSignals);

    let normalizedCross: number[] = [];
    if (this.crossEncoder) {
      const rawCross = await Promise.all(
        inputs.map(async input => {
          if (!input.node) {
            return 0;
          }
          try {
            return await this.crossEncoder!.score(query, input.node);
          } catch {
            return 0;
          }
        })
      );
      normalizedCross = normalizeScores(rawCross);
    }

    const results: RerankResult[] = inputs.map((input, index) => {
      const semantic = normalizedSemantic[index];
      const lexical = normalizedLexical[index];
      const structural = normalizedStructural[index];
      const cross = normalizedCross[index] ?? 0;

      const blended =
        semantic * this.weightSemantic +
        lexical * this.weightLexical +
        structural * this.weightStructure +
        cross * this.weightCross;

      const result: RerankResult = {
        id: input.candidate.id,
        score: blended,
        semanticScore: semantic,
        lexicalScore: lexical,
        structuralScore: structural,
      };

      if (this.crossEncoder) {
        result.crossScore = cross;
      }

      return result;
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  private deriveStructuralSignal(node: GraphNode | undefined): number {
    if (!node) {
      return 0;
    }
    const metadata = node.metadata ?? {};
    const exported = metadata.exported === true ? 1 : 0;
    const length = Math.max(node.endLine - node.startLine + 1, 1);
    const localityScore = 1 / Math.log(length + 1);
    return exported * 0.7 + localityScore * 0.3;
  }
}
