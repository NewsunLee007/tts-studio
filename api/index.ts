import type { VercelRequest, VercelResponse } from "@vercel/node"

import { createApp } from "../server/src/index"

let appPromise: ReturnType<typeof createApp> | undefined

function forwardedPath(req: VercelRequest) {
  const rawPath = req.query.path
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath
  if (!path) return req.url || "/"

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item)
    } else if (typeof value === "string") {
      query.set(key, value)
    }
  }

  const pathname = path.startsWith("/") ? path : `/${path}`
  const qs = query.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  req.url = forwardedPath(req)
  appPromise ||= createApp()
  const app = await appPromise
  app(req, res)
}
