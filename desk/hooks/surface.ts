// What a screen can draw: the facts the band, the board and the tracer share. Plain values only; each area's own
// register.tsx asks the engine for the surface or the roster and passes it here.
import type { ElementTable, RenderSurface } from 'claude-code'

/**
 * The Svg element, or null where this surface draws no pictures: the terminal, whose table offers an Svg that draws
 * nothing, and any table without one. Text marks stand in for the pictures there.
 */
export const svgOf = (surface: RenderSurface, els: ElementTable) =>
  surface !== 'terminal' && 'Svg' in els && els.Svg !== undefined ? els.Svg : null

/**
 * The Input element, or null where this surface draws no typing field: the phone, whose table offers an Input that
 * draws nothing (the engine docs: mobile has no Input or Select), and any table without one.
 */
export const inputOf = (surface: RenderSurface, els: ElementTable) =>
  surface !== 'mobile' && 'Input' in els && els.Input !== undefined ? els.Input : null

/**
 * The cells a native Button draws beyond its label, off the terminal. Approximate: estimated from a pixel scan of the
 * 2026-10-15 20:03 EDT screenshot of the narrow Agents pane (docs/log/2026-10-15.md); which Button was scanned was not
 * recorded. About 5 CSS px of padding each side, about 1.2 columns in all, so 2 is a safe overestimate. Change it here
 * if the app shows another width.
 */
export const BUTTON_PAD = 2

/** The cells a Button draws beyond its label on this surface: none in the terminal, whose Buttons are text. */
export const buttonPad = (surface: RenderSurface): number => (surface === 'terminal' ? 0 : BUTTON_PAD)

/** Whether the desktop app is attached, given the roster `$.session.surfaces()` returns (it can list several). */
export const isAppAttached = (roster: readonly string[]): boolean => roster.includes('desktop')
