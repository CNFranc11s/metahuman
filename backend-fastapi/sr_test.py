import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Optional

import nls

from get_token import get_aliyun_token

URL = "wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1"
APPKEY = "5cbtQPiKRHTlevAH"


def _resolve_token() -> Optional[str]:
    token_env = os.getenv("ALIYUN_TOKEN") or os.getenv("ALIBABA_CLOUD_TOKEN")
    if token_env:
        return token_env.strip()

    token, expire_time = get_aliyun_token()
    if token:
        os.environ["ALIYUN_TOKEN"] = token
        os.environ.setdefault("ALIBABA_CLOUD_TOKEN", token)
        if expire_time:
            os.environ["ALIYUN_TOKEN_EXPIRE"] = str(expire_time)
        return token
    return None


class SpeechRecognizerThread:
    def __init__(self, audio_path: Path):
        self._audio_path = audio_path
        self._thread = threading.Thread(target=self._run_recognizer, daemon=True)
        self._completed = threading.Event()
        self.result: Optional[str] = None

    def start(self) -> None:
        self._thread.start()

    def join(self, timeout: float) -> Optional[str]:
        finished = self._completed.wait(timeout)
        if not finished:
            return None
        return self.result

    # Internal ---------------------------------------------------------
    def _run_recognizer(self) -> None:
        try:
            token = _resolve_token()
            if not token:
                print("Failed to resolve Aliyun token for speech recognition")
                return

            recognizer = nls.NlsSpeechRecognizer(
                url=URL,
                token=token,
                appkey=APPKEY,
                on_start=self._on_start,
                on_result_changed=self._on_result_changed,
                on_completed=self._on_completed,
                on_error=self._on_error,
                on_close=self._on_close,
            )

            recognizer.start(aformat="pcm")

            audio_bytes = self._audio_path.read_bytes()
            chunk_size = 640
            for start in range(0, len(audio_bytes), chunk_size):
                chunk = audio_bytes[start : start + chunk_size]
                recognizer.send_audio(chunk)
                time.sleep(0.01)

            recognizer.stop()
        except Exception as exc:  # pragma: no cover
            print("Speech recognizer error:", exc)
        finally:
            time.sleep(1)
            self._completed.set()

    # Callbacks --------------------------------------------------------
    def _on_start(self, message: Any, *args):  # pragma: no cover
        print("Speech recognizer started", message, args)

    def _on_result_changed(self, message: Any, *args):  # pragma: no cover
        pass

    def _on_completed(self, message: Any, *args):
        try:
            if isinstance(message, str):
                payload = json.loads(message)
            else:
                payload = message

            payload_data = payload.get("payload", {})
            result = payload_data.get("result")

            # Many Aliyun responses place the recognized text in payload['result']['text']
            # or payload['text'] / payload['result_list'][i]['text']
            candidate_text: Optional[str] = None

            if isinstance(result, dict):
                candidate_text = result.get("text") or result.get("transcript")
            elif isinstance(result, str) and result.lower() not in {"ok", "okay"}:
                candidate_text = result

            if not candidate_text:
                if "text" in payload_data and payload_data["text"].strip():
                    candidate_text = payload_data["text"]
                elif isinstance(payload_data.get("result_list"), list):
                    for item in payload_data["result_list"]:
                        if isinstance(item, dict) and item.get("text"):
                            candidate_text = item["text"]
                            break

            if candidate_text:
                self.result = candidate_text.strip()
            else:
                self.result = None
        except Exception as exc:  # pragma: no cover
            print("Error parsing recognition result:", exc)

    def _on_error(self, message: Any, *args):  # pragma: no cover
        try:
            if isinstance(message, str):
                payload = json.loads(message)
            else:
                payload = message
            print("Speech recognizer reported error:", payload, args)
        finally:
            self._completed.set()

    def _on_close(self, *args):  # pragma: no cover
        pass


def recognize_audio(file_path: Path, timeout: float = 30.0) -> Optional[str]:
    runner = SpeechRecognizerThread(file_path)
    runner.start()
    return runner.join(timeout)
