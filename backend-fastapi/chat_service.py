from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Sequence
from uuid import uuid4

from models import Scenario


def _fallback_reply(data: dict) -> str:
    """Backup rule-based reply if LLM is unavailable."""
    scenario: Scenario = data["scenario"]
    user_message: str = data["user_message"].strip()
    history: List[dict] = data.get("history", [])

    intro = (
        f"You're practising the '{scenario.title}' topic. "
        f"Focus area: {scenario.focus}. "
    )
    guidance = (
        f"{scenario.description} Give me a short update."
        if not history
        else "Great! Let's keep building on that idea."
    )
    if not user_message:
        follow_up = "Start with a friendly greeting and a brief introduction."
    else:
        follow_up = (
            f"I heard you say: \"{user_message}\". "
            "Try expanding with more details or ask a follow-up question."
        )

    tip = (
        "Remember to speak clearly and connect your sentences smoothly."
        if len(history) < 6
        else "Maintain your pace and add feelings/opinions to sound more natural."
    )
    return " ".join([intro, guidance, follow_up, tip])


@dataclass
class BaseMessage:
    content: str


@dataclass
class HumanMessage(BaseMessage):
    pass


@dataclass
class AIMessage(BaseMessage):
    pass


class _SimpleChatMemory:
    """Lightweight chat memory compatible with previous langchain usage."""

    def __init__(self) -> None:
        self.messages: list[BaseMessage] = []

    def add_message(self, message: BaseMessage) -> None:
        self.messages.append(message)


@dataclass
class ConversationBufferMemory:
    """Minimal drop-in replacement for langchain's ConversationBufferMemory."""

    memory_key: str = "history"
    return_messages: bool = True
    chat_memory: _SimpleChatMemory = field(default_factory=_SimpleChatMemory)


def messages_from_dict(items: Sequence[dict]) -> list[BaseMessage]:
    result: list[BaseMessage] = []
    for item in items:
        role = item.get("role")
        content = item.get("content", "")
        if role == "user":
            result.append(HumanMessage(content=content))
        elif role == "assistant":
            result.append(AIMessage(content=content))
        else:
            result.append(BaseMessage(content=content))
    return result


def messages_to_dict(messages: Sequence[BaseMessage]) -> list[dict]:
    payload: list[dict] = []
    for message in messages:
        if isinstance(message, HumanMessage):
            role = "user"
        elif isinstance(message, AIMessage):
            role = "assistant"
        else:
            role = "system"
        payload.append({"role": role, "content": message.content})
    return payload


try:  # Optional dependency: langchain + OpenAI backend
    from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
    from langchain_core.output_parsers import StrOutputParser
    from langchain_openai import ChatOpenAI
except Exception:  # pragma: no cover - allow running without LLM deps
    ChatPromptTemplate = None  # type: ignore
    MessagesPlaceholder = None  # type: ignore
    StrOutputParser = None  # type: ignore
    ChatOpenAI = None  # type: ignore


@dataclass
class ConversationState:
    conversation_id: str
    scenario_id: int
    voice: str = "cally"
    memory: ConversationBufferMemory = field(
        default_factory=lambda: ConversationBufferMemory(
            memory_key="history", return_messages=True
        )
    )
    recording_enabled: bool = False
    recorded_chunks: list[Tuple[str, bytes]] = field(default_factory=list)

    def render_dialogue(self) -> List[dict]:
        rendered: List[dict] = []
        for message in self.memory.chat_memory.messages:
            if isinstance(message, HumanMessage):
                role = "user"
            elif isinstance(message, AIMessage):
                role = "assistant"
            else:
                role = "system"
            rendered.append({"role": role, "content": message.content})
        return rendered

    def add_recording_chunk(self, role: str, audio_bytes: bytes | None) -> None:
        if self.recording_enabled and audio_bytes:
            self.recorded_chunks.append((role, audio_bytes))


