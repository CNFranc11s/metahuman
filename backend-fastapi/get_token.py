import os
import json
from typing import Optional, Tuple

# 尝试加载.env文件中的环境变量
try:
    from dotenv import load_dotenv
    load_dotenv()
    DOTENV_AVAILABLE = True
except ImportError:
    DOTENV_AVAILABLE = False

try:
    from aliyunsdkcore.client import AcsClient
    from aliyunsdkcore.request import CommonRequest
    ALIYUN_SDK_AVAILABLE = True
except ImportError:
    ALIYUN_SDK_AVAILABLE = False

def get_aliyun_token() -> Tuple[Optional[str], Optional[int]]:
    """
    获取阿里云NLS Token
    按照阿里云官方SDK实现

    Returns:
        Tuple[Optional[str], Optional[int]]: (token, expire_time)
    """
    # 首先尝试从环境变量获取已有token
    token = os.getenv("ALIYUN_TOKEN") or os.getenv("ALIBABA_CLOUD_TOKEN")
    if token:
        return token.strip(), None

    # 如果阿里云SDK不可用，返回测试token
    if not ALIYUN_SDK_AVAILABLE:
        test_token = "3412a787fad54262a3ef3b5060085d68"
        return test_token, None

    try:
        # 创建AcsClient实例
        client = AcsClient(
            os.getenv('ALIYUN_AK_ID') or os.getenv('ALIYUN_ACCESS_KEY_ID'),
            os.getenv('ALIYUN_AK_SECRET') or os.getenv('ALIYUN_ACCESS_KEY_SECRET'),
            "cn-shanghai"
        )

        # 创建request，并设置参数
        request = CommonRequest()
        request.set_method('POST')
        request.set_domain('nls-meta.cn-shanghai.aliyuncs.com')
        request.set_version('2019-02-28')
        request.set_action_name('CreateToken')

        response = client.do_action_with_exception(request)
        jss = json.loads(response)

        if 'Token' in jss and 'Id' in jss['Token']:
            token = jss['Token']['Id']
            expireTime = jss['Token']['ExpireTime']
            return token, expireTime

    except Exception as e:
        print(f"Error getting Aliyun token: {e}")
        # 返回测试token作为fallback
        test_token = "3412a787fad54262a3ef3b5060085d68"
        return test_token, None

    return None, None
