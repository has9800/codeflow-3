import { pipeline } from '@xenova/transformers';
import type { Embedder, EmbedderOptions } from './types.js';

const FALLBACK_MODELS = [
  'BAAI/bge-small-en-v1.5',
  'intfloat/e5-base-v2',
  'Xenova/all-MiniLM-L6-v2',
];

export interface TransformersEmbedderOptions extends EmbedderOptions {
  fallbackModels?: string[];
}

export class TransformersEmbedder implements Embedder {
  private readonly candidates: string[];
  private readonly cacheDir?: string;
  private readonly quantized: boolean;
  private initialized = false;
  private model: any;
  private activeModelId?: string;

  constructor(options: TransformersEmbedderOptions = {}) {
    const requested = options.model ?? process.env.CODEFLOW_EMBED_MODEL;
    const fallback = options.fallbackModels ?? FALLBACK_MODELS;

    this.candidates = [
      ...(requested ? [requested] : []),
      ...fallback.filter(model => model !== requested),
    ];

    this.cacheDir = options.cacheDir ?? process.env.CODEFLOW_MODEL_CACHE;
    this.quantized = options.quantized ?? true;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const errors: Error[] = [];
    for (const modelId of this.candidates) {
      try {
        const options: Record<string, unknown> = { quantized: this.quantized };
        if (this.cacheDir) {
          options.cacheDir = this.cacheDir;
        }

        this.model = await pipeline('feature-extraction', modelId, options);
        this.activeModelId = modelId;
        this.initialized = true;
        return;
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error
            : new Error(typeof error === 'string' ? error : 'Unknown pipeline error')
        );
      }
    }

    const message = errors
      .map((err, index) => `[${this.candidates[index] ?? 'unknown'}] ${err.message}`)
      .join('; ');
    throw new Error(
      `Failed to load embedding model${message ? `: ${message}` : ''}`
    );
  }

  async embed(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.model) {
      throw new Error('Embedding model not initialised');
    }

    try {
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true,
      });

      return Array.from(output.data);
    } catch (error) {
      throw new Error(
        `Embedding failed${this.activeModelId ? ` (model ${this.activeModelId})` : ''}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }
}

export class QwenEmbedder extends TransformersEmbedder {
  constructor(modelName?: string) {
    super({ model: modelName });
  }
}

export function createEmbedder(options?: TransformersEmbedderOptions): Embedder {
  return new TransformersEmbedder(options);
}
