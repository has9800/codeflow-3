import { pipeline } from '@xenova/transformers';

export class QwenEmbedder {
  private model: any;
  private readonly modelName: string;
  private initialized = false;

  constructor(modelName?: string) {
    this.modelName = modelName ?? process.env.CODEFLOW_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      this.model = await pipeline('feature-extraction', this.modelName, { quantized: true });
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to load embedding model: ${error}`);
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true,
      });

      return Array.from(output.data);
    } catch (error) {
      throw new Error(`Embedding failed: ${error}`);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }
}
