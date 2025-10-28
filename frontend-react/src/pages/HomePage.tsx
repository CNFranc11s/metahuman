import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchScenarios } from '../api/scenarios'
import type { Scenario } from '../types'
import '../App.css'

const HomePage = () => {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const loadScenarios = async () => {
      try {
        const data = await fetchScenarios(controller.signal)
        setScenarios(data)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError('获取练习场景时出现问题，请检查网络或稍后重试。')
      } finally {
        setLoading(false)
      }
    }

    loadScenarios()

    return () => controller.abort()
  }, [])

  return (
    <main className="app-shell">
      <header className="hero">
        <h1>四级口语练习平台</h1>
        <p>
          精选八大实用口语情境，覆盖校园生活、旅行规划、日常对话等常见主题，帮助你扎实提升英语口语表达。
        </p>
      </header>

      {loading ? (
        <p className="status-message">加载练习场景中...</p>
      ) : error ? (
        <p className="status-message error">{error}</p>
      ) : (
        <section className="scenario-grid">
          {scenarios.map((scenario) => (
            <Link
              to={`/scenarios/${scenario.id}`}
              key={scenario.id}
              className="scenario-card link-card"
            >
              <h2>{scenario.title}</h2>
              <p>{scenario.description}</p>
              <span className="scenario-focus">
                核心技能：{scenario.focus}
              </span>
            </Link>
          ))}
        </section>
      )}
    </main>
  )
}

export default HomePage
