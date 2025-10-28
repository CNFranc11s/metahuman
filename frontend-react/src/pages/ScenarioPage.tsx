import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  sendTextMessage,
  sendVoiceMessage,
  startConversation,
  updateVoicePreference,
  controlSessionRecording,
} from '../api/chat'
import { fetchScenario } from '../api/scenarios'
import type { ConversationMessage, Scenario } from '../types'
import '../App.css'

type PttStatus = 'idle' | 'recording' | 'processing'
type SessionStatus = 'idle' | 'recording' | 'saved'
type VideoDebugInfo = {
  mounted: boolean
  loadedMetadata: boolean
  loadedData: boolean
  playing: boolean
  error: string | null
  width: number
  height: number
  lastEvent: string | null
  lastUpdated: string | null
}

const VOICE_OPTIONS = [
  { value: 'cally', label: 'Cally · 英文女声' },
  { value: 'xiaoyun', label: '小芸 · 中文女声' },
]

const convertBlobToPCM16 = async (blob: Blob, targetSampleRate = 16000) => {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioContext = new AudioContext()
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer)
    await audioContext.close()
    const OfflineContext =
      window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
    if (!OfflineContext) {
      console.warn('当前环境不支持 OfflineAudioContext，返回原始音频。')
      return blob
    }

    const offlineContext = new OfflineContext(
      1,
      Math.ceil(decodedBuffer.duration * targetSampleRate),
      targetSampleRate,
    )
    const source = offlineContext.createBufferSource()
    source.buffer = decodedBuffer
    source.connect(offlineContext.destination)
    source.start(0)

    const renderedBuffer = await offlineContext.startRendering()
    const channelData = renderedBuffer.getChannelData(0)
    const pcmBuffer = new ArrayBuffer(channelData.length * 2)
    const view = new DataView(pcmBuffer)

    for (let i = 0; i < channelData.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[i]))
      view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    }

    return new Blob([view], { type: 'audio/pcm' })
  } catch (err) {
    console.warn('音频转换失败，将发送原始音频。', err)
    return blob
  }
}

const convertPcmToWav = (pcmBlob: Blob, sampleRate = 16000) =>
  new Promise<Blob>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error('音频读取失败'))
        return
      }
      const pcmData = new Uint8Array(result)
      const wavBuffer = encodeWav(pcmData, sampleRate)
      resolve(new Blob([wavBuffer], { type: 'audio/wav' }))
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(pcmBlob)
  })

const encodeWav = (pcmData: Uint8Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(44 + pcmData.length)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + pcmData.length, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, pcmData.length, true)

  for (let i = 0; i < pcmData.length; i += 1) {
    view.setUint8(44 + i, pcmData[i])
  }

  return buffer
}

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}

const base64ToPcmBlob = (base64: string) => {
  const byteString = atob(base64)
  const byteArray = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i += 1) {
    byteArray[i] = byteString.charCodeAt(i)
  }
  return new Blob([byteArray.buffer], { type: 'audio/pcm' })
}

const base64ToBlob = (base64: string, mime: string) => {
  const byteString = atob(base64)
  const len = byteString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) {
    bytes[i] = byteString.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

const findLastAssistantIndex = (items: ConversationMessage[]) => {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]?.role === 'assistant') {
      return i
    }
  }
  return -1
}

