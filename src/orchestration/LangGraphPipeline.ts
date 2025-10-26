import type { Logger } from '../utils/logger.js';
import { logger as baseLogger } from '../utils/logger.js';
import type { CodeGraph } from '../graph/CodeGraph.js';
import type { InitializeResult } from '../graph/GraphManager.js';
import type { TargetResolver, TargetResolution } from '../retrieval/TargetResolver.js';
import type {
  DependencyAwareRetriever,
  DependencyContext,
  BuildContextOptions,
} from '../retrieval/DependencyAwareRetriever.js';
import { LangGraphTrace } from './LangGraphTrace.js';
import type { EvaluationAgent } from './EvaluationAgent.js';
import type { EvaluationDecision, GroundTruth } from './EvaluationAgent.js';

export interface GraphManagerLike {
  getGraph(): CodeGraph;
  initialize(forceRebuild?: boolean): Promise<InitializeResult>;
}

export interface RetrievalComponentOptions {
  useCrossEncoder: boolean;
}

export interface RetrievalComponents {
  resolver: TargetResolver;
  retriever: DependencyAwareRetriever;
}

export type RetrievalComponentFactory = (
  graph: CodeGraph,
  options: RetrievalComponentOptions
) => Promise<RetrievalComponents>;

export interface LangGraphPipelineDeps {
  graphManager: GraphManagerLike;
  buildComponents: RetrievalComponentFactory;
  evaluationAgent: EvaluationAgent;
  logger?: Logger;
}

export interface LangGraphPipelineConfig {
  initialTokenBudget?: number;
  tokenBudgetStep?: number;
  initialWalkDepth?: number;
  walkDepthStep?: number;
  maxWalkDepth?: number;
  initialRelatedLimit?: number;
  relatedLimitStep?: number;
  initialBreadthLimit?: number;
  maxBreadthLimit?: number;
  maxIterations?: number;
  seedLimit?: number;
}

export interface LangGraphPipelineInput {
  query: string;
  groundTruth: GroundTruth;
  targetFilePath?: string;
  candidateFilePaths?: string[];
}

export interface LangGraphPipelineResult {
  context: DependencyContext | null;
  resolution: TargetResolution | null;
  evaluation: EvaluationDecision | null;
  iterations: number;
  trace: LangGraphTrace;
  actionsTaken: string[];
}

interface InternalState {
  tokenBudget: number;
  walkDepth: number;
  relatedLimit: number;
  breadthLimit: number;
  useCrossEncoder: boolean;
}

interface ResolvedConfig {
  initialTokenBudget: number;
  tokenBudgetStep: number;
  initialWalkDepth: number;
  walkDepthStep: number;
  maxWalkDepth: number;
  initialRelatedLimit: number;
  relatedLimitStep: number;
  initialBreadthLimit: number;
  maxBreadthLimit: number;
  maxIterations: number;
  seedLimit: number;
}

export class LangGraphPipeline {
  private readonly deps: LangGraphPipelineDeps;
  private readonly config: ResolvedConfig;

  constructor(deps: LangGraphPipelineDeps, config: LangGraphPipelineConfig = {}) {
    this.deps = deps;
    this.config = {
      initialTokenBudget: config.initialTokenBudget ?? 6000,
      tokenBudgetStep: config.tokenBudgetStep ?? 2000,
      initialWalkDepth: config.initialWalkDepth ?? 2,
      walkDepthStep: config.walkDepthStep ?? 1,
      maxWalkDepth: config.maxWalkDepth ?? 5,
      initialRelatedLimit: config.initialRelatedLimit ?? 5,
      relatedLimitStep: config.relatedLimitStep ?? 2,
      initialBreadthLimit: config.initialBreadthLimit ?? 3,
      maxBreadthLimit: config.maxBreadthLimit ?? 6,
      maxIterations: config.maxIterations ?? 2,
      seedLimit: config.seedLimit ?? 5,
    };
  }

