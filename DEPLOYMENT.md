# 🚀 Vercel部署指南

## 📋 部署前准备

### 1. 安装依赖
```bash
# 全局安装Vercel CLI
npm i -g vercel

# 安装项目依赖
npm install
```

### 2. 环境变量配置
在Vercel控制台设置以下环境变量：

**OpenAI配置:**
- `OPENAI_API_KEY`: 你的OpenAI API密钥

**阿里云语音服务配置:**
- `ALIBABA_CLOUD_ACCESS_KEY_ID`: 阿里云AccessKey ID
- `ALIBABA_CLOUD_ACCESS_KEY_SECRET`: 阿里云AccessKey Secret
- `ALIBABA_CLOUD_APP_KEY`: 语音服务AppKey
- `ALIBABA_CLOUD_TTS_VOICE`: 语音类型 (如: "xiaoyun")
- `ALIBABA_CLOUD_TTS_VOLUME`: 音量 (如: 50)

## 🚀 部署步骤

### 方法1: 使用脚本部署
```bash
chmod +x deploy.sh
./deploy.sh
```

### 方法2: 手动部署

1. **构建前端**
```bash
cd frontend-react
npm install
npm run build
```

2. **部署到Vercel**
```bash
cd ..
vercel
```

3. **按照提示配置**
   - 选择项目范围
   - 确认项目设置
   - 等待部署完成

## 🔧 本地开发

```bash
# 启动后端和前端
npm run dev

# 或者分别启动
npm start  # 后端
cd frontend-react && npm run dev  # 前端
```

## 📁 项目结构

```
数字人/
├── frontend-react/     # React前端
├── backend-fastapi/    # FastAPI后端
├── api/               # Vercel Functions入口
├── vercel.json        # Vercel配置
├── deploy.sh          # 部署脚本
└── package.json       # 项目配置
```

## 🔍 故障排除

### 1. 部署失败
- 检查 `vercel.json` 配置
- 确认所有依赖都已安装
- 查看Vercel部署日志

### 2. API调用失败
- 检查环境变量是否正确设置
- 确认API基础URL配置正确
- 查看网络请求日志

### 3. 语音服务问题
- 验证阿里云凭证
- 检查语音服务配置
- 确认区域设置正确

## 🌐 访问应用

部署完成后，你可以通过以下方式访问：
- **生产环境**: `https://your-app.vercel.app`
- **预览环境**: 每次部署都会生成新的预览URL

## 📊 监控

- Vercel Analytics
- 函数执行日志
- 性能指标

## 🔄 更新部署

每次推送代码到主分支，Vercel会自动触发重新部署。