class ScenarioChatService:
    """Manage scenario-based conversations and generate LLM-backed replies."""

    def __init__(self, scenario_lookup: Dict[int, Scenario]):
        self._scenario_lookup = scenario_lookup
        self._sessions: Dict[str, ConversationState] = {}
        self._llm = None
        self._prompt = None
        self._output_parser = None
        self._initialise_llm()

    # --------------------------------------------------------------------- #
    # Session helpers
    # --------------------------------------------------------------------- #
    def _initialise_llm(self) -> None:
        if ChatOpenAI is None or ChatPromptTemplate is None or StrOutputParser is None:
            return

        api_key = os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("OPENAI_BASE_URL")
        if not api_key:
            api_key = "sk-fYZFY1EJHZc00ZjCjKnPutJnwYGHbw72ZGXnEFd41AeuE388"
        if not base_url:
            base_url = "https://api.moonshot.cn/v1"

        try:
            model = os.getenv("OPENAI_MODEL", "kimi-k2-0905-preview")
            temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.65"))
            self._llm = ChatOpenAI(
                model=model,
                temperature=temperature,
                openai_api_key=api_key,
                base_url=base_url,
            )
            self._prompt = ChatPromptTemplate.from_messages(
                [
                    (
                        "system",
                        (
                            "You are an encouraging CET-4 oral English coach. "
                            "Always answer in English. "
                            "Give concise, actionable feedback. "
                            "Scenario title: {scenario_title}. "
                            "Scenario focus: {scenario_focus}. "
                            "Use this context:\n{scenario_description}\n"
                        ),
                    ),
                    MessagesPlaceholder(variable_name="history"),
                    ("human", "{user_input}"),
                ]
            )
            self._output_parser = StrOutputParser()
        except Exception as exc:  # pragma: no cover
            print(f"[ChatService] Failed to init LLM: {exc}")
            self._llm = None
            self._prompt = None

    def _get_or_create(
        self,
        scenario_id: int,
        conversation_id: Optional[str] = None,
        voice: Optional[str] = None,
    ) -> ConversationState:
        if conversation_id and conversation_id in self._sessions:
            session = self._sessions[conversation_id]
            if session.scenario_id != scenario_id:
                session = self._create_session(scenario_id, voice)
                self._sessions[conversation_id] = session
            elif voice:
                session.voice = voice
            return session

        session = self._create_session(scenario_id, voice)
        self._sessions[session.conversation_id] = session
        return session

    def _create_session(
        self, scenario_id: int, voice: Optional[str] = None
    ) -> ConversationState:
        scenario = self._scenario_lookup[scenario_id]
        session = ConversationState(
            conversation_id=str(uuid4()),
            scenario_id=scenario_id,
            voice=voice or "cally",
        )
        welcome = (
            f"Welcome to the '{scenario.title}' practice. "
            f"We will focus on {scenario.focus.lower()}. "
            "When you are ready, say something to begin."
        )
        session.memory.chat_memory.add_message(AIMessage(content=welcome))
        return session

    # --------------------------------------------------------------------- #
    # Public API
    # --------------------------------------------------------------------- #
    def initialize_session(
        self,
        scenario_id: int,
        conversation_id: Optional[str] = None,
        voice: Optional[str] = None,
    ) -> tuple[ConversationState, str]:
        session = self._get_or_create(scenario_id, conversation_id, voice)
        for message in reversed(session.memory.chat_memory.messages):
            if isinstance(message, AIMessage):
                return session, message.content
        return session, ""

    def send_text(
        self,
        scenario_id: int,
        message: str,
        conversation_id: Optional[str] = None,
        voice: Optional[str] = None,
    ) -> tuple[ConversationState, str]:
        scenario = self._scenario_lookup[scenario_id]
        session = self._get_or_create(scenario_id, conversation_id, voice)

        reply = self._generate_reply(session, scenario, message)

        session.memory.chat_memory.add_message(HumanMessage(content=message))
        session.memory.chat_memory.add_message(AIMessage(content=reply))
        return session, reply

    def append_voice_transcript(
        self,
        scenario_id: int,
        transcript: str,
        assistant_reply: str,
        conversation_id: Optional[str] = None,
    ) -> ConversationState:
        session = self._get_or_create(scenario_id, conversation_id)

        if transcript:
            session.memory.chat_memory.add_message(HumanMessage(content=transcript))
        if assistant_reply:
            session.memory.chat_memory.add_message(AIMessage(content=assistant_reply))
        return session

    def update_voice(
        self, scenario_id: int, conversation_id: str, voice: str
    ) -> tuple[ConversationState, str]:
        session = self._get_or_create(scenario_id, conversation_id, voice)
        session.voice = voice or session.voice

        last_reply = ""
        for message in reversed(session.memory.chat_memory.messages):
            if isinstance(message, AIMessage):
                last_reply = message.content
                break

        return session, last_reply

    def load_history(
        self, scenario_id: int, conversation_id: str, history: List[dict]
    ) -> ConversationState:
        session = self._get_or_create(scenario_id, conversation_id)
        session.memory.chat_memory.messages = messages_from_dict(history)
        return session

    def set_recording(
        self, scenario_id: int, conversation_id: str, enabled: bool
    ) -> ConversationState:
        session = self._get_or_create(scenario_id, conversation_id)
        session.recording_enabled = enabled
        if enabled:
            session.recorded_chunks.clear()
        return session

    # --------------------------------------------------------------------- #
    # Internal helpers
    # --------------------------------------------------------------------- #
    def _generate_reply(
        self, session: ConversationState, scenario: Scenario, user_message: str
    ) -> str:
        if self._llm and self._prompt and self._output_parser:
            try:
                formatted_prompt = self._prompt.format_prompt(
                    scenario_title=scenario.title,
                    scenario_focus=scenario.focus,
                    scenario_description=scenario.description,
                    history=session.memory.chat_memory.messages,
                    user_input=user_message,
                )
                result = self._llm.invoke(formatted_prompt.to_messages())
                return self._output_parser.invoke(result)
            except Exception as exc:  # pragma: no cover
                print(f"[ChatService] LLM generation failed: {exc}")

        return _fallback_reply(
            {
                "scenario": scenario,
                "history": messages_to_dict(session.memory.chat_memory.messages),
                "user_message": user_message,
            }
        )
