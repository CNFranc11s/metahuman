#!/bin/bash

echo "🚀 开始部署到Vercel..."

# 检查是否已安装Vercel CLI
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI 未安装，请先安装："
    echo "npm i -g vercel"
    exit 1
fi

# 检查是否已登录Vercel
if ! vercel whoami &> /dev/null; then
    echo "🔐 请先登录Vercel："
    vercel login
fi

# 构建前端
echo "📦 构建前端..."
cd frontend-react
npm install
npm run build

# 返回根目录
cd ..

echo "✅ 部署准备完成！"
echo ""
echo "📋 下一步操作："
echo "1. 运行 'vercel' 进行部署"
echo "2. 按提示配置项目"
echo "3. 在Vercel控制台设置环境变量"
echo ""
echo "🔧 需要设置的环境变量："
echo "- OPENAI_API_KEY (OpenAI API密钥)"
echo "- ALIBABA_CLOUD_ACCESS_KEY_ID (阿里云AccessKey ID)"
echo "- ALIBABA_CLOUD_ACCESS_KEY_SECRET (阿里云AccessKey Secret)"
echo "- ALIBABA_CLOUD_APP_KEY (阿里云语音服务AppKey)"
echo "- ALIBABA_CLOUD_TTS_VOICE (语音类型)"
echo "- ALIBABA_CLOUD_TTS_VOLUME (音量)"