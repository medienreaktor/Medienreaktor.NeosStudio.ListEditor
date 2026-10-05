import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PropertyEditorProps } from '@medienreaktor/neos-studio'
import { ItemField } from './ItemField'
import { t, useI18nReady } from './i18n'
import {
  emptyItem,
  fieldValue,
  readItems,
  withFieldValue,
  type ValueError,
} from './items'
import {
  parseOptions,
  type FieldSchema,
  type ListEditorOptions,
  type OptionsError,
} from './options'

/**
 * The list editor: an array property as one row per item - add, edit, remove,
 * reorder. Items are plain values or objects (see options.ts); their inputs
 * come from Studio's own editor registry (see ItemField).
 *
 * Commit boundaries follow the editor contract: adding, removing, a finished
 * drag and a field's own commit (blur, Enter, a pick) call onCommit with the
 * whole list; every keystroke in a field reports the whole list via onChange.
 */
export function ListEditor(props: PropertyEditorProps) {
  useI18nReady()
  const options = useMemo(() => parseOptions(props.options), [props.options])
  if (!options.ok) return <Notice>{describeOptionsError(options.error)}</Notice>

  const items = readItems(props.value, options.value.item)
  if (!items.ok) return <Notice>{describeValueError(items.error)}</Notice>

  return <ItemList {...props} options={options.value} items={items.value} />
}

/**
 * A row's identity for React and drag-and-drop, independent of its position.
 * `item` is the committed item - the only value a field editor is handed:
 * editors compare their draft against `value` to decide whether there is
 * anything to commit, so feeding a live value back would swallow the commit.
 * `mounts` holds a key per field that changes whenever that field commits,
 * so editors that seed their state from `value` only once start over from
 * the committed value.
 */
interface Row {
  readonly id: number
  readonly item: unknown
  readonly mounts: Readonly<Record<string, number>>
}

type FocusTarget =
  | { readonly kind: 'handle'; readonly rowId: number }
  | { readonly kind: 'remove'; readonly index: number }
  | { readonly kind: 'add' }

let lastId = 0
const nextId = () => ++lastId

