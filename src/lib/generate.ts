import { randomInt } from "crypto";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

export const DEFAULT_SPECIALS = "!@#$%^&*()_";
export const MAX_LENGTH = 128;

function pools(specials: string): string[] {
  const uniqueSpecials = [...new Set(specials)].join("");
  return uniqueSpecials ? [UPPER, LOWER, DIGITS, uniqueSpecials] : [UPPER, LOWER, DIGITS];
}

/** Smallest length that can hold one character from every required class. */
export function minLength(specials: string): number {
  return pools(specials).length;
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/**
 * Generates a password with at least one uppercase letter, one lowercase letter,
 * one digit and, if `specials` is non-empty, one character from `specials`.
 */
export function generatePassword(length: number, specials: string): string {
  const required = pools(specials);
  if (length < required.length) {
    throw new Error(`Length must be at least ${required.length}`);
  }

  const all = required.join("");
  const chars = required.map(pick);
  while (chars.length < length) chars.push(pick(all));

  // Fisher–Yates, so the required characters don't always lead
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
