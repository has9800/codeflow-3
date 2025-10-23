export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  supportsCaching: boolean;
  recommended: boolean;
}

export const SUPPORTED_MODELS: ModelConfig[] = [
  {
    id: 'x-ai/grok-code-fast-1',
    name: 'Grok Code Fast',
    provider: 'xAI',
    contextWindow: 131072,
    supportsCaching: false,
    recommended: true
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    contextWindow: 200000,
    supportsCaching: true,
    recommended: true
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    contextWindow: 1000000,
    supportsCaching: true,
    recommended: false
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    contextWindow: 200000,
    supportsCaching: true,
    recommended: false
  },
  {
    id: 'x-ai/grok-4-fast',
    name: 'Grok 4 Fast',
    provider: 'xAI',
    contextWindow: 131072,
    supportsCaching: false,
    recommended: false
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    contextWindow: 2000000,
    supportsCaching: true,
    recommended: true
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    provider: 'OpenAI',
    contextWindow: 128000,
    supportsCaching: true,
    recommended: true
  },
  {
    id: 'qwen/qwen3-coder',
    name: 'Qwen3 Coder',
    provider: 'Qwen',
    contextWindow: 32768,
    supportsCaching: false,
    recommended: false
  },
  {
    id: 'openai/gpt-5-codex',
    name: 'GPT-5 Codex',
    provider: 'OpenAI',
    contextWindow: 128000,
    supportsCaching: true,
    recommended: true
  }
];

export function getModel(id: string): ModelConfig | undefined {
  return SUPPORTED_MODELS.find(m => m.id === id);
}

export function getRecommendedModels(): ModelConfig[] {
  return SUPPORTED_MODELS.filter(m => m.recommended);
}
