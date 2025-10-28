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

# Vercel入口点
def handler(request):
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
        # 获取请求体
        body = b''
        if hasattr(request, 'get_body'):
            body = request.get_body()
        elif hasattr(request, 'body'):
            body = request.body

        # 获取查询参数
        query_params = {}
        if hasattr(request, 'args'):
            query_params = dict(request.args)
        elif hasattr(request, 'query_params'):
            query_params = dict(request.query_params)

        # 构建ASGI事件
        event = {
            "body": body,
            "headers": dict(getattr(request, 'headers', {})),
            "httpMethod": getattr(request, 'method', 'GET'),
            "path": getattr(request, 'path', '/'),
            "queryStringParameters": query_params
        }

        # 调用Mangum处理器
        response = asgi_handler(event, None)

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