import type { LlmApi, StudioApi } from '../../shared/api'

export function getStudio(): StudioApi {
  const studio = window.studio
  if (!studio) {
    throw new Error('应用桥接未就绪，请完全退出后重新运行 npm run dev')
  }
  return studio
}

export function getLlmApi(): LlmApi {
  const studio = getStudio()
  if (!studio.llm) {
    throw new Error('大模型接口未加载。preload 需重启才会生效，请关掉应用后重新运行 npm run dev')
  }
  return studio.llm
}
