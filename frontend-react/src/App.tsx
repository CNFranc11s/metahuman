import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ScenarioPage from './pages/ScenarioPage'
import './App.css'

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/scenarios/:id" element={<ScenarioPage />} />
        <Route
          path="*"
          element={
            <div className="status-wrapper">
              <p className="status-message error">页面未找到。</p>
              <a className="back-link" href="/">
                返回主页
              </a>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
