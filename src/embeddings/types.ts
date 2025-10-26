export interface Embedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
}

export interface EmbedderOptions {
  model?: string;
  cacheDir?: string;
  quantized?: boolean;
}
