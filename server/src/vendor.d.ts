declare module "@ffmpeg-installer/ffmpeg" {
  const ffmpeg: { path: string; version: string; url: string }
  export default ffmpeg
  export const path: string
}

declare module "@neondatabase/serverless" {
  export function neon(connectionString: string): (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>
}
