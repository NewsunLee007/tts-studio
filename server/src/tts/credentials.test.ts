import assert from "node:assert/strict"
import test from "node:test"

import { hasServerCredentials, resolveProviderCredentials } from "./credentials.js"

test("uses server credentials when the browser sends no secret", () => {
  const credentials = resolveProviderCredentials("dashscope", {}, { DASHSCOPE_API_KEY: "server-key" })

  assert.deepEqual(credentials, { apiKey: "server-key" })
  assert.equal(hasServerCredentials("dashscope", ["apiKey"], { DASHSCOPE_API_KEY: "server-key" }), true)
})

test("allows a temporary session credential to override the server default", () => {
  const credentials = resolveProviderCredentials(
    "tencent",
    { secretId: "session-id", secretKey: "session-key" },
    { TENCENT_SECRET_ID: "server-id", TENCENT_SECRET_KEY: "server-key" }
  )

  assert.equal(credentials.secretId, "session-id")
  assert.equal(credentials.secretKey, "session-key")
})

test("does not report a partially configured server provider as ready", () => {
  assert.equal(
    hasServerCredentials("xfyun", ["appId", "apiKey", "apiSecret"], {
      XFYUN_APP_ID: "app",
      XFYUN_API_KEY: "key"
    }),
    false
  )
})
