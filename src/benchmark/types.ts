export interface BenchmarkTask {
  id: string;
  query: string;
  targetFilePath?: string;
  candidateFilePaths?: string[];
  groundTruth: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface BenchmarkDataset {
  name: string;
  family: string;
  variant: string;
  description?: string;
  tasks: BenchmarkTask[];
  metadata?: Record<string, unknown>;
}

export interface TaskResultMetrics {
  precisionAtK: number;
  recallAtK: number;
  f1: number;
  coverage: number;
  candidateCount: number;
  entropy: number;
  snr: number;
  relevanceScore: number;
  answerAccuracy: number;
  exactMatch: number;
  perplexity: number;
  faithfulness: number;
  timeToFirstTokenMs: number;
}

export interface TaskBenchmarkResult {
  task: BenchmarkTask;
  metrics: TaskResultMetrics;
  actions: string[];
  pass: boolean;
  iterations: number;
}

export interface BenchmarkSummary {
  dataset: BenchmarkDataset;
  tasks: TaskBenchmarkResult[];
  aggregate: TaskResultMetrics;
  timestamp: string;
  durationMs: number;
}
