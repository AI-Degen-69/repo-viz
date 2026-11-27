import type { RepoModel } from './repo'

export type AnalyzeResult = {
  repo: RepoModel
  source: 'github' | 'local'
  notice: string | null
  fetchedAt: string
}

export class AnalyzeError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'AnalyzeError'
    this.code = code
  }
}

type ErrorBody = { error?: string; code?: string }
type ResponseBody = AnalyzeResult & ErrorBody

export async function analyzeRepo(url: string, signal?: AbortSignal): Promise<AnalyzeResult> {
  let response: Response
  try {
    response = await fetch(`/api/repo?url=${encodeURIComponent(url)}`, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new AnalyzeError('Could not reach the server. Check your connection and try again.', 'network')
  }

  const body = (await response.json().catch(() => null)) as ResponseBody | null

  if (!response.ok || !body?.repo) {
    throw new AnalyzeError(body?.error ?? 'GitHub did not answer. Try again in a moment.', body?.code ?? 'unknown')
  }

  return {
    repo: body.repo,
    source: body.source ?? 'github',
    notice: body.notice ?? null,
    fetchedAt: body.fetchedAt ?? new Date().toISOString(),
  }
}
