import { describe, it, expect } from 'vitest';
import { EvaluationAgent } from '../../src/orchestration/EvaluationAgent.js';
import type { TargetResolution } from '../../src/retrieval/TargetResolver.js';
import type { DependencyContext } from '../../src/retrieval/DependencyAwareRetriever.js';

function createResolution(paths: string[]): TargetResolution {
  const candidates = paths.map((path, index) => ({
    path,
    score: 1 - index * 0.1,
    nodes: [],
    reasons: [],
    sourceScores: { BM25: 0.5 },
    scoreBreakdown: {
      fused: 0.5,
      semantic: 0.4,
      lexical: 0.3,
      structural: 0.2,
    },
  }));
  return {
    primary: candidates[0],
    candidates,
  };
}

function createContext(primaryPath: string, candidatePaths: string[], tokens: { used: number; budget: number }): DependencyContext {
  const node = {
    id: `${primaryPath}#node`,
    type: 'function' as const,
    name: 'sample',
    path: primaryPath,
    content: 'function sample() {}',
    startLine: 1,
    endLine: 10,
    metadata: { exported: true },
  };

  return {
    targetNodes: [node],
    forwardDeps: [],
    backwardDeps: [],
    relatedByQuery: [],
    totalTokens: tokens.used,
    tokensUsed: tokens.used,
    formattedContext: '',
    tokensSaved: Math.max(0, tokens.budget - tokens.used),
    savingsPercent: tokens.budget === 0 ? 0 : ((tokens.budget - tokens.used) / tokens.budget) * 100,
    searchType: 'dependency-aware',
    primaryFilePath: primaryPath,
    candidateFilePaths: candidatePaths,
    telemetry: {
      targetResolution: {
        primaryPath,
        candidateCount: candidatePaths.length,
        sourceScores: { BM25: 0.5 },
        aggregateSourceScores: { BM25: 1 },
      },
      tokens: {
        budget: tokens.budget,
        used: tokens.used,
        saved: Math.max(0, tokens.budget - tokens.used),
        savingsPercent: tokens.budget === 0 ? 0 : ((tokens.budget - tokens.used) / tokens.budget) * 100,
      },
    },
  };
}

describe('EvaluationAgent', () => {
  it('marks evaluation as pass when precision and recall meet thresholds', () => {
    const agent = new EvaluationAgent({ precisionThreshold: 0.5, recallThreshold: 0.5, maxK: 2 });
    const resolution = createResolution(['src/auth.ts', 'src/login.ts', 'src/ui.ts']);
    const context = createContext('src/auth.ts', resolution.candidates.map(c => c.path), { used: 3000, budget: 6000 });

    const decision = agent.evaluate({
      query: 'refactor authenticateUser',
      resolution,
      context,
      groundTruth: { relevantPaths: ['src/auth.ts', 'src/login.ts'] },
      iteration: 1,
    });

    expect(decision.pass).toBe(true);
    expect(decision.actions).toHaveLength(0);
    expect(decision.metrics.precisionAtK).toBeCloseTo(1, 5);
    expect(decision.metrics.recallAtK).toBeCloseTo(1, 5);
  });

  it('suggests expansions when metrics fall below thresholds', () => {
    const agent = new EvaluationAgent({ precisionThreshold: 0.9, recallThreshold: 1, maxK: 3, coverageThreshold: 0.6 });
    const resolution = createResolution(['src/auth.ts', 'src/other.ts']);
    const context = createContext('src/auth.ts', ['src/auth.ts'], { used: 5800, budget: 6000 });

    const decision = agent.evaluate({
      query: 'improve login flow',
      resolution,
      context,
      groundTruth: { relevantPaths: ['src/auth.ts', 'src/login.ts', 'src/ui.ts'] },
      iteration: 1,
    });

    expect(decision.pass).toBe(false);
    expect(decision.actions).toEqual(
      expect.arrayContaining([
        'enable_cross_encoder',
        'increase_walk_depth',
        'expand_related',
        'increase_token_budget',
      ])
    );
    expect(decision.notes.length).toBeGreaterThan(0);
  });
});
