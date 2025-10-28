import json
import sys
import os

# 添加backend路径到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(current_dir, '..', 'backend-fastapi')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# 导入FastAPI应用
try:
    from main import app
    from mangum import Mangum
    asgi_handler = Mangum(app)
except ImportError as e:
    def handler(request):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": f"Import error: {str(e)}"})
        }
else:
    # Vercel入口点
    def handler(request):
        """
        Vercel函数入口点
        """
        try:
            # 简化的请求处理
            event = {
                "body": getattr(request, 'get_body', lambda: b'')(),
                "headers": dict(getattr(request, 'headers', {})),
                "httpMethod": getattr(request, 'method', 'GET'),
                "path": getattr(request, 'path', '/'),
                "queryStringParameters": dict(getattr(request, 'args', {}))
            }

            # 调用Mangum处理器
            response = asgi_handler(event, None)

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