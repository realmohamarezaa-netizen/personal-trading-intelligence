// Minimal ambient types for `bun:test` so `bunx tsc --noEmit` (P6.5) type-checks
// the test files without pulling the full bun-types global environment into the
// app's type universe (bun-types conflicts with DOM+node globals used by the
// Next.js app, e.g. ReadableStream). Tests RUN under bun regardless; these
// declarations only need to cover the small API surface the tests use.

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface TestContext {}
  export function test(name: string, fn: () => void | Promise<void>): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function describe(name: string, fn: () => void): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
  export interface ExpectStatic {
    (actual: unknown): Assertions
    extend(matchers: Record<string, unknown>): void
  }
  export interface Assertions {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toStrictEqual(expected: unknown): void
    toBeTruthy(): void
    toBeFalsy(): void
    toBeNull(): void
    toBeUndefined(): void
    toBeDefined(): void
    toBeCloseTo(expected: number, numDigits?: number): void
    toContain(expected: unknown): void
    toHaveLength(len: number): void
    toBeGreaterThan(n: number): void
    toBeGreaterThanOrEqual(n: number): void
    toBeLessThan(n: number): void
    toBeLessThanOrEqual(n: number): void
    toThrow(expected?: string | RegExp | Error): void
    not: Assertions
    rejects: { toThrow(expected?: string | RegExp | Error): Promise<void> }
    resolves: { toBe(expected: unknown): Promise<void> }
  }
  export const expect: ExpectStatic
}
