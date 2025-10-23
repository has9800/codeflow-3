import { pipeline } from '@xenova/transformers';

export class QwenEmbedder {
  private model: any;
  private modelName = 'Qwen/Qwen3-Embedding-0.6B';
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      this.model = await pipeline('feature-extraction', this.modelName);
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
