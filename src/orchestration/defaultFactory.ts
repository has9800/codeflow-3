import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import { TargetResolver } from '../retrieval/TargetResolver.js';
import { DependencyAwareRetriever } from '../retrieval/DependencyAwareRetriever.js';
import { TransformersCrossEncoder } from '../retrieval/CrossEncoder.js';
import type { RetrievalComponentFactory, RetrievalComponentOptions } from './LangGraphPipeline.js';

export function createDefaultRetrievalFactory(): RetrievalComponentFactory {
  const embedder = new QwenEmbedder();
  let embedderReady = false;

  const ensureEmbedder = async () => {
    if (embedderReady) {
      return;
    }
    if (process.env.CODEFLOW_DISABLE_EMBEDDINGS === '1') {
      embedderReady = true;
      return;
    }
    try {
      await embedder.initialize();
    } catch (error) {
      console.warn(
        'Falling back to disabled embeddings:',
        error instanceof Error ? error.message : String(error)
      );
    }
    embedderReady = true;
  };

  return async (graph, options: RetrievalComponentOptions) => {
    await ensureEmbedder();

    const resolver = new TargetResolver(graph, embedder, {
      crossEncoder: options.useCrossEncoder ? new TransformersCrossEncoder() : undefined,
    });

    const retriever = new DependencyAwareRetriever(graph, { embedder });

    return { resolver, retriever };
  };
}
