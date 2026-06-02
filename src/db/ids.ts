// Minimal ULID generator (Crockford base32, 48-bit time + 80-bit randomness).
// Inlined rather than pulled in as a dependency, per SPEC §3.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford's base32
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(time: number): string {
  let str = ''
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % 32
    str = ENCODING[mod] + str
    time = (time - mod) / 32
  }
  return str
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN)
  crypto.getRandomValues(bytes)
  let str = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[bytes[i] % 32]
  }
  return str
}

/** Returns a lexicographically sortable 26-char ULID. */
export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom()
}
