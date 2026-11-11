export interface LlmProviderPreset {
  label: string
  value: string
  baseUrl: string
  /** Optional default model id hint when creating models for this channel. */
  suggestedModelId?: string
}

/** OpenAI-compatible channel presets used by the settings UI. */
export const providerPresets: readonly LlmProviderPreset[] = [
  // International
  {
    label: 'OpenAI',
    value: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModelId: 'gpt-4.1',
  },
  {
    label: 'OpenRouter',
    value: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModelId: 'openai/gpt-4.1',
  },
  {
    label: 'xAI Grok',
    value: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    suggestedModelId: 'grok-3',
  },
  {
    label: 'Groq',
    value: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    suggestedModelId: 'llama-3.3-70b-versatile',
  },
  {
    label: 'Mistral',
    value: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    suggestedModelId: 'mistral-large-latest',
  },
  {
    label: 'Together AI',
    value: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    suggestedModelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  },
  {
    label: 'Fireworks',
    value: 'fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    suggestedModelId: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
  },
  {
    label: 'Perplexity',
    value: 'perplexity',
    baseUrl: 'https://api.perplexity.ai',
    suggestedModelId: 'sonar-pro',
  },
  {
    label: 'GitHub Models',
    value: 'github-models',
    baseUrl: 'https://models.inference.ai.azure.com',
    suggestedModelId: 'gpt-4o',
  },

  // China mainstream
  {
    label: '小米 MiMo',
    value: 'mimo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    suggestedModelId: 'mimo-v2.6-pro',
  },
  {
    label: '小米 MiMo Token Plan',
    value: 'mimo-token-plan',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    suggestedModelId: 'mimo-v2.6-pro',
  },
  {
    label: 'DeepSeek',
    value: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    suggestedModelId: 'deepseek-chat',
  },
  {
    label: '通义千问 / 百炼',
    value: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    suggestedModelId: 'qwen-plus',
  },
  {
    label: '智谱 GLM',
    value: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    suggestedModelId: 'glm-4-plus',
  },
  {
    label: '月之暗面 Kimi',
    value: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    suggestedModelId: 'moonshot-v1-auto',
  },
  {
    label: '字节豆包 / 方舟',
    value: 'doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    suggestedModelId: 'doubao-1-5-pro-32k',
  },
  {
    label: '腾讯混元',
    value: 'hunyuan',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    suggestedModelId: 'hunyuan-turbos-latest',
  },
  {
    label: '百度千帆',
    value: 'qianfan',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    suggestedModelId: 'ernie-4.0-8k',
  },
  {
    label: 'MiniMax',
    value: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    suggestedModelId: 'MiniMax-Text-01',
  },
  {
    label: '零一万物 Yi',
    value: 'yi',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    suggestedModelId: 'yi-lightning',
  },
  {
    label: '阶跃星辰',
    value: 'stepfun',
    baseUrl: 'https://api.stepfun.com/v1',
    suggestedModelId: 'step-2-16k',
  },
  {
    label: '百川智能',
    value: 'baichuan',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    suggestedModelId: 'Baichuan4-Turbo',
  },
  {
    label: '讯飞星火',
    value: 'spark',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    suggestedModelId: 'generalv3.5',
  },
  {
    label: 'SenseNova 日日新',
    value: 'sensenova',
    baseUrl: 'https://api.sensenova.cn/compatible-mode/v1',
    suggestedModelId: 'SenseChat-5',
  },

  // Aggregators / cloud GPU
  {
    label: '硅基流动',
    value: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    suggestedModelId: 'deepseek-ai/DeepSeek-V3',
  },
  {
    label: '智谱开放平台（国际）',
    value: 'zhipu-intl',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    suggestedModelId: 'glm-4.5',
  },
  {
    label: 'NVIDIA NIM',
    value: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    suggestedModelId: 'meta/llama-3.1-70b-instruct',
  },
  {
    label: 'Cloudflare Workers AI',
    value: 'cloudflare',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1',
    suggestedModelId: '@cf/meta/llama-3.1-70b-instruct',
  },

  // Local
  {
    label: 'Ollama',
    value: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    suggestedModelId: 'llama3.2',
  },
  {
    label: 'LM Studio',
    value: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    suggestedModelId: 'local-model',
  },
  {
    label: 'vLLM',
    value: 'vllm',
    baseUrl: 'http://127.0.0.1:8000/v1',
    suggestedModelId: 'default',
  },

  {
    label: '自定义 / 中转站',
    value: 'custom',
    baseUrl: '',
  },
]
