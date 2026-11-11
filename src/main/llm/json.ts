/** Strip markdown fences and extract the first JSON object/array from model output. */
export function extractJsonValue(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('模型返回为空')

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const candidate = (fenced?.[1] ?? trimmed).trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const objectStart = candidate.indexOf('{')
    const arrayStart = candidate.indexOf('[')
    let start = -1
    if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) start = objectStart
    else if (arrayStart >= 0) start = arrayStart
    if (start < 0) throw new Error('模型返回中未找到 JSON')

    const opening = candidate[start]
    const closing = opening === '{' ? '}' : ']'
    let depth = 0
    let end = -1
    for (let i = start; i < candidate.length; i += 1) {
      const ch = candidate[i]
      if (ch === opening) depth += 1
      if (ch === closing) {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end < 0) throw new Error('模型返回的 JSON 不完整')
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback
  return value.map((item) => String(item).trim()).filter(Boolean)
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return fallback
}

export function clampScore(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)))
}
