# Vercel 环境变量配置

根据后端代码分析，实际需要的环境变量如下：

## 可选的环境变量

### 阿里云NLS服务配置 (用于动态获取Token)

```bash
# 阿里云访问密钥ID
ALIYUN_AK_ID=your_access_key_id

# 阿里云访问密钥Secret
ALIYUN_AK_SECRET=your_access_key_secret

# 或者使用其他变量名
ALIYUN_ACCESS_KEY_ID=your_access_key_id
ALIYUN_ACCESS_KEY_SECRET=your_access_key_secret
```

### OpenAI/Kimi API 配置

```bash
# OpenAI API Key (如果不设置会使用hardcoded的key)
OPENAI_API_KEY=your_api_key

# OpenAI Base URL (如果不设置会使用hardcoded的moonshot url)
OPENAI_BASE_URL=https://api.moonshot.cn/v1

# OpenAI模型 (可选，默认kimi-k2-0905-preview)
OPENAI_MODEL=kimi-k2-0905-preview

# 对话温度 (可选，默认0.65)
OPENAI_TEMPERATURE=0.65
```

### TTS 配置 (可选)

如果需要自定义阿里云TTS服务配置，可以设置：

```bash
# 自定义TTS网关URL (可选，默认使用hardcoded的上海网关)
TTS_URL=wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1

# 自定义TTS AppKey (可选，默认使用hardcoded的appkey)
TTS_APPKEY=your_appkey

# 如果已有现成的Token，可以直接设置
ALIYUN_TOKEN=your_existing_token
```

## Hardcoded 的配置

目前以下配置已经在代码中hardcoded：

- **TTS URL**: `wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1`
- **TTS AppKey**: `5cbtQPiKRHTlevAH`
- **默认OpenAI Key**: `sk-fYZFY1EJHZc00ZjCjKnPutJnwYGHbw72ZGXnEFd41AeuE388`
- **默认Base URL**: `https://api.moonshot.cn/v1`
- **默认Model**: `kimi-k2-0905-preview`

## 在Vercel中设置环境变量

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 选择你的项目
3. 进入 Settings → Environment Variables
4. 添加上述环境变量
5. 选择环境 (Production, Preview, Development)
6. 点击 Save

## 注意事项

- **当前状态**: 应用可以在不设置任何环境变量的情况下运行（使用测试token）
- **生产环境**: 建议设置阿里云AK和OPENAI_API_KEY
- **安全性**: 避免在代码中暴露API密钥，使用环境变量更安全
- **阿里云权限**: 确保账号已开通NLS服务并有相应权限