function ItemList({
  subject,
  items,
  options,
  onCommit,
  onChange,
  autoFocus,
  invalid,
  nodeAddress,
}: Omit<PropertyEditorProps, 'options' | 'value'> & {
  options: ListEditorOptions
  items: readonly unknown[]
}) {
  const { item: schema, min, max, controls } = options
  const fields: ReadonlyArray<readonly [string | null, FieldSchema]> =
    schema.kind === 'scalar' ? [[null, schema.field]] : schema.fields

  const [rows, setRows] = useState<readonly Row[]>(() =>
    items.map((item) => ({ id: nextId(), item, mounts: {} })),
  )
  // Mirrors `rows` for handlers that run before React re-renders - a field's
  // blur-commit and the click that caused the blur arrive back to back.
  const rowsRef = useRef(rows)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // The row whose first field takes focus when it mounts: a freshly added row,
  // or the first row when the host asks for autoFocus.
  const [focusRowId, setFocusRowId] = useState<number | null>(() =>
    autoFocus && rows.length > 0 ? rows[0].id : null,
  )
  const listRef = useRef<HTMLDivElement | null>(null)
  const pendingFocus = useRef<FocusTarget | null>(
    autoFocus && rows.length === 0 ? { kind: 'add' } : null,
  )

  useLayoutEffect(() => {
    const target = pendingFocus.current
    if (target === null || listRef.current === null) return
    pendingFocus.current = null
    focusElement(listRef.current, target)
  })

  // Uncommitted per-keystroke items by row id. Reported through onChange,
  // never handed back to the field editors (see Row).
  const liveItems = useRef(new Map<number, unknown>())
  const currentItem = (row: Row) =>
    liveItems.current.has(row.id) ? liveItems.current.get(row.id) : row.item

  const update = (next: readonly Row[]) => {
    rowsRef.current = next
    setRows(next)
  }
  /** The rows with every live edit folded in - what add, remove and move commit. */
  const settled = (): readonly Row[] => {
    const next = rowsRef.current.map((row) =>
      liveItems.current.has(row.id) ? { ...row, item: currentItem(row) } : row,
    )
    liveItems.current.clear()
    return next
  }
  const commit = (next: readonly Row[]) => {
    update(next)
    onCommit(next.map((row) => row.item))
  }

  const changeField = (rowId: number, name: string | null, value: unknown) => {
    const row = rowsRef.current.find((candidate) => candidate.id === rowId)
    if (row === undefined) return
    liveItems.current.set(rowId, withFieldValue(currentItem(row), name, value))
    onChange?.(rowsRef.current.map(currentItem))
  }

  const commitField = (rowId: number, name: string | null, value: unknown) => {
    const key = name ?? ''
    if (focusRowId === rowId) setFocusRowId(null)
    const next = rowsRef.current.map((row) =>
      row.id === rowId
        ? {
            ...row,
            item: withFieldValue(currentItem(row), name, value),
            mounts: { ...row.mounts, [key]: nextId() },
          }
        : row,
    )
    liveItems.current.delete(rowId)
    commit(next)
  }

  const add = () => {
    const row: Row = { id: nextId(), item: emptyItem(schema), mounts: {} }
    setFocusRowId(row.id)
    commit([...settled(), row])
  }

  const remove = (index: number) => {
    const next = settled().filter((_, i) => i !== index)
    pendingFocus.current =
      next.length > 0
        ? { kind: 'remove', index: Math.min(index, next.length - 1) }
        : { kind: 'add' }
    commit(next)
  }

  const moved = (
    current: readonly Row[],
    from: number,
    to: number,
  ): readonly Row[] => {
    const next = [...current]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    return next
  }

  const moveByKeyboard = (index: number, offset: -1 | 1) => {
    const to = index + offset
    if (to < 0 || to >= rowsRef.current.length) return
    pendingFocus.current = { kind: 'handle', rowId: rowsRef.current[index].id }
    commit(moved(settled(), index, to))
  }

  // Reorder live while dragging over rows, persist once on drop (the
  // SelectBoxEditor / MultiAssetFieldEditor pattern).
  const dragOver = (index: number) => {
    if (dragIndex === null || dragIndex === index) return
    update(moved(settled(), dragIndex, index))
    setDragIndex(index)
  }
  const dragEnd = () => {
    setDragIndex(null)
    commit(rowsRef.current)
  }

  const canMove = controls.move && rows.length > 1
  const canRemove = controls.remove && rows.length > min
  const canAdd = controls.add && (max === null || rows.length < max)
  const addLabel =
    options.buttonAddLabel === null
      ? t('add', 'Add item')
      : t(options.buttonAddLabel, options.buttonAddLabel)

  return (
    <div
      ref={listRef}
      className="mrle-list"
      data-invalid={invalid || undefined}
    >
      {rows.length === 0 && (
        <p className="mrle-empty">{t('empty', 'No items yet.')}</p>
      )}
      {rows.length > 0 && (
        <ol className="mrle-rows">
          {rows.map((row, index) => (
            <li
              key={row.id}
              data-mrle-row={row.id}
              className="mrle-row"
              data-dragging={dragIndex === index || undefined}
              onDragOver={(event) => {
                if (dragIndex === null) return
                event.preventDefault()
                dragOver(index)
              }}
              onDrop={(event) => {
                if (dragIndex !== null) event.preventDefault()
              }}
            >
              {canMove && (
                <button
                  type="button"
                  className="mrle-icon-button mrle-handle"
                  data-mrle-handle
                  draggable
                  aria-label={t('item.move', 'Move item {0}', [index + 1])}
                  title={t(
                    'item.moveHint',
                    'Drag to reorder, or use the arrow keys',
                  )}
                  onDragStart={(event) => {
                    // Firefox only starts a drag once dataTransfer carries something.
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', String(row.id))
                    const rowElement = event.currentTarget.closest('li')
                    if (rowElement !== null)
                      event.dataTransfer.setDragImage(rowElement, 16, 16)
                    setDragIndex(index)
                  }}
                  onDragEnd={dragEnd}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveByKeyboard(index, event.key === 'ArrowUp' ? -1 : 1)
                    }
                  }}
                >
                  <i className="fas fa-grip-vertical" aria-hidden />
                </button>
              )}
              <div className="mrle-fields" data-mrle-fields>
                {fields.map(([name, field], fieldIndex) => {
                  const key = name ?? ''
                  return (
                    <ItemField
                      key={`${key}:${row.mounts[key] ?? 0}`}
                      field={field}
                      name={
                        name === null ? subject.name : `${subject.name}.${name}`
                      }
                      value={fieldValue(row.item, name)}
                      onChange={(value) => changeField(row.id, name, value)}
                      onCommit={(value) => commitField(row.id, name, value)}
                      autoFocus={focusRowId === row.id && fieldIndex === 0}
                      nodeAddress={nodeAddress}
                    />
                  )
                })}
              </div>
              {controls.remove && (
                <button
                  type="button"
                  className="mrle-icon-button"
                  data-mrle-remove
                  disabled={!canRemove}
                  aria-label={t('item.remove', 'Remove item {0}', [index + 1])}
                  title={
                    canRemove
                      ? undefined
                      : t('item.removeMin', 'At least {0} items are required', [
                          min,
                        ])
                  }
                  onClick={() => remove(index)}
                >
                  <i className="fas fa-xmark" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {canAdd && (
        <button type="button" className="mrle-add" data-mrle-add onClick={add}>
          <i className="fas fa-plus" aria-hidden />
          {addLabel}
        </button>
      )}
    </div>
  )
}

function focusElement(list: HTMLElement, target: FocusTarget): void {
  const element = (() => {
    switch (target.kind) {
      case 'handle':
        return list.querySelector<HTMLElement>(
          `[data-mrle-row="${target.rowId}"] [data-mrle-handle]`,
        )
      case 'remove':
        return (
          list.querySelectorAll<HTMLElement>('[data-mrle-remove]')[
            target.index
          ] ?? null
        )
      case 'add':
        return list.querySelector<HTMLElement>('[data-mrle-add]')
      default:
        return assertNever(target)
    }
  })()
  // A disabled remove button (min reached) cannot take focus; fall back to the add button.
  if (element instanceof HTMLButtonElement && element.disabled) {
    list.querySelector<HTMLElement>('[data-mrle-add]')?.focus()
    return
  }
  element?.focus()
}

function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`)
}

function Notice({ children }: { children: string }) {
  return (
    <div className="mrle-notice" role="alert">
      {children}
    </div>
  )
}

function describeOptionsError(error: OptionsError): string {
  return t('error.invalidOption', 'The editor option "{0}" is invalid ({1}).', [
    error.option,
    error.reason,
  ])
}

function describeValueError(error: ValueError): string {
  switch (error.kind) {
    case 'not_a_list':
      return t(
        'error.notAList',
        'The stored value is not a list and cannot be edited here.',
      )
    case 'item_mismatch':
      return error.expected === 'object'
        ? t(
            'error.expectedObject',
            'Item {0} is a plain value, but the configuration expects objects (itemKey or properties).',
            [error.index + 1],
          )
        : t(
            'error.expectedScalar',
            'Item {0} is an object, but the configuration expects plain values. Configure itemKey or properties.',
            [error.index + 1],
          )
    default:
      return assertNever(error)
  }
}