  async run(input: LangGraphPipelineInput): Promise<LangGraphPipelineResult> {
    const trace = new LangGraphTrace();
    const pipelineLogger = (this.deps.logger ?? baseLogger.child('langgraph')).child('pipeline');

    const graph = await this.ensureGraph(trace);

    let iteration = 0;
    let context: DependencyContext | null = null;
    let resolution: TargetResolution | null = null;
    let evaluation: EvaluationDecision | null = null;
    const actionsTaken: string[] = [];
    let candidatePaths = [...(input.candidateFilePaths ?? [])];

    const state: InternalState = {
      tokenBudget: this.config.initialTokenBudget,
      walkDepth: this.config.initialWalkDepth,
      relatedLimit: this.config.initialRelatedLimit,
      breadthLimit: this.config.initialBreadthLimit,
      useCrossEncoder: false,
    };

    while (iteration < this.config.maxIterations) {
      iteration += 1;
      pipelineLogger.debug('pipeline iteration start', {
        iteration,
        tokenBudget: state.tokenBudget,
        walkDepth: state.walkDepth,
        relatedLimit: state.relatedLimit,
        breadthLimit: state.breadthLimit,
        useCrossEncoder: state.useCrossEncoder,
      });

      const components = await trace.record(
        'components.build',
        () => this.deps.buildComponents(graph, { useCrossEncoder: state.useCrossEncoder }),
        () => ({ useCrossEncoder: state.useCrossEncoder })
      );

      await trace.record('retriever.initialize', async () => {
        await components.retriever.initialize();
      });

      const resolved = await trace.record(
        'target.resolve',
        () =>
          components.resolver.resolve(input.query, {
            recentPaths: candidatePaths,
            limit: this.config.seedLimit,
          }),
        res => ({
          candidateCount: res.candidates.length,
          primaryPath: res.primary?.path,
        })
      );
      resolution = resolved;
      const activeResolution = resolution;
      if (!activeResolution) {
        pipelineLogger.warn('target resolution produced no candidates', { iteration });
        break;
      }

      const primaryFilePath = input.targetFilePath ?? activeResolution.primary?.path;

      const builtContext = await trace.record(
        'context.build',
        () =>
          components.retriever.buildContextForChange(
            input.query,
            primaryFilePath,
            state.tokenBudget,
            this.resolveContextOptions(candidatePaths, state)
          ),
        ctx => ({
          tokensUsed: ctx.tokensUsed,
          primaryFilePath: ctx.primaryFilePath,
        })
      );
      context = builtContext;
      const activeContext = context;
      if (!activeContext) {
        pipelineLogger.warn('context builder returned null context', { iteration, primaryFilePath });
        break;
      }

      const decision = await trace.record(
        'agent.evaluate',
        () =>
          this.deps.evaluationAgent.evaluate({
            query: input.query,
            resolution: activeResolution,
            context: activeContext,
            groundTruth: input.groundTruth,
            iteration,
          }),
        decision => ({
          pass: decision.pass,
          precision: decision.metrics.precisionAtK,
          recall: decision.metrics.recallAtK,
          actions: decision.actions,
        })
      );
      evaluation = decision;
      if (!evaluation) {
        pipelineLogger.warn('evaluation agent returned null decision', { iteration });
        break;
      }

      pipelineLogger.info('evaluation result', {
        iteration,
        metrics: evaluation.metrics,
        pass: evaluation.pass,
        actions: evaluation.actions,
      });

      actionsTaken.push(...evaluation.actions);
      candidatePaths = Array.from(
        new Set([
          ...candidatePaths,
          ...activeResolution.candidates.map(candidate => candidate.path),
        ])
      );

      if (evaluation.pass || evaluation.actions.length === 0) {
        break;
      }

      this.applyActions(state, evaluation.actions);
    }

    return {
      context,
      resolution,
      evaluation,
      iterations: iteration,
      trace,
      actionsTaken,
    };
  }

  private async ensureGraph(trace: LangGraphTrace): Promise<CodeGraph> {
    return trace.record(
      'graph.load',
      async () => {
        try {
          return this.deps.graphManager.getGraph();
        } catch (error) {
          const result = await this.deps.graphManager.initialize();
          return result.graph;
        }
      },
      graph => ({
        nodes: graph.getAllNodes().length,
        edges: graph.getAllEdges().length,
      })
    );
  }

  private resolveContextOptions(candidatePaths: string[], state: InternalState): BuildContextOptions {
    return {
      candidateFilePaths: candidatePaths,
      walkDepth: state.walkDepth,
      relatedLimit: state.relatedLimit,
      breadthLimit: state.breadthLimit,
    };
  }

  private applyActions(state: InternalState, actions: string[]): void {
    for (const action of actions) {
      switch (action) {
        case 'increase_token_budget':
          state.tokenBudget = Math.min(12000, state.tokenBudget + this.config.tokenBudgetStep);
          break;
        case 'increase_walk_depth':
          state.walkDepth = Math.min(this.config.maxWalkDepth, state.walkDepth + this.config.walkDepthStep);
          break;
        case 'expand_related':
          state.relatedLimit += this.config.relatedLimitStep;
          state.breadthLimit = Math.min(this.config.maxBreadthLimit, state.breadthLimit + 1);
          break;
        case 'enable_cross_encoder':
          state.useCrossEncoder = true;
          break;
        default:
          break;
      }
    }
  }
}
