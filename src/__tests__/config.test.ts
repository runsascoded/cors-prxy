import { describe, it, expect } from "vitest"
import { parseWindow } from "../config.js"

describe("parseWindow", () => {
  it("parses milliseconds", () => {
    expect(parseWindow("500ms")).toBe(500)
  })

  it("parses seconds", () => {
    expect(parseWindow("30s")).toBe(30_000)
  })

  it("parses minutes", () => {
    expect(parseWindow("1m")).toBe(60_000)
    expect(parseWindow("5m")).toBe(300_000)
  })

  it("parses hours", () => {
    expect(parseWindow("1h")).toBe(3_600_000)
  })

  it("throws on invalid format", () => {
    expect(() => parseWindow("abc")).toThrow("Invalid window format")
    expect(() => parseWindow("10d")).toThrow("Invalid window format")
    expect(() => parseWindow("")).toThrow("Invalid window format")
  })
})
