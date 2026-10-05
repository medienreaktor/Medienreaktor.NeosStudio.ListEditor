import { useEffect, useState } from 'react'

/**
 * The plugin API has no translation service, so this mirrors the shell's own
 * lib/i18n.ts: fetch the same XLIFF-as-JSON bundle the shell loads, via
 * `window.__NEOS_STUDIO__` (a stable runtime global, not part of the published
 * plugin API), and resolve "Package:Source:id" against it.
 *
 * This package's strings live under
 * "Medienreaktor.NeosStudio.ListEditor:Main" (auto-included from
 * Configuration/Settings.yaml); call sites pass the bare trans-unit id plus
 * the English source text, which is what shows before the bundle arrives or
 * when a locale has no translation.
 */

type TranslationValue = string | string[]
type XliffBundle = Record<
  string,
  Record<string, Record<string, TranslationValue>>
>

declare global {
  interface Window {
    __NEOS_STUDIO__?: { xliffEndpoint?: string; interfaceLanguage?: string }
  }
}

const OWN_PACKAGE = 'Medienreaktor.NeosStudio.ListEditor'
const OWN_SOURCE = 'Main'

let bundle: XliffBundle | null = null
const listeners = new Set<() => void>()

function load(): void {
  if (bundle !== null) return
  const endpoint = window.__NEOS_STUDIO__?.xliffEndpoint ?? '/neos/xliff.json'
  const locale = window.__NEOS_STUDIO__?.interfaceLanguage ?? 'en'
  fetch(`${endpoint}?locale=${encodeURIComponent(locale)}`, {
    credentials: 'include',
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`XLIFF endpoint answered ${response.status}`)
      }
      return response.json()
    })
    .then((data: XliffBundle) => {
      bundle = data
      listeners.forEach((listener) => listener())
    })
    .catch((error: unknown) => {
      // An untranslated editor beats a broken one - but say why it is untranslated.
      console.error(`[${OWN_PACKAGE}] translations could not be loaded`, {
        endpoint,
        locale,
        cause: error,
      })
      bundle = {}
      listeners.forEach((listener) => listener())
    })
}

load()

/** Positional ({0}, {1}, …) or named ({name}) interpolation arguments. */
export type TranslateArgs =
  Array<string | number> | Record<string, string | number>

/** Replace {0}/{1}/… or {name} placeholders, mirroring Neos i18n. */
function interpolate(text: string, args?: TranslateArgs): string {
  if (!args) return text
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = Array.isArray(args)
      ? args[Number(key)]
      : (args as Record<string, string | number>)[key]
    return value === undefined ? match : String(value)
  })
}

function lookup(label: string): string | null {
  if (bundle === null) return null
  const parts = label.split(':')
  if (parts.length < 3) return null
  const [packageKey, sourceName, ...idParts] = parts
  const value =
    bundle[packageKey.replace(/\./g, '_')]?.[sourceName.replace(/\./g, '_')]?.[
      idParts.join(':').replace(/\./g, '_')
    ]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

/**
 * Translate one of this package's UI strings. Pass a fully-qualified
 * "Package:Source:id" to reuse a label from elsewhere. Plain function, not a
 * hook - pair with {@link useI18nReady} once per component so the component
 * re-renders when the bundle lands.
 */
export function t(id: string, fallback: string, args?: TranslateArgs): string {
  const label = id.includes(':') ? id : `${OWN_PACKAGE}:${OWN_SOURCE}:${id}`
  return interpolate(lookup(label) ?? fallback, args)
}

/** Re-renders the calling component once the XLIFF bundle has loaded. */
export function useI18nReady(): void {
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (bundle !== null) return
    const listener = () => forceRender((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
}
