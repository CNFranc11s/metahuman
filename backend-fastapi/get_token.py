import json
import os
from typing import Optional

from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest


def _resolve_credentials() -> Optional[tuple[str, str, str]]:
    """
    Resolve Aliyun credentials from environment variables.

    Environment variables:
    - ALIYUN_ACCESS_KEY_ID or ALIBABA_CLOUD_ACCESS_KEY_ID
    - ALIYUN_ACCESS_KEY_SECRET or ALIBABA_CLOUD_ACCESS_KEY_SECRET
    - ALIYUN_REGION_ID or ALIBABA_CLOUD_REGION_ID (optional; defaults to cn-shanghai)
    """
    access_key = (
        os.getenv("ALIYUN_ACCESS_KEY_ID")
        or os.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID")
    )
    secret_key = (
        os.getenv("ALIYUN_ACCESS_KEY_SECRET")
        or os.getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
    )
    region = (
        os.getenv("ALIYUN_REGION_ID")
        or os.getenv("ALIBABA_CLOUD_REGION_ID")
        or "cn-shanghai"
    )

    if not access_key or not secret_key:
        return None
    return (access_key, secret_key, region)


def get_aliyun_token() -> tuple[Optional[str], Optional[str]]:
    """
    Request an Aliyun NLS token.

    Returns:
        tuple(token, expire_time) or (None, None) on failure.
    """
    try:
        credentials = _resolve_credentials()
        if credentials is None:
            raise ValueError("Missing Aliyun credentials.")

        access_key, secret_key, region = credentials
        client = AcsClient(access_key, secret_key, region)

        request = CommonRequest()
        request.set_method("POST")
        request.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
        request.set_version("2019-02-28")
        request.set_action_name("CreateToken")

        response = client.do_action_with_exception(request)
        payload = json.loads(response)

        token_info = payload.get("Token")
        if token_info and token_info.get("Id"):
            token = token_info["Id"]
            expire_time = token_info.get("ExpireTime")
            return token, expire_time

    except Exception as exc:  # pragma: no cover - pass-through for diagnostics
        print(f"Error getting Aliyun token: {exc}")

    return None, None
