import json
import sys
import os
from pathlib import Path

# 添加backend路径到Python路径
sys.path.append(str(Path(__file__).parent.parent / "backend-fastapi"))

# 导入FastAPI应用
try:
    from main import app
    from mangum import Mangum
    handler = Mangum(app)
except ImportError as e:
    print(f"Import error: {e}")
    print("Please install missing packages: pip install mangum")
    sys.exit(1)

# Vercel入口点
def handler_vercel(request):
    """
    Vercel函数入口点
    """
    try:
        # 将Vercel请求转换为ASGI请求
        event = {
            "body": request.get_body(),
            "headers": dict(request.headers),
            "httpMethod": request.method,
            "path": request.path,
            "queryStringParameters": dict(request.args) if hasattr(request, 'args') else {}
        }

        # 调用Mangum处理器
        response = handler(event, None)

        return {
            "statusCode": response.get("statusCode", 200),
            "headers": response.get("headers", {}),
            "body": response.get("body", "")
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": str(e)})
        }