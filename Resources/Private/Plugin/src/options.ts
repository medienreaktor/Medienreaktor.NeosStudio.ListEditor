/**
 * The one door for editorOptions: node type configuration arrives untyped and
 * leaves as a ListEditorOptions, or as an error the editor shows in place of
 * the list. Option names follow mireo91/repeatablefields where it had one, so
 * its node type configuration works by switching the editor id alone.
 */

export const TEXT_FIELD_EDITOR = 'Neos.Neos/Inspector/Editors/TextFieldEditor'

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export type OptionsError = {
  kind: 'invalid_option'
  option: string
  reason: string
}

/** One input of an item, rendered through Studio's property editor registry. */
export interface FieldSchema {
  /** Label above the input - plain text or an XLIFF id; null renders none. */
  readonly label: string | null
  /** Editor id from the registry. */
  readonly editor: string
  readonly editorOptions: Readonly<Record<string, unknown>>
  /**
   * Handed to the editor as subject.type. The deliberate type conversion:
   * "integer"/"float" make the text field commit numbers, anything else
   * commits what the editor produces (a string, for the text field).
   */
  readonly type: string
}

export type ItemSchema =
  /** Every item is the value itself: ["a", "b"]. */
  | { readonly kind: 'scalar'; readonly field: FieldSchema }
  /** Every item is an object with one key per field: [{"sku": "a"}]. */
  | {
      readonly kind: 'object'
      readonly fields: ReadonlyArray<
        readonly [name: string, field: FieldSchema]
      >
    }

export interface ListEditorOptions {
  readonly item: ItemSchema
  readonly min: number
  /** null: no upper bound. */
  readonly max: number | null
  readonly controls: {
    readonly add: boolean
    readonly remove: boolean
    readonly move: boolean
  }
  /** Plain text or an XLIFF id; null uses the editor's own label. */
  readonly buttonAddLabel: string | null
}

const invalid = (
  option: string,
  reason: string,
): { ok: false; error: OptionsError } => ({
  ok: false,
  error: { kind: 'invalid_option', option, reason },
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseOptions(
  options: Record<string, unknown>,
): Result<ListEditorOptions, OptionsError> {
  const item = parseItemSchema(options)
  if (!item.ok) return item

  const min = parseCount(options, 'min')
  if (!min.ok) return min
  const max = parseCount(options, 'max')
  if (!max.ok) return max
  if (max.value !== null && min.value !== null && min.value > max.value) {
    return invalid('min', `must not exceed max (${max.value})`)
  }

  const controls = parseControls(options.controls)
  if (!controls.ok) return controls

  const buttonAddLabel = parseOptionalString(options, 'buttonAddLabel')
  if (!buttonAddLabel.ok) return buttonAddLabel

  return {
    ok: true,
    value: {
      item: item.value,
      min: min.value ?? 0,
      max: max.value,
      controls: controls.value,
      buttonAddLabel: buttonAddLabel.value,
    },
  }
}

/**
 * Three shapes, one result: no schema stores plain values, `itemKey` one text
 * field per object, `properties` any number of fields per object. `itemKey`
 * is the one-field special case of `properties`, so both end up identical.
 */
function parseItemSchema(
  options: Record<string, unknown>,
): Result<ItemSchema, OptionsError> {
  const { itemKey, properties } = options
  if (itemKey !== undefined && properties !== undefined) {
    return invalid('itemKey', 'cannot be combined with properties')
  }

  const placeholder = parseOptionalString(options, 'placeholder')
  if (!placeholder.ok) return placeholder
  const itemType = parseOptionalString(options, 'itemType')
  if (!itemType.ok) return itemType
  const textField: FieldSchema = {
    label: null,
    editor: TEXT_FIELD_EDITOR,
    editorOptions:
      placeholder.value === null ? {} : { placeholder: placeholder.value },
    type: itemType.value ?? 'string',
  }

  if (properties !== undefined) return parseProperties(properties)
  if (itemKey === undefined)
    return { ok: true, value: { kind: 'scalar', field: textField } }
  if (typeof itemKey !== 'string' || itemKey === '') {
    return invalid('itemKey', 'must be a non-empty string')
  }
  return { ok: true, value: { kind: 'object', fields: [[itemKey, textField]] } }
}

function parseProperties(
  properties: unknown,
): Result<ItemSchema, OptionsError> {
  if (!isRecord(properties) || Object.keys(properties).length === 0) {
    return invalid('properties', 'must be a map with at least one field')
  }
  const fields: Array<readonly [string, FieldSchema]> = []
  for (const [name, config] of Object.entries(properties)) {
    const field = parseField(name, config ?? {})
    if (!field.ok) return field
    fields.push([name, field.value])
  }
  return { ok: true, value: { kind: 'object', fields } }
}

/**
 * A field as repeatablefields configured it. Keys this editor does not use
 * (validation, defaultValue, …) are ignored rather than rejected, so existing
 * configuration keeps loading.
 */
function parseField(
  name: string,
  config: unknown,
): Result<FieldSchema, OptionsError> {
  const option = `properties.${name}`
  if (!isRecord(config)) return invalid(option, 'must be a map')

  const label = parseOptionalString(config, 'label', option)
  if (!label.ok) return label
  const editor = parseOptionalString(config, 'editor', option)
  if (!editor.ok) return editor
  const type = parseOptionalString(config, 'type', option)
  if (!type.ok) return type
  const editorOptions = config.editorOptions ?? {}
  if (!isRecord(editorOptions))
    return invalid(`${option}.editorOptions`, 'must be a map')

  return {
    ok: true,
    value: {
      label: label.value,
      editor: editor.value ?? TEXT_FIELD_EDITOR,
      editorOptions,
      type: type.value ?? 'string',
    },
  }
}

function parseCount(
  options: Record<string, unknown>,
  name: string,
): Result<number | null, OptionsError> {
  const value = options[name]
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return invalid(name, 'must be a non-negative integer')
  }
  return { ok: true, value }
}

function parseControls(
  value: unknown,
): Result<ListEditorOptions['controls'], OptionsError> {
  if (value === undefined || value === null) {
    return { ok: true, value: { add: true, remove: true, move: true } }
  }
  if (!isRecord(value)) return invalid('controls', 'must be a map')
  const flags = { add: true, remove: true, move: true }
  for (const name of ['add', 'remove', 'move'] as const) {
    const flag = value[name]
    if (flag === undefined) continue
    if (typeof flag !== 'boolean')
      return invalid(`controls.${name}`, 'must be true or false')
    flags[name] = flag
  }
  return { ok: true, value: flags }
}

function parseOptionalString(
  options: Record<string, unknown>,
  name: string,
  prefix?: string,
): Result<string | null, OptionsError> {
  const value = options[name]
  if (value === undefined || value === null || value === '')
    return { ok: true, value: null }
  if (typeof value !== 'string')
    return invalid(prefix ? `${prefix}.${name}` : name, 'must be a string')
  return { ok: true, value }
}
