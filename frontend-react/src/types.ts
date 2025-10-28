export type Scenario = {
  id: number
  title: string
  description: string
  focus: string
}

export type ConversationMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type ChatResponse = {
  conversationId: string
  reply: string
  messages: ConversationMessage[]
  audioBase64?: string | null
}

export type VoiceChatResponse = {
  scenarioId: number
  conversationId: string
  transcript: string
  reply: string
  messages: ConversationMessage[]
  audioBase64?: string | null
}
