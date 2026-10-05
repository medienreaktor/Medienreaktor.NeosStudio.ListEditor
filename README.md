# Medienreaktor.NeosStudio.ListEditor

A list editor for **Neos Studio** (`Medienreaktor.NeosStudio`): edit an
`array` property as one row per item - add, edit, remove and reorder.

It replaces [mireo91/repeatablefields](https://github.com/mireo91/RepeatableFields),
which does not run on Neos 9. It reads the same editor options and the same
stored data, so existing node types work by switching the editor id alone.

## Installation

```bash
composer require --no-update medienreaktor/neos-studio-list-editor
```

Then run `composer update` in your project root and flush the Flow caches.

## Configuration

The editor id is `Medienreaktor.NeosStudio.ListEditor/Editor`. The property
must be `type: array`. Three shapes are supported:

### A list of strings

```yaml
keywords:
  type: array
  ui:
    label: 'Keywords'
    inspector:
      group: 'general'
      editor: 'Medienreaktor.NeosStudio.ListEditor/Editor'
      editorOptions:
        placeholder: 'Keyword'
```

Stored as `["solar", "battery"]`.

### A list of objects with one key

```yaml
skus:
  type: array
  ui:
    inspector:
      editor: 'Medienreaktor.NeosStudio.ListEditor/Editor'
      editorOptions:
        itemKey: sku
        buttonAddLabel: 'Add SKU'
        placeholder: 'SKU'
```

Stored as `[{"sku": "a"}, {"sku": "b"}]` - the format repeatablefields wrote
for a single sub-field, so existing data stays editable without migration.

### A list of objects with several fields

The repeatablefields configuration, unchanged:

```yaml
skus:
  type: array
  ui:
    inspector:
      editor: 'Medienreaktor.NeosStudio.ListEditor/Editor'
      editorOptions:
        buttonAddLabel: 'Add SKU'
        max: 100
        min: 0
        controls: { move: true, remove: true, add: true }
        properties:
          sku:
            type: integer
            editorOptions: { placeholder: 'SKU' }
          color:
            label: 'Colour'
            editor: 'Neos.Neos/Inspector/Editors/SelectBoxEditor'
            editorOptions:
              values:
                red: { label: 'Red' }
                blue: { label: 'Blue' }
```

Every field renders through **Studio's own editor registry**: the text field,
the select box, a plugin's editor - whatever is registered under `editor`
(default: the text field). Nothing is re-implemented here, so a field looks
and behaves exactly like the same editor in the inspector.

`itemKey: sku` is shorthand for `properties: { sku: {} }`; the two cannot be
combined.

### Options

| Option | Default | |
|---|---|---|
| `itemKey` | - | Store objects with this one key instead of plain values. |
| `properties` | - | Store objects with these fields: `label`, `editor`, `editorOptions`, `type`. |
| `itemType` | `string` | `type` of the single field in the plain and `itemKey` shapes. |
| `placeholder` | - | Placeholder of the single field in the plain and `itemKey` shapes. |
| `min` | `0` | Rows cannot be removed below this count. |
| `max` | unlimited | The add button disappears at this count. |
| `controls.add` / `.remove` / `.move` | `true` | Switch the respective control off. |
| `buttonAddLabel` | "Add item" | Plain text or an XLIFF id. |

Keys repeatablefields knew but this editor does not use (`validation`,
`defaultValue`, …) are ignored, so existing configuration keeps loading. An
option of the wrong type replaces the list with a notice naming the option.

## Stored values

- **Values are stored and returned unchanged.** An item that is not edited is
  written back exactly as it was read, numbers included. Editing one field of
  an object keeps every other key, including keys the configuration does not
  know.
- **A type changes only where `type` asks for it.** The value of an edited
  field is what its editor produces: the text field commits a string, or a
  number with `type: integer` / `float`. A legacy `{"sku": 123}` therefore
  stays `123` until it is edited; edited without `type: integer` it becomes
  `"124"`.
- **Empty items are stored**, as repeatablefields did. A new row starts as `""`
  for text fields and `null` for every other `type`.
- An unset (`null`) property shows as an empty list.
- A stored value that does not fit the configuration - not a list, or plain
  values where objects are configured (or the reverse) - is shown as a notice
  and never overwritten.

## Editing

- Rows reorder by dragging the handle, or with <kbd>↑</kbd>/<kbd>↓</kbd> while
  the handle has focus.
- Adding, removing and reordering save immediately; a field saves when its
  editor commits (blur, <kbd>Enter</kbd>, a pick). In the node creation dialog
  every keystroke is reported as well.

## Building

The bundle is prebuilt into `Resources/Public/Plugin/`. To rebuild:

```bash
cd Resources/Private/Plugin
npm install
npm run build        # emits Resources/Public/Plugin/{plugin.js,plugin.css}
```

Then flush the Flow caches and reload `/neos/studio`.

`@medienreaktor/neos-studio` (the type declarations of the Studio plugin API)
is a `file:` dependency resolved **relative to this package's place inside a
Neos distribution**: the committed path assumes the working copy sits at
`DistributionPackages/Medienreaktor.NeosStudio.ListEditor/` next to an
installed `Packages/Application/Medienreaktor.NeosStudio/`. Cloned anywhere
else, adjust it in `Resources/Private/Plugin/package.json`; it is needed for
types only.

React, ReactDOM and the plugin API are external at runtime and resolve to the
globals the Studio shell publishes on `window`.

## Limitations

- `ClientEval` expressions in editor options are not evaluated.
- Per-field `validation` is not run; validators configured on the property
  itself are, by the host.
- The editor needs `Medienreaktor.NeosStudio` ≥ 1.13 for the `editors`
  registry.
- **Saves in quick succession can collide.** The Studio inspector persists
  every commit as its own request, without a queue. When two commits overlap -
  adding a row and committing its field within the round trip of the first
  save - the content repository rejects one of them with a concurrency error
  (HTTP 422, "Saving failed"). If the rejected one is the newer, its input is
  lost although the editor still shows it. The editor commits the whole list
  each time, so a later commit repairs it; the fix belongs in the inspector,
  which has to serialize saves per node and property.

## License

This package is free software, released under the
[GNU General Public License, version 3 or later](LICENSE).