const ScenarioPage = () => {
  const { id } = useParams<{ id: string }>()
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS[0].value)
  const selectedVoiceRef = useRef(selectedVoice)

  const [pttStatus, setPttStatus] = useState<PttStatus>('idle')
  const [pttStatusMessage, setPttStatusMessage] = useState('按住按钮开始单轮表达')
  const [pttRecorder, setPttRecorder] = useState<MediaRecorder | null>(null)
  const [isPttRecording, setIsPttRecording] = useState(false)
  const pttChunksRef = useRef<Blob[]>([])

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionStatusMessage, setSessionStatusMessage] = useState('未开始录制')
  const [isSessionRecording, setIsSessionRecording] = useState(false)
  const [sessionRecordingResult, setSessionRecordingResult] = useState<
    { url: string; mime: string } | null
  >(null)

  const [assistantAudioMap, setAssistantAudioMap] = useState<Record<number, string>>({})
  const assistantAudioMapRef = useRef<Record<number, string>>({})
  const allocatedAssistantUrlsRef = useRef(new Set<string>())
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)

  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // 添加用户交互状态跟踪
  const [userHasInteracted, setUserHasInteracted] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [welcomeAudioPlayed, setWelcomeAudioPlayed] = useState(false)
  // Debug相关状态（已隐藏debug面板）
  const [, setVideoDebugInfo] = useState<VideoDebugInfo>({
    mounted: false,
    loadedMetadata: false,
    loadedData: false,
    playing: false,
    error: null,
    width: 0,
    height: 0,
    lastEvent: null,
    lastUpdated: null,
  })

  const updateAssistantAudioMap = (
    updater: (current: Record<number, string>) => Record<number, string>,
  ) => {
    setAssistantAudioMap((prev) => {
      const next = updater(prev)
      assistantAudioMapRef.current = next
      return next
    })
  }

  const clearAssistantAudioMap = () => {
    updateAssistantAudioMap((prev) => {
      Object.values(prev).forEach((url) => {
        URL.revokeObjectURL(url)
        allocatedAssistantUrlsRef.current.delete(url)
      })
      return {}
    })
  }

  const syncVideoPlayback = (shouldPlay: boolean) => {
    const video = videoRef.current
    if (!video) {
      console.warn('视频元素不存在')
      return
    }

    console.log('同步视频播放状态:', shouldPlay ? '播放' : '暂停')

    if (shouldPlay) {
      // 检查视频是否已经播放
      if (!video.paused) {
        console.log('视频已在播放中')
        return
      }

      // 检查视频是否准备就绪
      if (video.readyState < 2) {
        console.log('视频未准备就绪，等待加载后播放')
        video.addEventListener('canplay', () => {
          if (isAudioPlaying) {
            video.play().catch((err) => {
              console.warn('视频加载后播放失败:', err)
            })
          }
        }, { once: true })
        return
      }

      video
        .play()
        .then(() => {
          console.log('视频播放成功，与音频同步')
          setIsAudioPlaying(true)
        })
        .catch((err) => {
          console.warn('视频播放受阻，尝试备选方案:', err)

          // 备选方案: 尝试静音播放
          video.muted = true
          video.play().then(() => {
            console.log('静音播放成功')
          }).catch((err2) => {
            console.warn('静音播放也失败:', err2)
          })
        })
    } else {
      video.pause()
      console.log('视频已暂停，等待音频播放')
      setIsAudioPlaying(false)
    }
  }

  const updateVideoDebug = (patch: Partial<VideoDebugInfo>, eventLabel?: string) => {
    setVideoDebugInfo((prev) => ({
      ...prev,
      ...patch,
      lastEvent: eventLabel ?? prev.lastEvent,
      lastUpdated: new Date().toLocaleTimeString(),
    }))
  }

  // 初始化音频上下文
  const initializeAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume()
      }
    }
  }

  // 处理用户首次交互
  const handleUserInteraction = () => {
    if (!userHasInteracted) {
      console.log('检测到用户首次交互，初始化音频上下文')
      setUserHasInteracted(true)
      initializeAudioContext()

      // 用户交互后，如果有欢迎音频且未播放过，则自动播放
      if (assistantAudioMapRef.current[0] && !welcomeAudioPlayed) {
        console.log('发现欢迎音频，开始自动播放')
        setTimeout(() => {
          if (assistantAudioMapRef.current[0] && !welcomeAudioPlayed) {
            playAssistantAudio(0)
          }
        }, 500)
      } else {
        console.log('用户交互完成，视频将等待语音播放时同步')
        // 确保视频处于暂停状态
        const video = videoRef.current
        if (video && !video.paused) {
          video.pause()
          console.log('视频已暂停，等待语音播放')
        }
      }
    }
  }

  // 专门用于监控视频元素挂载的useEffect
  useEffect(() => {
    // 延迟检查，确保DOM已经渲染
    const timer = setTimeout(() => {
      const video = videoRef.current
      if (video) {
        console.log('视频元素已挂载，开始监控加载状态:', {
          src: video.src,
          currentSrc: video.currentSrc,
          readyState: video.readyState,
          networkState: video.networkState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        })
        updateVideoDebug({
          mounted: true,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
        }, 'component-mount-delayed')

        // 检查视频文件是否能被加载
        const checkVideoLoad = () => {
          console.log('检查视频加载状态:', {
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: video.currentTime,
            duration: video.duration,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            paused: video.paused,
            ended: video.ended,
          })
          updateVideoDebug({
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            playing: !video.paused,
          })
        }

        // 视频加载重试机制
        let retryCount = 0
        const maxRetries = 3
        const retryVideoLoad = () => {
          if (retryCount < maxRetries && video.readyState === 0) {
            console.log(`视频加载重试 ${retryCount + 1}/${maxRetries}`)
            retryCount++
            video.load()
            setTimeout(retryVideoLoad, 2000)
          }
        }

        // 立即检查一次
        setTimeout(checkVideoLoad, 100)

        // 定期检查视频状态
        const interval = setInterval(checkVideoLoad, 2000)

        // 延迟重试加载
        setTimeout(retryVideoLoad, 3000)

        return () => {
          clearInterval(interval)
        }
      } else {
        console.log('视频元素尚未挂载，延迟重试...')
        updateVideoDebug({ mounted: false }, 'component-mount-failed')
        // 如果还没有挂载，继续尝试
        setTimeout(() => {
          if (videoRef.current) {
            updateVideoDebug({ mounted: true }, 'component-mount-success')
          }
        }, 1000)
      }
    }, 100) // 延迟100ms执行

    return () => {
      clearTimeout(timer)
    }
  }, [])

  const handleVideoLoadedMetadata = () => {
    const video = videoRef.current
    console.log('视频元数据已加载:', {
      src: video?.src,
      videoWidth: video?.videoWidth,
      videoHeight: video?.videoHeight,
      duration: video?.duration,
      readyState: video?.readyState,
    })
    updateVideoDebug(
      {
        loadedMetadata: true,
        width: video?.videoWidth ?? 0,
        height: video?.videoHeight ?? 0,
      },
      'loadedmetadata',
    )

    // 元数据加载完成后，确保视频默认暂停，等待语音播放时同步
    if (video) {
      console.log('视频元数据加载完成，视频将等待语音播放时同步')
      // 移除自动播放属性，确保视频暂停
      video.pause()
      updateVideoDebug({ playing: false }, 'metadata-loaded-paused')
    }
  }

  const handleVideoLoadedData = () => {
    const video = videoRef.current
    console.log('视频数据已加载:', {
      src: video?.src,
      currentTime: video?.currentTime,
      duration: video?.duration,
      readyState: video?.readyState,
      networkState: video?.networkState,
    })
    updateVideoDebug({ loadedData: true }, 'loadeddata')
  }

  const handleVideoPlay = () => {
    const video = videoRef.current
    console.log('视频开始播放:', {
      src: video?.src,
      currentTime: video?.currentTime,
      duration: video?.duration,
      paused: video?.paused,
      ended: video?.ended,
    })
    updateVideoDebug({ playing: true, error: null }, 'play')
  }

  const handleVideoPause = () => {
    updateVideoDebug({ playing: false }, 'pause')
  }

  const handleVideoError = () => {
    const video = videoRef.current
    let message = '未知错误'
    if (video?.error) {
      message = `code ${video.error.code}`
      if (video.error.message) {
        message = video.error.message
      }
      console.error('视频播放错误:', {
        error: video.error,
        code: video.error.code,
        message: video.error.message,
        src: video.src,
        networkState: video.networkState,
        readyState: video.readyState,
      })
    }
    updateVideoDebug({ error: message }, 'error')
  }

  useEffect(() => {
    if (!id) {
      setError('未找到对应的练习场景。')
      setLoading(false)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    const loadScenario = async () => {
      setLoading(true)
      try {
        const detail = await fetchScenario(Number(id), controller.signal)
        if (cancelled) {
          return
        }
        setScenario(detail)
        setConversationId(null)
        clearAssistantAudioMap()
        setMessages([])
        setPttStatus('idle')
        setPttStatusMessage('按住按钮开始单轮表达')
        setSessionStatus('idle')
        setSessionStatusMessage('未开始录制')
        setSessionRecordingResult((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev.url)
          }
          return null
        })
        await initializeConversationSession(detail.id, selectedVoiceRef.current)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        if (!cancelled) {
          setError('获取练习详情时出现问题，请稍后重试。')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadScenario()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice
  }, [selectedVoice])

  // 当用户首次交互后，如果有欢迎音频且未播放过，自动播放
  useEffect(() => {
    console.log('用户交互状态检查:', {
      userHasInteracted,
      welcomeAudioPlayed,
      hasWelcomeAudio: Boolean(assistantAudioMapRef.current[0]),
      audioMapKeys: Object.keys(assistantAudioMapRef.current)
    })

    if (userHasInteracted && assistantAudioMapRef.current[0] && !welcomeAudioPlayed) {
      console.log('条件满足，准备自动播放欢迎语音')
      // 延迟一点时间确保所有初始化完成
      setTimeout(() => {
        if (assistantAudioMapRef.current[0] && !welcomeAudioPlayed) {
          console.log('自动播放欢迎语音（首次）')
          playAssistantAudio(0)
        }
      }, 800)
    } else {
      console.log('自动播放条件不满足:', {
        userHasInteracted,
        hasWelcomeAudio: Boolean(assistantAudioMapRef.current[0]),
        welcomeAudioPlayed
      })
    }
  }, [userHasInteracted, welcomeAudioPlayed])

  useEffect(() => () => {
    if (pttRecorder && pttRecorder.state !== 'inactive') {
      pttRecorder.stop()
    }
  }, [pttRecorder])

  useEffect(() => () => {
    Object.values(assistantAudioMapRef.current).forEach((url) => {
      URL.revokeObjectURL(url)
    })
  }, [])

  useEffect(() => () => {
    if (sessionRecordingResult) {
      URL.revokeObjectURL(sessionRecordingResult.url)
    }
  }, [sessionRecordingResult])

  useEffect(() => () => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause()
    }
    if (videoRef.current) {
      videoRef.current.pause()
    }
    setIsAudioPlaying(false)
    console.log('组件卸载，已停止所有音视频播放')
  }, [])

  const playAudioUrl = (url: string) => {
    try {
      if (!userHasInteracted) {
        console.warn('用户尚未交互，无法播放音频')
        return
      }

      // 停止当前音频和视频
      if (activeAudioRef.current) {
        activeAudioRef.current.pause()
        activeAudioRef.current.currentTime = 0
        syncVideoPlayback(false)
      }

      const audio = new Audio(url)
      let audioStarted = false

      const handlePlaying = () => {
        console.log('音频开始播放:', url)
        if (!audioStarted) {
          audioStarted = true
          setIsAudioPlaying(true)
          syncVideoPlayback(true)
        }
      }

      const handleStop = () => {
        console.log('音频停止播放:', url)
        audioStarted = false
        setIsAudioPlaying(false)
        syncVideoPlayback(false)
      }

      const handleError = (err: Event) => {
        console.error('音频播放错误:', err)
        audioStarted = false
        setIsAudioPlaying(false)
        syncVideoPlayback(false)
      }

      // 添加事件监听器
      audio.addEventListener('playing', handlePlaying)
      audio.addEventListener('pause', handleStop)
      audio.addEventListener('ended', handleStop)
      audio.addEventListener('error', handleError)

      activeAudioRef.current = audio

      // 播放音频
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().then(() => {
          console.log('音频上下文已恢复，开始播放音频')
          return audio.play()
        }).catch((err) => {
          console.warn('音频播放失败: ', err)
          handleStop()
        })
      } else {
        audio.play().catch((err) => {
          console.warn('音频播放失败: ', err)
          handleStop()
        })
      }
    } catch (err) {
      console.warn('音频播放器初始化失败: ', err)
      setIsAudioPlaying(false)
      syncVideoPlayback(false)
    }
  }

  const playAssistantAudio = (index: number) => {
    const audioUrl = assistantAudioMapRef.current[index]
    if (audioUrl) {
      // 如果是欢迎音频（索引0），标记为已播放
      if (index === 0) {
        setWelcomeAudioPlayed(true)
        console.log('播放欢迎语音，标记为已播放')
      }
      playAudioUrl(audioUrl)
    }
  }

  const syncAudioMapWithMessages = (nextMessages: ConversationMessage[]) => {
    updateAssistantAudioMap((prev) => {
      const next: Record<number, string> = {}
      Object.entries(prev).forEach(([key, url]) => {
        const index = Number(key)
        if (
          Number.isFinite(index) &&
          nextMessages[index] &&
          nextMessages[index].role === 'assistant'
        ) {
          next[index] = url
        } else {
          URL.revokeObjectURL(url)
          allocatedAssistantUrlsRef.current.delete(url)
        }
      })
      return next
    })
  }

  const processAssistantAudio = async (
    nextMessages: ConversationMessage[],
    audioBase64?: string | null,
  ) => {
    console.log('processAssistantAudio 被调用:', {
      hasAudioBase64: Boolean(audioBase64),
      messageCount: nextMessages.length,
      userHasInteracted,
      welcomeAudioPlayed
    })

    if (!audioBase64) {
      console.log('没有音频数据，跳过处理')
      return
    }
    const assistantIndex = findLastAssistantIndex(nextMessages)
    if (assistantIndex === -1) {
      console.log('没有找到助手消息，跳过处理')
      return
    }

    try {
      const pcmBlob = base64ToPcmBlob(audioBase64)
      const wavBlob = await convertPcmToWav(pcmBlob)
      const audioUrl = URL.createObjectURL(wavBlob)
      allocatedAssistantUrlsRef.current.add(audioUrl)

      console.log('音频处理完成:', {
        assistantIndex,
        isFirstMessage: assistantIndex === 0,
        userHasInteracted,
        welcomeAudioPlayed
      })

      updateAssistantAudioMap((prev) => {
        const next = { ...prev }
        const existing = next[assistantIndex]
        if (existing) {
          URL.revokeObjectURL(existing)
          allocatedAssistantUrlsRef.current.delete(existing)
        }
        next[assistantIndex] = audioUrl
        console.log('音频已添加到映射:', { assistantIndex, audioUrl })
        return next
      })

      // 如果这是第一条助手消息（欢迎语）且用户已交互且未播放过，自动播放
      const isFirstMessage = assistantIndex === 0
      if (isFirstMessage && userHasInteracted && !welcomeAudioPlayed) {
        console.log('检测到欢迎语音，准备自动播放')
        setTimeout(() => {
          if (!welcomeAudioPlayed && assistantAudioMapRef.current[assistantIndex]) {
            console.log('执行自动播放欢迎语音')
            playAssistantAudio(assistantIndex)
          } else {
            console.log('欢迎语音播放条件已变化:', { welcomeAudioPlayed, hasAudio: Boolean(assistantAudioMapRef.current[assistantIndex]) })
          }
        }, 500) // 延迟500ms确保用户交互完成
      } else {
        console.log('非欢迎音频或条件不满足，正常播放:', {
          isFirstMessage,
          userHasInteracted,
          welcomeAudioPlayed
        })
        // 非欢迎音频正常播放
        playAudioUrl(audioUrl)
      }
    } catch (err) {
      console.warn('助手语音处理失败: ', err)
    }
  }

  const initializeConversationSession = async (
    scenarioId: number,
    voiceChoice: string,
  ) => {
    try {
      console.log('开始初始化对话会话:', { scenarioId, voiceChoice })

      // 重置欢迎音频播放状态，因为这是新的对话会话
      setWelcomeAudioPlayed(false)

      const response = await startConversation({
        scenarioId,
        voice: voiceChoice,
      })

      console.log('对话响应收到:', {
        conversationId: response.conversationId,
        messageCount: response.messages.length,
        hasAudio: Boolean(response.audioBase64)
      })

      setConversationId(response.conversationId)
      syncAudioMapWithMessages(response.messages)
      setMessages(response.messages)
      setChatError(null)

      await processAssistantAudio(response.messages, response.audioBase64)

      // 处理音频映射更新后的自动播放逻辑
      setTimeout(() => {
        console.log('检查初始化后的自动播放条件:', {
          userHasInteracted,
          hasWelcomeAudio: Boolean(assistantAudioMapRef.current[0]),
          welcomeAudioPlayed,
          audioMapKeys: Object.keys(assistantAudioMapRef.current)
        })

        // 如果用户已交互且有欢迎音频且未播放过，自动播放
        if (userHasInteracted && assistantAudioMapRef.current[0] && !welcomeAudioPlayed) {
          console.log('对话初始化完成，用户已交互，自动播放欢迎语音')
          playAssistantAudio(0)
        } else if (!userHasInteracted && assistantAudioMapRef.current[0]) {
          console.log('欢迎音频已准备好，等待用户交互后播放')
        } else {
          console.log('不满足自动播放条件:', {
            userHasInteracted,
            hasWelcomeAudio: Boolean(assistantAudioMapRef.current[0]),
            welcomeAudioPlayed
          })
        }
      }, 500) // 短延迟确保状态更新完成

    } catch (err) {
      console.error(err)
      setChatError('初始化对话失败，请稍后重试。')
    }
  }

  const handleSendText = async () => {
    if (!scenario) return
    const trimmed = inputValue.trim()
    if (!trimmed) return

    setIsSending(true)
    setChatError(null)
    try {
      const response = await sendTextMessage({
        scenarioId: scenario.id,
        message: trimmed,
        voice: selectedVoice,
        conversationId: conversationId ?? undefined,
      })
      setConversationId(response.conversationId)
      syncAudioMapWithMessages(response.messages)
      setMessages(response.messages)
      setInputValue('')
      await processAssistantAudio(response.messages, response.audioBase64)
    } catch (err) {
      console.error(err)
      setChatError('发送消息失败，请稍后再试。')
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSendText()
    }
  }

  const startPttRecording = async () => {
    if (!scenario || isPttRecording || pttStatus === 'processing') {
      return
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setChatError('当前浏览器不支持音频录制。')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      pttChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          pttChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setIsPttRecording(false)

        if (pttChunksRef.current.length === 0) {
          setPttStatus('idle')
          setPttStatusMessage('未捕获到音频，请重新尝试。')
          return
        }

        setPttStatus('processing')
        setPttStatusMessage('语音识别中，请稍候...')

        try {
          const webmBlob = new Blob(pttChunksRef.current, {
            type: recorder.mimeType,
          })
          const pcmBlob = await convertBlobToPCM16(webmBlob)
          const response = await sendVoiceMessage({
            scenarioId: scenario.id,
            audio: pcmBlob,
            voice: selectedVoice,
            conversationId: conversationId ?? undefined,
          })
          setConversationId(response.conversationId)
          syncAudioMapWithMessages(response.messages)
          setMessages(response.messages)
          setPttStatusMessage(
            response.transcript
              ? `识别结果：${response.transcript}`
              : '未识别到内容，已发送为空白。',
          )
          await processAssistantAudio(response.messages, response.audioBase64)
        } catch (err) {
          console.error(err)
          setChatError('发送语音失败，请检查网络或稍后再试。')
          setPttStatusMessage('语音发送失败，请重试。')
        } finally {
          pttChunksRef.current = []
          setPttStatus('idle')
        }
      }

      recorder.start()
      setPttRecorder(recorder)
      setIsPttRecording(true)
      setPttStatus('recording')
      setPttStatusMessage('录音中，松开按钮即可发送。')
    } catch (err) {
      console.error(err)
      setChatError('无法访问麦克风，请检查浏览器权限。')
      setPttStatusMessage('录制不可用。')
    }
  }

  const stopPttRecording = () => {
    if (!pttRecorder) return
    if (pttRecorder.state !== 'inactive') {
      pttRecorder.stop()
    }
  }

  const startSessionRecording = async () => {
    if (isSessionRecording) {
      return
    }
    if (!scenario || !conversationId) {
      setSessionStatus('idle')
      setSessionStatusMessage('请先与数字人开启对话后再开始录制。')
      return
    }
    try {
      setSessionStatusMessage('正在开启录制...')
      setSessionRecordingResult((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev.url)
        }
        return null
      })
      await controlSessionRecording({
        scenarioId: scenario.id,
        conversationId,
        action: 'start',
      })
      setIsSessionRecording(true)
      setSessionStatus('recording')
      setSessionStatusMessage('全程录制中，点击停止即可保存。')
    } catch (err) {
      console.error(err)
      setSessionStatus('idle')
      setSessionStatusMessage('无法开启录制，请稍后重试。')
    }
  }

  const stopSessionRecording = async () => {
    if (!isSessionRecording) {
      return
    }
    if (!scenario || !conversationId) {
      setSessionStatus('idle')
      setSessionStatusMessage('当前没有有效的会话，无法结束录制。')
      return
    }
    try {
      setSessionStatusMessage('录制结束，正在生成音频...')
      const result = await controlSessionRecording({
        scenarioId: scenario.id,
        conversationId,
        action: 'stop',
      })
      setIsSessionRecording(false)
      if (result.audioBase64) {
        const blob = base64ToBlob(result.audioBase64, 'audio/wav')
        setSessionRecordingResult((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev.url)
          }
          return { url: URL.createObjectURL(blob), mime: 'audio/wav' }
        })
        setSessionStatus('saved')
        setSessionStatusMessage('录制完成，可回放或下载。')
      } else {
        setSessionStatus('idle')
        setSessionStatusMessage('未生成录音，请稍后重试。')
      }
    } catch (err) {
      console.error(err)
      setSessionStatus('idle')
      setSessionStatusMessage('结束录制失败，请稍后重试。')
    }
  }

  const handleVoiceChange = async (value: string) => {
    setSelectedVoice(value)
    selectedVoiceRef.current = value
    if (!scenario || !conversationId) {
      return
    }
    try {
      const response = await updateVoicePreference({
        scenarioId: scenario.id,
        conversationId,
        voice: value,
      })
      setChatError(null)
      syncAudioMapWithMessages(response.messages)
      setMessages(response.messages)
      await processAssistantAudio(response.messages, response.audioBase64)
    } catch (err) {
      console.error(err)
      setChatError('切换声线时出现问题，但不会影响继续练习。')
    }
  }

  const isProcessing = useMemo(
    () => pttStatus === 'processing' || isSending,
    [pttStatus, isSending],
  )

  if (loading) {
    return <p className="status-message">加载练习详情中...</p>
  }

  if (error || !scenario) {
    return (
      <div className="status-wrapper">
        <p className="status-message error">{error ?? '未找到练习详情。'}</p>
        <Link to="/" className="back-link">
          返回列表
        </Link>
      </div>
    )
  }

  return (
    <div
      className="scenario-page"
      onClick={handleUserInteraction}
      onKeyDown={handleUserInteraction}
      onMouseDown={handleUserInteraction}
      onTouchStart={handleUserInteraction}
    >
      {/* Debug面板已隐藏 */}
      {/*
      <div className="video-debug-panel">
        ... debug content ...
      </div>
      */}

      <video
        className="scenario-bg-video"
        ref={videoRef}
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onLoadedMetadata={handleVideoLoadedMetadata}
        onLoadedData={handleVideoLoadedData}
        onPlay={handleVideoPlay}
        onPause={handleVideoPause}
        onError={handleVideoError}
        onLoadStart={() => console.log('视频开始加载')}
        onCanPlay={() => console.log('视频可以播放')}
        onCanPlayThrough={() => console.log('视频可以流畅播放')}
        onStalled={() => console.log('视频加载停滞')}
        onSuspend={() => console.log('视频加载暂停')}
        onAbort={() => console.log('视频加载中止')}
        onEmptied={() => console.log('视频数据清空')}
        onWaiting={() => console.log('视频等待数据')}
        onPlaying={() => console.log('视频正在播放')}
        onSeeking={() => console.log('视频跳转中')}
        onSeeked={() => console.log('视频跳转完成')}
        onEnded={() => console.log('视频播放结束')}
        onDurationChange={() => console.log('视频时长变化', videoRef.current?.duration)}
        onTimeUpdate={() => {
          // 减少时间更新的日志频率
          if (Math.floor(videoRef.current?.currentTime || 0) % 5 === 0) {
            console.log('视频时间更新:', videoRef.current?.currentTime)
          }
        }}
        onVolumeChange={() => console.log('视频音量变化')}
        onRateChange={() => console.log('视频播放速率变化')}
      >
        {/* 主视频源 */}
        <source src="/teacher_full.mp4" type="video/mp4" />
        {/* 备用视频源 */}
        <source src="/teacher.mp4" type="video/mp4" />
        {/* 浏览器不支持视频的提示 */}
        您的浏览器不支持视频播放。
        <track kind="captions" />
      </video>

      <main className="scenario-panel">
        <header className="scenario-detail-header">
          <Link to="/" className="back-link">
            ← 返回练习列表
          </Link>
          <div>
            <h1>{scenario.title}</h1>
            <p>{scenario.description}</p>
          </div>
        </header>

        <section className="scenario-detail-body">
          <div className="scenario-detail-right">
            <section className="voice-switcher">
              <div className="voice-header">
                <h2>声线选择</h2>
                <span className="voice-info">匹配数字人音色，稍后可扩展</span>
              </div>
              <select
                value={selectedVoice}
                onChange={(event) => handleVoiceChange(event.target.value)}
              >
                {VOICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </section>

            <section className="chat-window">
              <div className="chat-header-row">
                <h2>对话练习</h2>
                <span className="chat-focus">练习重点：{scenario.focus}</span>
              </div>
              <div className="chat-history" role="log" aria-live="polite">
                {messages.map((message, index) => {
                  const hasAudio = Boolean(assistantAudioMap[index])
                  return (
                    <div
                      key={`${message.role}-${index}`}
                      className={`chat-message ${message.role}`}
                    >
                      <div className="chat-bubble">
                        {message.content}
                        {message.role === 'assistant' && (
                          <button
                            type="button"
                            className={`speak-button ${hasAudio ? 'ready' : ''}`}
                            onClick={() => playAssistantAudio(index)}
                            disabled={!hasAudio}
                          >
                            {hasAudio ? '播放语音' : '语音生成中'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-input-row">
                <input
                  type="text"
                  placeholder="输入你的回答或提问"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isProcessing}
                />
                <button
                  type="button"
                  onClick={handleSendText}
                  disabled={isProcessing || !inputValue.trim()}
                >
                  {isSending ? '发送中...' : '发送'}
                </button>
              </div>
              {chatError && <p className="chat-error">{chatError}</p>}
            </section>

            <div className="press-to-talk-wrapper">
              <button
                type="button"
                className="press-to-talk"
                onMouseDown={startPttRecording}
                onMouseUp={stopPttRecording}
                onMouseLeave={() => isPttRecording && stopPttRecording()}
                onTouchStart={(event) => {
                  event.preventDefault()
                  startPttRecording()
                }}
                onTouchEnd={(event) => {
                  event.preventDefault()
                  stopPttRecording()
                }}
                disabled={pttStatus === 'processing'}
              >
                按住说话，松开发送
              </button>
              <span className={`press-to-talk-status ${pttStatus}`} aria-live="polite">
                {pttStatusMessage}
              </span>
            </div>
          </div>
        </section>

        {/* 临时调试按钮 - 测试自动播放 */}
        <div style={{
          padding: '1rem',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          borderRadius: '12px',
          marginBottom: '1rem',
          fontSize: '0.9rem'
        }}>
          <h4 style={{ margin: '0 0 0.5rem 0' }}>🔧 自动播放调试</h4>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                console.log('手动触发用户交互')
                handleUserInteraction()
              }}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              模拟用户交互
            </button>
            <button
              onClick={() => {
                if (assistantAudioMapRef.current[0]) {
                  console.log('手动播放欢迎音频')
                  playAssistantAudio(0)
                } else {
                  console.log('没有找到欢迎音频')
                }
              }}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              手动播放欢迎音频
            </button>
            <button
              onClick={() => {
                console.log('当前状态检查:', {
                  userHasInteracted,
                  welcomeAudioPlayed,
                  hasWelcomeAudio: Boolean(assistantAudioMapRef.current[0]),
                  audioMapKeys: Object.keys(assistantAudioMapRef.current),
                  messages: messages.length
                })
              }}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              检查当前状态
            </button>
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
            用户交互: {userHasInteracted ? '✅' : '❌'} |
            欢迎音频: {assistantAudioMapRef.current[0] ? '✅' : '❌'} |
            已播放: {welcomeAudioPlayed ? '✅' : '❌'}
          </div>
        </div>
      </main>

      <aside className="recording-panel">
        <div className="scenario-record-controls-horizontal">
          <div className="record-section">
            <h2>全程录制</h2>
            <span
              className={`record-status session ${sessionStatus}`}
              aria-live="polite"
            >
              {sessionStatusMessage}
            </span>
          </div>
          <div className="record-section-buttons">
            <button
              type="button"
              className="record-button primary"
              onClick={startSessionRecording}
              disabled={isSessionRecording}
            >
              {isSessionRecording ? '录制中...' : '开始录制'}
            </button>
            <button
              type="button"
              className="record-button"
              onClick={stopSessionRecording}
              disabled={!isSessionRecording}
            >
              停止录制
            </button>
          </div>
          {sessionRecordingResult && (
            <div className="session-playback-horizontal">
              <audio
                controls
                src={sessionRecordingResult.url}
                className="session-audio"
              />
              <a
                className="session-download"
                href={sessionRecordingResult.url}
                download={`session-${scenario.id}.${
                  sessionRecordingResult.mime.includes('wav') ? 'wav' : 'webm'
                }`}
              >
                下载录音
              </a>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

export default ScenarioPage
