const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

function cardinal(value: number): string {
  if (value < 20) return small[value]
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? `-${small[value % 10]}` : "")
  if (value < 1000) return `${small[Math.floor(value / 100)]} hundred${value % 100 ? ` and ${cardinal(value % 100)}` : ""}`
  for (const [scale, label] of [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1000, "thousand"]] as const) {
    if (value >= scale) return `${cardinal(Math.floor(value / scale))} ${label}${value % scale ? `${value % scale < 100 ? " and " : " "}${cardinal(value % scale)}` : ""}`
  }
  return String(value)
}

function digits(value: string) { return [...value].map(char => /\d/.test(char) ? small[Number(char)] : " ").join(" ").replace(/\s+/g, " ").trim() }
function number(value: string) {
  const raw = value.replace(/,/g, "")
  const [whole, fraction] = raw.split(".")
  const words = /^0\d/.test(whole) || whole.length > 15 ? digits(whole) : cardinal(Number(whole))
  return words + (fraction ? ` point ${digits(fraction)}` : "")
}

export function prepareEnglishNumbers(text: string, languageType?: string) {
  if (!/[A-Za-z]/.test(text) || /[\u3400-\u9fff]/.test(text) || languageType && !/^(auto|english|en(?:-gb|-us)?)$/i.test(languageType)) return { text, languageType }
  let spoken = text
    .replace(/([$£€])(\d[\d,]*)(?:\.(\d{1,2}))?(?!\d)/g, (_, symbol: string, whole: string, cents?: string) => {
      const unit = symbol === "$" ? "dollar" : symbol === "£" ? "pound" : "euro"
      const minor = symbol === "£" ? "pence" : "cents"
      const amount = Number(whole.replace(/,/g, ""))
      const fraction = cents ? Number(cents.padEnd(2, "0")) : 0
      return `${number(whole)} ${unit}${amount === 1 ? "" : "s"}${fraction ? ` and ${cardinal(fraction)} ${minor === "cents" && fraction === 1 ? "cent" : minor}` : ""}`
    })
    .replace(/\b(\d{1,2}):([0-5]\d)\b/g, (match, hour: string, minute: string) => Number(hour) > 23 ? match : `${number(hour)}${Number(minute) === 0 ? " o'clock" : Number(minute) < 10 ? ` oh ${cardinal(Number(minute))}` : ` ${number(minute)}`}`)
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, value: string) => {
      const words = number(value)
      const irregular: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" }
      return words.replace(/[a-z]+$/, last => irregular[last] || (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`))
    })
    .replace(/\b(\d[\d,]*(?:\.\d+)?)\s*%/g, (_, value: string) => `${number(value)} percent`)
    .replace(/\b(\d{3,4})[- ](\d{3,4})[- ](\d{3,4})\b/g, match => digits(match))
    .replace(/(?<![\w])\d+(?:,\d{3})*(?:\.\d+)?(?![\w])/g, value => number(value))
  // Whitespace is preserved except where numeric telephone separators were expanded.
  spoken = spoken.trim()
  return { text: spoken, languageType: "English" }
}
