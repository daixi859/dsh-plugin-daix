/**
 * The plugin's host routes: everything the browser half cannot reach itself.
 *
 * These are the surfaces D11 describes — the model copy document, the
 * webfonts, the OS user and the HDSL account — each
 * registered on the host's web server under this plugin's route prefix.
 * Every route is registered on its own: one path the web server refuses is
 * reported, and the other routes still register.
 *
 * The paths are the shared contract (`@dsh-claude-shell/contracts/routes`,
 * D46): the browser half addresses the same names.
 */
import { HDSL_PATH, HDSL_SKIN_PATH, ROUTE_PREFIX, USERNAME_PATH } from '@dsh-claude-shell/contracts/routes'
import { existsSync, readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import type { DshContext, DshRequest, DshResponse, DshRoute, DshScope } from './dsh.js'
import { harnessPath } from './harness-home.js'
import { createHdslAccount } from './hdsl.js'
import type { HdslReading } from './hdsl.js'
import { packageRoot } from './package-root.js'

/** The copy document, built from `packages/client/data/model-descriptions.json` by scripts/build.mjs. */
const COPY_FILE = 'model-descriptions.json'
/**
 * Webfonts this plugin serves under `${ROUTE_PREFIX}/fonts/`, mapped to their
 * content type. The table is a whitelist: the filename is the whole request
 * contract, so no path outside the two directories below is reachable and no
 * path traversal is possible.
 *
 * A name is looked up in the user's own drop point first — the harness home's
 * `dsh-claude-shell/fonts/` — and then in the package's `lib/fonts/` (D11). The
 * JetBrains Mono files and the two look-alike faces behind the Anthropic ones
 * (Inter, Noto Serif) ship in the npm package; the Anthropic faces do not
 * (copyright), so only a copy the user dropped in answers them. A name neither
 * directory holds is absent: sendFile's ENOENT becomes a 404, which the browser
 * half's font stacks fall back from.
 */
const FONT_FILES = {
  'JetBrainsMonoVariable.ttf': 'font/ttf',
  'JetBrainsMonoItalicVariable.ttf': 'font/ttf',
  'AnthropicSansWebText.ttf': 'font/ttf',
  'AnthropicSerifWebText.ttf': 'font/ttf',
  'InterVariable.woff2': 'font/woff2',
  'NotoSerifVariable.woff2': 'font/woff2',
}
/**
 * Why a request to the username route must be refused, or undefined when it
 * may proceed.
 *
 * `webServer.register()` hands a plugin route raw requests: the host's own
 * `/api` sits behind a Host/Origin fence and the browser-session cookie, but
 * nothing puts a plugin route there, and this route reads the OS user. So it
 * borrows the host's own check, `connection.requestRejection()` — the fence and
 * authentication `/api` applies. The browser passes it with a same-origin
 * request that carries the session cookie; the desktop shell passes it because
 * it forwards to a loopback Host, drops the page's Origin and attaches the
 * cookie itself. A host without that service cannot authenticate anyone, so the
 * stand-in below serves loopback only: a loopback Host (which also defeats DNS
 * rebinding), no cross-site marker, and an Origin, when sent, naming that Host.
 *
 * @param ctx - host plugin context.
 * @param req - node request.
 * @returns 401 / 403, or undefined when the request may proceed.
 */
function refusalOf(ctx: DshContext, req: DshRequest) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection === 'function') return connection.requestRejection(req)
  const host = req.headers.host
  if (host !== undefined) {
    // A Host header that is no host name at all is refused.
    if (!URL.canParse(`http://${host}`)) return 403
    const name = new URL(`http://${host}`).hostname
    if (name !== 'localhost' && name !== '[::1]' && !/^127\.\d+\.\d+\.\d+$/.test(name)) return 403
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 403
  const origin = req.headers.origin
  if (origin === undefined) return undefined
  if (!URL.canParse(origin)) return 403
  return new URL(origin).host === host ? undefined : 403
}

