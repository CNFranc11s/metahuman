import base64
from io import BytesIO
from pathlib import Path
import tempfile
from typing import Optional, Any
from uuid import uuid4
import wave

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from chat_service import ScenarioChatService
from models import (
    ChatRequest,
    ChatResponse,
    ChatStartRequest,
    ConversationMessage,
    RecordingControlRequest,
    RecordingControlResponse,
    Scenario,
    VoiceChatResponse,
    VoiceSelectRequest,
)
from sr_test import recognize_audio
from tts import TTSException, synthesize_text


app = FastAPI(title="CET-4 Speaking Practice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SCENARIOS: list[Scenario] = [
    Scenario(
        id=1,
        title="Free Talk Warm-up",
        description="Have a relaxed conversation with a new classmate. Share your major, hobbies, and why you want to improve spoken English.",
        focus="Small talk fluency",
    ),
    Scenario(
        id=2,
        title="Ask the Way",
        description="You are in a new city and need to find the nearest subway station. Ask for directions politely and confirm key information.",
        focus="Functional speaking",
    ),
    Scenario(
        id=3,
        title="Running Late",
        description="Call your professor to explain why you will be 10 minutes late for a group presentation and propose a solution.",
        focus="Problem solving",
    ),
    Scenario(
        id=4,
        title="Bubble Tea Shop",
        description="Order a customized bubble tea for you and a friend. Confirm size, sugar level, toppings, and payment method.",
        focus="Detail confirmation",
    ),
    Scenario(
        id=5,
        title="Campus Cafe Chat",
        description="Meet a visiting exchange student in the campus café. Recommend signature drinks and share study tips.",
        focus="Cultural exchange",
    ),
    Scenario(
        id=6,
        title="Library Group Project",
        description="Discuss how to divide tasks for a CET-4 speaking project. Set deadlines and agree on follow-up meetings.",
        focus="Collaboration skills",
    ),
    Scenario(
        id=7,
        title="Health Appointment",
        description="Book an appointment with the campus clinic. Describe your symptoms clearly and choose a suitable time.",
        focus="Clear description",
    ),
    Scenario(
        id=8,
        title="Weekend Trip Plan",
        description="Plan a short weekend trip with your roommate. Compare destinations, transportation, and budgets before deciding.",
        focus="Decision making",
    ),
]

scenario_lookup = {scenario.id: scenario for scenario in SCENARIOS}
chat_service = ScenarioChatService(scenario_lookup)
TEMP_AUDIO_DIR = Path(tempfile.gettempdir()) / "temp_audio"
TEMP_AUDIO_DIR.mkdir(parents=True, exist_ok=True)


def _synthesize_reply_audio(
    reply: str, voice: Optional[str] = None
) -> tuple[Optional[str], Optional[bytes]]:
    output_path = TEMP_AUDIO_DIR / f"tts_{uuid4()}.pcm"
    try:
        synthesize_text(reply, output_path, voice=voice or "cally")
        audio_bytes = output_path.read_bytes()
        return base64.b64encode(audio_bytes).decode("utf-8"), audio_bytes
    except TTSException as exc:  # pragma: no cover - external service
        print("TTS failed:", exc)
        return None, None
    except Exception as exc:  # pragma: no cover
        print("Unexpected TTS error:", exc)
        return None, None
    finally:
        if output_path.exists():
            output_path.unlink()


def _build_conversation_payload(
    session,
    reply: str,
    audio_base64: Optional[str] = None,
) -> ChatResponse:
    messages = [ConversationMessage(**item) for item in session.render_dialogue()]
    return ChatResponse(
        conversation_id=session.conversation_id,
        reply=reply,
        messages=messages,
        audio_base64=audio_base64,
    )


def _build_wav_from_chunks(chunks: list[tuple[str, bytes]], sample_rate: int = 16000) -> Optional[str]:
    if not chunks:
        return None
    pcm_bytes = b"".join([chunk for _, chunk in chunks if chunk])
    if not pcm_bytes:
        return None

    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)

    return base64.b64encode(buffer.getvalue()).decode("utf-8")


@app.get("/api/debug/files")
def debug_file_layout(path: str = ".") -> dict[str, Any]:
    """
    Inspect files relative to the project root during deployment.

    Args:
        path: relative path from project root to inspect.
    """
    project_root = Path(__file__).resolve().parents[2]
    target = (project_root / path).resolve()

    if not str(target).startswith(str(project_root)):
        raise HTTPException(status_code=400, detail="Invalid path outside project root")

    listing: Optional[list[str]] = None
    if target.exists() and target.is_dir():
        listing = [
            f"{child.name}{'/' if child.is_dir() else ''}"
            for child in sorted(target.iterdir(), key=lambda item: item.name)
        ]

    interesting_paths = {
        "index_at_root": project_root / "index.html",
        "frontend_dist_index": project_root / "frontend-react" / "dist" / "index.html",
        "vercel_output_index": project_root / ".vercel" / "output" / "static" / "index.html",
    }

    return {
        "project_root": str(project_root),
        "requested_path": str(target),
        "exists": target.exists(),
        "is_dir": target.is_dir(),
        "listing": listing,
        "interesting": {
            key: {"path": str(value), "exists": value.exists()}
            for key, value in interesting_paths.items()
        },
    }


