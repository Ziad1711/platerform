import { OpenAIProvider } from '@/lib/assistant/providers/openai'
import { DeepSeekProvider } from '@/lib/assistant/providers/deepseek'
import type { AssistantProvider } from '@/lib/assistant/providers/types'

export function getAssistantProvider(): AssistantProvider {
  const provider = process.env.ASSISTANT_PROVIDER?.trim().toLowerCase()

  if (provider === 'deepseek') {
    return new DeepSeekProvider()
  }

  return new OpenAIProvider()
}

export function getAssistantModelName() {
  const provider = process.env.ASSISTANT_PROVIDER?.trim().toLowerCase()

  if (provider === 'deepseek') {
    const model = process.env.DEEPSEEK_MODEL?.trim()
    if (!model) return 'deepseek-chat'

    const normalized = model.toLowerCase().replace(/\s+/g, '-')
    if (normalized === 'deepseek-chat') return 'deepseek-chat'
    return model
  }

  const openaiModel = process.env.OPENAI_MODEL?.trim()
  return openaiModel || 'gpt-4o'
}