/** Send one JSON response. */
function sendJson(res: DshResponse, status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Register the plugin's host routes.
 *
 * @param ctx - host plugin context.
 * @param scope - the inject scope that carries the `webServer` declaration, or
 *     `ctx` itself on a host whose context injects nothing.
 */
export function registerRoutes(ctx: DshContext, scope: DshScope) {
  // The built output and the bundled fonts hang off the plugin package's own
  // directory; the fonts a user drops in live under the harness home.
  const root = packageRoot()
  // The copy document is build output beside the client bundle in lib/.
  const file = join(root, 'lib', COPY_FILE)
  const fontsDir = join(root, 'lib', 'fonts')
  /** Where a user's own faces live; resolved per request, so a file added while the host runs is served. */
  const userFontsDir = () => harnessPath(ctx, 'dsh-claude-shell', 'fonts')

  /**
   * Answer one request under the route prefix with a static file.
   * @param res - node response.
   * @param method - request method; HEAD sends headers only.
   * @param path - absolute file to read.
   * @param headers - content-type / cache-control pair for the payload.
   */
  const sendFile = (res: DshResponse, method: string, path: string, headers: Record<string, string>) => {
    // An optional font the user never dropped in is absent: 404.
    if (!existsSync(path)) {
      res.writeHead(404)
      res.end()
      return
    }
    // Read per request: the files are small, and an in-place edit then shows
    // up on reload without restarting the host.
    const payload = readFileSync(path)
    res.writeHead(200, {
      ...headers,
      'content-length': String(payload.byteLength),
    })
    res.end(method === 'HEAD' ? undefined : payload)
  }

  /**
   * Answer 405 for a request whose method the route does not take.
   * @returns whether the request was turned away.
   */
  const methodRefused = (req: DshRequest, res: DshResponse, methods: string[]) => {
    if (req.method !== undefined && methods.includes(req.method)) return false
    res.writeHead(405, { allow: methods.join(', ') })
    res.end()
    return true
  }

  /**
   * The fence every route that reads the user's own data runs first: the
   * host's own check where that service exists, the loopback stand-in
   * otherwise (see refusalOf).
   * @returns whether the request was turned away.
   */
  const fenceRefused = (req: DshRequest, res: DshResponse) => {
    const refused = refusalOf(ctx, req)
    if (refused === undefined) return false
    sendJson(res, refused, { ok: false, error: refused === 401 ? 'unauthorized' : 'forbidden' })
    return true
  }

  scope.effect(() => {
    const disposers: (() => void)[] = []
    const report = (message: string, error: unknown) => ctx.logger?.warn?.(`dsh-claude-shell: ${message}: ${(error as { message?: string } | null)?.message ?? String(error)}`)
    const hdsl = createHdslAccount(ctx)

    /**
     * Register one route. The web server refuses a path another plugin already
     * holds by throwing; that refusal is reported and the other routes still
     * register, because a throw here would fail this fiber and drop the client
     * bundle — the whole skin — with it (docs/decisions D12).
     */
    const register = (label: string, route: DshRoute) => {
      try {
        disposers.push(scope.webServer?.register(route) as () => void)
      } catch (error) {
        report(`${label} route unavailable`, error)
      }
    }

    register('model copy', {
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req: DshRequest, res: DshResponse) => {
        if (methodRefused(req, res, ['GET', 'HEAD'])) return
        /* v8 ignore next -- node:http always sets url on server requests. */
        const sub = new URL(req.url ?? '/', 'http://x').pathname.slice(ROUTE_PREFIX.length)
        if (sub === `/${COPY_FILE}`) {
          sendFile(res, req.method ?? 'GET', file, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-cache',
          })
          return
        }
        const font = sub.startsWith('/fonts/') ? (FONT_FILES as Record<string, string | undefined>)[sub.slice('/fonts/'.length)] : undefined
        if (font !== undefined) {
          // The whitelisted name is the whole contract; the user's own copy
          // wins over the bundled face of the same name.
          const name = sub.slice('/fonts/'.length)
          const dropped = join(userFontsDir(), name)
          // The filename changes with the package, so a long cache is safe
          // and keeps the code face off the network after first paint.
          sendFile(res, req.method ?? 'GET', existsSync(dropped) ? dropped : join(fontsDir, name), {
            'content-type': font,
            'cache-control': 'public, max-age=86400',
          })
          return
        }
        res.writeHead(404)
        res.end()
      },
    })

    register('username', {
      kind: 'exact',
      path: USERNAME_PATH,
      handler: (req: DshRequest, res: DshResponse) => {
        // One-shot OS user resolution for the browser half; it caches the
        // response and never polls. The exact route wins over the prefix above.
        if (methodRefused(req, res, ['GET', 'HEAD'])) return
        if (fenceRefused(req, res)) return
        const username = userInfo().username || ''
        const body = Buffer.from(JSON.stringify({ ok: true, username }))
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.byteLength),
          'cache-control': 'no-cache',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    })

    register('HDSL account', {
      kind: 'exact',
      path: HDSL_PATH,
      handler: (req: DshRequest, res: DshResponse) => {
        // Read-only and same-origin only; the player's avatar path is dropped
        // here: the browser half needs a picture, not the home directory it
        // lives in.
        if (methodRefused(req, res, ['GET', 'HEAD'])) return
        if (fenceRefused(req, res)) return
        hdsl.read().then((profile: HdslReading) => {
          const { skinFile, ...account } = profile
          sendJson(res, 200, { ok: true, ...account })
        }, (error: unknown) => {
          sendJson(res, 500, { ok: false, error: String((error as { message?: string } | null)?.message ?? String(error)) })
        })
      },
    })

    register('HDSL skin', {
      kind: 'exact',
      path: HDSL_SKIN_PATH,
      handler: (req: DshRequest, res: DshResponse) => {
        // The player's own avatar. The path comes from the environment and
        // never from the request, so this route cannot be pointed anywhere; a
        // missing file is a 404 and the browser half falls back to the brand
        // mark.
        if (methodRefused(req, res, ['GET', 'HEAD'])) return
        if (fenceRefused(req, res)) return
        // A failed read propagates to the web server, which logs it and answers.
        return hdsl.read().then((profile: HdslReading) => {
          // A file removed under the launcher is a 404 like no file at all.
          if (typeof profile.skinFile !== 'string' || !existsSync(profile.skinFile)) {
            res.writeHead(404, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          const body = readFileSync(profile.skinFile)
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': String(body.byteLength),
            'cache-control': 'no-cache',
          })
          res.end(req.method === 'HEAD' ? undefined : body)
        })
      },
    })

    return () => {
      // One route's disposer failing must not keep the others registered
      // (docs/decisions D12); the failure is reported.
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          report('route disposal failed', error)
        }
      }
    }
  }, 'dsh-claude-shell: host routes')
}
