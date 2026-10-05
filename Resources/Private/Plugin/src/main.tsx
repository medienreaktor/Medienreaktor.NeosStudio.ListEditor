import { editors } from '@medienreaktor/neos-studio'
import { ListEditor } from './ListEditor'
import './plugin.css'

/**
 * Plugin entry point. The StudioController injects this bundle as a deferred
 * `type="module"` tag after the shell's own module, so by the time this runs
 * the shell has installed its globals, registered its built-ins and mounted.
 */
editors.register({
  id: 'Medienreaktor.NeosStudio.ListEditor/Editor',
  component: ListEditor,
})
