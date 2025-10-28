import type { Scenario } from '../types'

const API_BASE_URL = import.meta.env.PROD
  ? '/api'
  : 'http://localhost:8000/api'

export const fetchScenarios = async (
  signal?: AbortSignal,
): Promise<Scenario[]> => {
  const response = await fetch(`${API_BASE_URL}/scenarios`, { signal })
  if (!response.ok) {
    throw new Error('Failed to load scenarios')
  }
  return response.json()
}

export const fetchScenario = async (
  id: number,
  signal?: AbortSignal,
): Promise<Scenario> => {
  const response = await fetch(`${API_BASE_URL}/scenarios/${id}`, { signal })
  if (!response.ok) {
    throw new Error('Failed to load scenario detail')
  }
  return response.json()
}
