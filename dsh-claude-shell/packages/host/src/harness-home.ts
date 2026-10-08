/**
 * One path under the harness home, resolved the host's own way.
 *
 * The harness publishes its home directory through the `dshHomePath` service,
 * which joins the segments it is handed; when that service is absent,
 * `$DSH_HOME` stands in, with `~/.dsh` behind it. Every host-half module that
 * touches stored data resolves through here, so the fonts drop point and the
 * delete route's sessions root are the same directories the harness itself
 * uses.
 *
 * @param ctx - host plugin context.
 * @param segments - path segments under the harness home.
 * @returns the resolved path.
 */
import { homedir } from 'node:os'
import type { DshContext } from './dsh.ts'
import { join } from 'node:path'

export function harnessPath(ctx: DshContext, ...segments: string[]): string {
  const resolvePath = ctx.get('dshHomePath')
  if (typeof resolvePath === 'function') return resolvePath(...segments)
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), ...segments)
}
