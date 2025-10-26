import type { TargetResolution } from '../retrieval/TargetResolver.js';
import type { DependencyContext } from '../retrieval/DependencyAwareRetriever.js';

export interface GroundTruth {
  relevantPaths: string[];
}

export type EvaluationAction =
  | 'increase_token_budget'
  | 'increase_walk_depth'
  | 'expand_related'
  | 'enable_cross_encoder';

export interface EvaluationAgentConfig {
  precisionThreshold: number;
  recallThreshold: number;
  maxK?: number;
  coverageThreshold?: number;
}

export interface EvaluationMetrics {
  precisionAtK: number;
  recallAtK: number;
  f1: number;
  coverage: number;
  candidateCount: number;
}

export interface EvaluationDecision {
  metrics: EvaluationMetrics;
  pass: boolean;
  actions: EvaluationAction[];
  notes: string[];
}

export interface EvaluationSample {
  query: string;
  resolution: TargetResolution;
  context: DependencyContext;
  groundTruth: GroundTruth;
  iteration: number;
}

export class EvaluationAgent {
  constructor(private readonly config: EvaluationAgentConfig) {}

  evaluate(sample: EvaluationSample): EvaluationDecision {
    const candidates = sample.resolution.candidates;
    const truth = new Set(sample.groundTruth.relevantPaths.map(path => path.trim()));
    const k = Math.max(1, Math.min(this.config.maxK ?? candidates.length, candidates.length));
    const topK = candidates.slice(0, k);

    let hits = 0;
    for (const candidate of topK) {
      if (truth.has(candidate.path)) {
        hits += 1;
      }
    }

    const precisionAtK = k === 0 ? 0 : hits / k;
    const recallAtK = truth.size === 0 ? 1 : hits / truth.size;
    const f1 = precisionAtK + recallAtK === 0 ? 0 : (2 * precisionAtK * recallAtK) / (precisionAtK + recallAtK);

    const coverage = sample.context.telemetry.tokens.budget === 0
      ? 0
      : sample.context.telemetry.tokens.used / sample.context.telemetry.tokens.budget;

    const metrics: EvaluationMetrics = {
      precisionAtK,
      recallAtK,
      f1,
      coverage,
      candidateCount: candidates.length,
    };

    const actions: EvaluationAction[] = [];
    const notes: string[] = [];

    if (precisionAtK < this.config.precisionThreshold) {
      actions.push('enable_cross_encoder');
      actions.push('increase_walk_depth');
      actions.push('expand_related');
      notes.push(`precision@${k} ${precisionAtK.toFixed(2)} below threshold ${this.config.precisionThreshold}`);
    }

    if (precisionAtK < Math.min(0.4, this.config.precisionThreshold)) {
      actions.push('increase_token_budget');
      notes.push(`precision low (${precisionAtK.toFixed(2)}), allowing more context`);
    }

    if (recallAtK < this.config.recallThreshold) {
      actions.push('increase_walk_depth');
      actions.push('expand_related');
      notes.push(`recall@${k} ${recallAtK.toFixed(2)} below threshold ${this.config.recallThreshold}`);
    }

    if (coverage > (this.config.coverageThreshold ?? 0.85)) {
      actions.push('increase_token_budget');
      notes.push(`token usage ${coverage.toFixed(2)} close to budget`);
    }

    const dedupedActions = Array.from(new Set(actions));
    const pass = precisionAtK >= this.config.precisionThreshold && recallAtK >= this.config.recallThreshold;

    return {
      metrics,
      pass,
      actions: dedupedActions,
      notes,
    };
  }
}