@app.get("/api/scenarios", response_model=list[Scenario])
def list_scenarios() -> list[Scenario]:
    """Return the mock speaking practice scenarios."""
    return SCENARIOS


@app.get("/api/scenarios/{scenario_id}", response_model=Scenario)
def get_scenario(scenario_id: int) -> Scenario:
    """Return a specific scenario by id."""
    for scenario in SCENARIOS:
        if scenario.id == scenario_id:
            return scenario
    raise HTTPException(status_code=404, detail="Scenario not found")


@app.post("/api/chat/start", response_model=ChatResponse)
def start_chat_session(request: ChatStartRequest) -> ChatResponse:
    if request.scenario_id not in scenario_lookup:
        raise HTTPException(status_code=404, detail="Scenario not found")

    session, reply = chat_service.initialize_session(
        scenario_id=request.scenario_id,
        conversation_id=request.conversation_id,
        voice=request.voice,
    )
    audio_base64, audio_bytes = _synthesize_reply_audio(reply, voice=session.voice)
    session.add_recording_chunk("assistant", audio_bytes)
    return _build_conversation_payload(session, reply, audio_base64)


@app.post("/api/chat/text", response_model=ChatResponse)
def send_chat_message(request: ChatRequest) -> ChatResponse:
    if request.scenario_id not in scenario_lookup:
        raise HTTPException(status_code=404, detail="Scenario not found")

    session, reply = chat_service.send_text(
        scenario_id=request.scenario_id,
        message=request.message,
        conversation_id=request.conversation_id,
        voice=request.voice,
    )
    audio_base64, audio_bytes = _synthesize_reply_audio(reply, voice=session.voice)
    session.add_recording_chunk("assistant", audio_bytes)
    return _build_conversation_payload(session, reply, audio_base64)


@app.post("/api/chat/voice", response_model=VoiceChatResponse)
async def send_voice_message(
    scenario_id: int = Form(...),
    conversation_id: str | None = Form(None),
    voice: str | None = Form(None),
    audio: UploadFile = File(...),
) -> VoiceChatResponse:
    if scenario_id not in scenario_lookup:
        raise HTTPException(status_code=404, detail="Scenario not found")

    audio_bytes = await audio.read()
    temp_pcm = TEMP_AUDIO_DIR / f"voice_{uuid4()}.pcm"
    temp_pcm.write_bytes(audio_bytes)

    try:
        transcript = recognize_audio(temp_pcm)
    finally:
        if temp_pcm.exists():
            temp_pcm.unlink()

    if not transcript:
        transcript = "（暂未识别到语音内容，请重试或改用文字输入。）"

    session, reply = chat_service.send_text(
        scenario_id=scenario_id,
        message=transcript,
        conversation_id=conversation_id,
        voice=voice,
    )

    session.add_recording_chunk("user", audio_bytes)

    audio_base64, audio_reply_bytes = _synthesize_reply_audio(
        reply, voice=session.voice
    )
    session.add_recording_chunk("assistant", audio_reply_bytes)

    messages = [ConversationMessage(**item) for item in session.render_dialogue()]

    return VoiceChatResponse(
        scenario_id=scenario_id,
        conversation_id=session.conversation_id,
        transcript=transcript,
        reply=reply,
        messages=messages,
        audio_base64=audio_base64,
    )


@app.post("/api/chat/voice-select", response_model=ChatResponse)
def update_voice_preference(request: VoiceSelectRequest) -> ChatResponse:
    if request.scenario_id not in scenario_lookup:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if not request.conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")

    session, last_reply = chat_service.update_voice(
        scenario_id=request.scenario_id,
        conversation_id=request.conversation_id,
        voice=request.voice,
    )
    messages = [ConversationMessage(**item) for item in session.render_dialogue()]

    audio_base64 = None
    if last_reply:
        audio_base64, audio_bytes = _synthesize_reply_audio(
            last_reply, voice=session.voice
        )
        session.add_recording_chunk("assistant", audio_bytes)

    return ChatResponse(
        conversation_id=session.conversation_id,
        reply=last_reply,
        messages=messages,
        audio_base64=audio_base64,
    )


@app.post("/api/session/recording", response_model=RecordingControlResponse)
def control_recording(request: RecordingControlRequest) -> RecordingControlResponse:
    if request.scenario_id not in scenario_lookup:
        raise HTTPException(status_code=404, detail="Scenario not found")

    if not request.conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")

    if request.action == "start":
        session = chat_service.set_recording(
            scenario_id=request.scenario_id,
            conversation_id=request.conversation_id,
            enabled=True,
        )
        return RecordingControlResponse(recording=session.recording_enabled)

    if request.action == "stop":
        session = chat_service.set_recording(
            scenario_id=request.scenario_id,
            conversation_id=request.conversation_id,
            enabled=False,
        )
        audio_base64 = _build_wav_from_chunks(session.recorded_chunks)
        return RecordingControlResponse(recording=False, audio_base64=audio_base64)

    raise HTTPException(status_code=400, detail="Unsupported action")
