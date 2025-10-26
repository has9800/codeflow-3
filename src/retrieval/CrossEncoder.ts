import type { GraphNode } from '../graph/CodeGraph.js';
import { pipeline, env } from '@xenova/transformers';

export interface CrossEncoder {
  score(query: string, node: GraphNode): Promise<number>;
}

export interface CrossEncoderOptions {
  model?: string;
  cacheDir?: string;
}

export class TransformersCrossEncoder implements CrossEncoder {
  private readonly modelId: string;
  private readonly pipelinePromise: Promise<any>;

  constructor(options: CrossEncoderOptions = {}) {
    this.modelId =
      options.model ??
      process.env.CODEFLOW_CROSS_ENCODER_MODEL ??
      'Xenova/ms-marco-MiniLM-L-6-v2';

    if (options.cacheDir || process.env.CODEFLOW_MODEL_CACHE) {
      env.localModelPath = options.cacheDir ?? process.env.CODEFLOW_MODEL_CACHE!;
      env.allowLocalModels = true;
    }

    if (process.env.CODEFLOW_OFFLINE_MODE === '1') {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
    }

    this.pipelinePromise = pipeline('text-classification', this.modelId, {
      quantized: true,
    });
  }

  async score(query: string, node: GraphNode): Promise<number> {
    try {
      const classifier = await this.pipelinePromise;
      const text = this.normalizeText(query);
      const textPair = this.buildDocumentPayload(node);

      if (process.env.CODEFLOW_DEBUG === '1') {
        console.warn('CrossEncoder input', {
          textType: typeof text,
          textPairType: typeof textPair,
          textSample: text.slice(0, 80),
          textPairSample: textPair.slice(0, 80),
        });
      }

      const response = await classifier(text, {
        text_pair: textPair,
        topk: 1,
      });

      const result = Array.isArray(response) ? response[0] : response;
      const score = result && typeof result.score === 'number' ? result.score : 0;
      return score;
    } catch (error) {
      if (process.env.CODEFLOW_DEBUG === '1') {
        console.warn('Cross-encoder scoring failed', error);
      }
      return 0;
    }
  }

  private buildDocumentPayload(node: GraphNode): string {
    const header = `${node.name} (${node.path})`;
    const content = this.normalizeText(node.content);
    const snippet = content.length > 4000 ? `${content.slice(0, 4000)}...` : content;
    return `${header}\n${snippet}`;
  }

  private normalizeText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}
