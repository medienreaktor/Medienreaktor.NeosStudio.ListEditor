import type { FieldSchema, ItemSchema, Result } from './options'

/**
 * Items are stored and handed back exactly as they arrived: the editor never
 * rebuilds an item it did not edit, and editing one field of an object keeps
 * every other key - including keys the current configuration does not know.
 * A type changes only where a field's `type` option asks for it.
 */

export type ValueError =
  | { kind: 'not_a_list' }
  | { kind: 'item_mismatch'; index: number; expected: ItemSchema['kind'] }

const isObjectItem = (
  item: unknown,
): item is Readonly<Record<string, unknown>> =>
  typeof item === 'object' && item !== null && !Array.isArray(item)

/** The stored value as a list, or why it does not fit the configured schema. */
export function readItems(
  value: unknown,
  schema: ItemSchema,
): Result<readonly unknown[], ValueError> {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: { kind: 'not_a_list' } }

  const expectObjects = schema.kind === 'object'
  const index = value.findIndex(
    (item) => isObjectItem(item) !== expectObjects || Array.isArray(item),
  )
  if (index !== -1)
    return {
      ok: false,
      error: { kind: 'item_mismatch', index, expected: schema.kind },
    }
  return { ok: true, value }
}

/** The value one field shows: the item itself (scalar) or its key (object). */
export function fieldValue(item: unknown, name: string | null): unknown {
  if (name === null) return item
  return isObjectItem(item) ? item[name] : undefined
}

/** A copy of the item with one field replaced; untouched keys stay as they were. */
export function withFieldValue(
  item: unknown,
  name: string | null,
  value: unknown,
): unknown {
  if (name === null) return value
  return { ...(isObjectItem(item) ? item : {}), [name]: value }
}

/** A new, empty item. Empty items are stored like any other - the old behaviour. */
export function emptyItem(schema: ItemSchema): unknown {
  if (schema.kind === 'scalar') return emptyFieldValue(schema.field)
  return Object.fromEntries(
    schema.fields.map(([name, field]) => [name, emptyFieldValue(field)]),
  )
}

/** Text fields start as "", everything else (numbers, selects, …) as unset. */
function emptyFieldValue(field: FieldSchema): unknown {
  return field.type === 'string' ? '' : null
}
