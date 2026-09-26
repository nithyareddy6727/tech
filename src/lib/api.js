import { supabase } from './supabase.js'

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '')

export async function api(path, options = {}) {
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {}
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)

  let response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  } catch {
    throw new Error(`Cannot reach the API at ${baseUrl}. Check VITE_API_BASE_URL and that the backend is running.`)
  }

  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const message = payload?.error || payload?.message || (typeof payload === 'string' ? payload : '')
    throw new Error(message || `Request failed (${response.status})`)
  }
  return payload
}

export const listFrom = (payload, key) => Array.isArray(payload) ? payload : (payload?.[key] || [])
export const jsonBody = (value) => JSON.stringify(value)