from typing import Literal

from pydantic import BaseModel

class Scenario(BaseModel):
    id: int
    title: str
    description: str
    focus: str


class ChatRequest(BaseModel):
    scenario_id: int
    message: str
    conversation_id: str | None = None
    voice: str | None = None


class ChatStartRequest(BaseModel):
    scenario_id: int
    conversation_id: str | None = None
    voice: str | None = None


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    messages: list[ConversationMessage]
    audio_base64: str | None = None


class VoiceChatResponse(BaseModel):
    scenario_id: int
    conversation_id: str
    transcript: str
    reply: str
    messages: list[ConversationMessage]
    audio_base64: str | None = None


class VoiceSelectRequest(BaseModel):
    scenario_id: int
    conversation_id: str
    voice: str


class RecordingControlRequest(BaseModel):
    scenario_id: int
    conversation_id: str
    action: Literal["start", "stop"]


class RecordingControlResponse(BaseModel):
    recording: bool
    audio_base64: str | None = None
