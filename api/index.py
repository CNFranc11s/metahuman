import json
import sys
import os

# 添加backend路径到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(current_dir, '..', 'backend-fastapi')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# 初始化ASGI handler
asgi_handler = None

# 导入FastAPI应用
try:
    from main import app
    from mangum import Mangum
    asgi_handler = Mangum(app)
    print("Backend loaded successfully")
except ImportError as e:
    print(f"Import error: {e}")
    asgi_handler = None
except Exception as e:
    print(f"Setup error: {e}")
    asgi_handler = None

# Vercel入口点 - 使用AWS Lambda风格的签名
def handler(event, context):
    """
    Vercel函数入口点
    """
    if not asgi_handler:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": "Backend not initialized"})
        }

    try:
        # 调用Mangum处理器
        response = asgi_handler(event, context)

        return {
            "statusCode": response.get("statusCode", 200),
            "headers": response.get("headers", {}),
            "body": response.get("body", "")
        }
    except Exception as e:
        print(f"Handler error: {e}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": str(e)})
        }