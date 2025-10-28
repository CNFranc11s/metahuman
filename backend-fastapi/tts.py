import os
import threading
from pathlib import Path
from typing import Optional

import nls

from get_token import get_aliyun_token

URL = "wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1"
APPKEY = "5cbtQPiKRHTlevAH"


class TTSException(Exception):
    pass


def _resolve_token() -> Optional[str]:
    token, _ = get_aliyun_token()
    if token:
        os.environ["ALIYUN_TOKEN"] = token
        os.environ.setdefault("ALIBABA_CLOUD_TOKEN", token)
        return token

    fallback = os.getenv("ALIYUN_TOKEN") or os.getenv("ALIBABA_CLOUD_TOKEN")
    if fallback:
        return fallback

    return "3412a787fad54262a3ef3b5060085d68"


def synthesize_text(text: str, output_file_path: Path, voice: str = "cally") -> None:
    """
    Synthesize text to PCM audio using Aliyun NLS.
    """

    class SynthesizeThread(threading.Thread):
        def __init__(self) -> None:
            super().__init__(daemon=True)
            self.error: Exception | None = None

        def run(self) -> None:  # pragma: no cover - relies on external service
            try:
                token = _resolve_token()
                if not token:
                    raise TTSException("无法获取阿里云语音合成 token。")

                tts = nls.NlsSpeechSynthesizer(
                    url=URL,
                    token=token,
                    appkey=APPKEY,
                    on_metainfo=self.on_metainfo,
                    on_data=self.on_data,
                    on_completed=self.on_completed,
                    on_error=self.on_error,
                    on_close=self.on_close,
                )
                tts.start(text, voice=voice)
            except Exception as exc:
                self.error = exc

        def on_data(self, data, *args):  # pragma: no cover
            try:
                with output_file_path.open("ab") as file:
                    file.write(data)
            except Exception as exc:  # pragma: no cover
                self.error = exc

        def on_metainfo(self, message, *args):  # pragma: no cover
            print("TTS metainfo:", message)

        def on_completed(self, message, *args):  # pragma: no cover
            print("TTS completed:", message)

        def on_error(self, message, *args):  # pragma: no cover
            print("TTS error:", message)
            self.error = TTSException(str(message))

        def on_close(self, *args):  # pragma: no cover
            pass

    output_file_path.parent.mkdir(parents=True, exist_ok=True)
    if output_file_path.exists():
        output_file_path.unlink()

    thread = SynthesizeThread()
    thread.start()
    thread.join()

    if thread.error:
        raise thread.error

    if not output_file_path.exists():
        raise TTSException("语音合成完成但未生成 PCM 文件。")
