import type { ChatResponse, VoiceChatResponse } from '../types'

const API_BASE_URL = import.meta.env.PROD
  ? '/api'
  : 'http://localhost:8000/api'

type SendTextParams = {
  scenarioId: number
  message: string
  voice: string
  conversationId?: string
}

export const sendTextMessage = async ({
  scenarioId,
  message,
  voice,
  conversationId,
}: SendTextParams): Promise<ChatResponse> => {
  const response = await fetch(`${API_BASE_URL}/chat/text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scenario_id: scenarioId,
      message,
      conversation_id: conversationId,
      voice,
    }),
  })

  if (!response.ok) {
    throw new Error('发送消息失败')
  }

  const data = (await response.json()) as {
    conversation_id: string
    reply: string
    messages: ChatResponse['messages']
    audio_base64?: string | null
  }
  return {
    conversationId: data.conversation_id,
    reply: data.reply,
    messages: data.messages,
    audioBase64: data.audio_base64 ?? null,
  }
}

type SendVoiceParams = {
  scenarioId: number
  audio: Blob
  voice: string
  conversationId?: string
}

export const sendVoiceMessage = async ({
  scenarioId,
  audio,
  voice,
  conversationId,
}: SendVoiceParams): Promise<VoiceChatResponse> => {
  const formData = new FormData()
  formData.append('scenario_id', String(scenarioId))
  if (conversationId) {
    formData.append('conversation_id', conversationId)
  }
  formData.append('audio', audio, 'recording.pcm')
  formData.append('voice', voice)

  const response = await fetch(`${API_BASE_URL}/chat/voice`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error('发送语音失败')
  }

  const data = (await response.json()) as {
    scenario_id: number
    conversation_id: string
    transcript: string
    reply: string
    messages: VoiceChatResponse['messages']
    audio_base64?: string | null
  }
  return {
    scenarioId: data.scenario_id,
    conversationId: data.conversation_id,
    transcript: data.transcript,
    reply: data.reply,
    messages: data.messages,
    audioBase64: data.audio_base64 ?? null,
  }
}

type StartConversationParams = {
  scenarioId: number
  voice: string
  conversationId?: string
}

export const startConversation = async ({
  scenarioId,
  voice,
  conversationId,
}: StartConversationParams): Promise<ChatResponse> => {
  const response = await fetch(`${API_BASE_URL}/chat/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scenario_id: scenarioId,
      voice,
      conversation_id: conversationId,
    }),
  })

  if (!response.ok) {
    throw new Error('初始化对话失败')
  }

  const data = (await response.json()) as {
    conversation_id: string
    reply: string
    messages: ChatResponse['messages']
    audio_base64?: string | null
  }

  return {
    conversationId: data.conversation_id,
    reply: data.reply,
    messages: data.messages,
    audioBase64: data.audio_base64 ?? null,
  }
}

type VoicePreferenceParams = {
  scenarioId: number
  conversationId: string
  voice: string
}

export const updateVoicePreference = async ({
  scenarioId,
  conversationId,
  voice,
}: VoicePreferenceParams): Promise<ChatResponse> => {
  const response = await fetch(`${API_BASE_URL}/chat/voice-select`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scenario_id: scenarioId,
      conversation_id: conversationId,
      voice,
    }),
  })

  if (!response.ok) {
    throw new Error('声线更新失败')
  }

  const data = (await response.json()) as {
    conversation_id: string
    reply: string
    messages: ChatResponse['messages']
    audio_base64?: string | null
  }

  return {
    conversationId: data.conversation_id,
    reply: data.reply,
    messages: data.messages,
    audioBase64: data.audio_base64 ?? null,
  }
}

type RecordingControlParams = {
  scenarioId: number
  conversationId: string
  action: 'start' | 'stop'
}

type RecordingControlResult = {
  recording: boolean
  audioBase64?: string | null
}

export const controlSessionRecording = async ({
  scenarioId,
  conversationId,
  action,
}: RecordingControlParams): Promise<RecordingControlResult> => {
  const response = await fetch(`${API_BASE_URL}/session/recording`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scenario_id: scenarioId,
      conversation_id: conversationId,
      action,
    }),
  })

  if (!response.ok) {
    throw new Error('录制控制失败')
  }

  const data = (await response.json()) as {
    recording: boolean
    audio_base64?: string | null
  }

  return {
    recording: data.recording,
    audioBase64: data.audio_base64 ?? null,
  }
}
