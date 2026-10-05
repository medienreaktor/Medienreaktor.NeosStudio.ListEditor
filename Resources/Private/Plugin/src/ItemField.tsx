import { useSyncExternalStore } from 'react'
import { editors } from '@medienreaktor/neos-studio'
import { t } from './i18n'
import type { FieldSchema } from './options'

const subscribe = (listener: () => void) => editors.subscribe(listener)
const snapshot = () => editors.getAll()

/**
 * One input of a list item, rendered by whatever editor the registry holds
 * under the field's editor id - the text field, a select box, a plugin's
 * editor. Nothing is re-implemented here; the field only supplies the label
 * (unless the editor renders its own) and routes the editor's callbacks.
 */
export function ItemField({
  field,
  name,
  value,
  onChange,
  onCommit,
  autoFocus,
  nodeAddress,
}: {
  field: FieldSchema
  /** Subject name the editor sees, e.g. "skus.sku". */
  name: string
  value: unknown
  onChange: (value: unknown) => void
  onCommit: (value: unknown) => void
  autoFocus: boolean
  nodeAddress?: string
}) {
  // Re-render when a plugin registers its editor after this one mounted.
  useSyncExternalStore(subscribe, snapshot)
  const definition = editors.getDefinition(field.editor)
  const label = field.label === null ? null : t(field.label, field.label)

  if (definition === undefined) {
    return (
      <div className="mrle-notice" role="alert">
        {t('error.unknownEditor', 'The editor "{0}" is not registered.', [
          field.editor,
        ])}
      </div>
    )
  }

  const Editor = definition.component
  return (
    <div className="mrle-field">
      {label !== null && !definition.rendersOwnLabel && (
        <div className="mrle-field-label">{label}</div>
      )}
      <Editor
        subject={{ name, type: field.type, label: label ?? name }}
        value={value}
        options={field.editorOptions}
        onChange={onChange}
        onCommit={onCommit}
        autoFocus={autoFocus}
        nodeAddress={nodeAddress}
      />
    </div>
  )
}
