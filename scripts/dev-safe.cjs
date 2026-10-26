#!/usr/bin/env node
'use strict'

/**
 * dev:safe — démarre EXCLUSIVEMENT `next dev` sur le port 3000 depuis ce dossier.
 *
 * Pourquoi : `next start` sert un build figé (`.next`) ; lancé sur 3000, il
 * affiche un ancien code et ne recharge jamais les modifications.
 *
 * Comportement :
 *   1. repère le processus qui écoute sur 3000 ;
 *   2. réutilise un `next dev` de CE projet déjà actif sur 3000 ;
 *   3. arrête un `next start` de CE projet qui occupe 3000 (jamais un `next build`) ;
 *   4. refuse tout processus inconnu ou appartenant à un autre projet ;
 *   5. vérifie NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ;
 *   6. lance `next dev -p 3000` et échoue si Next tente de basculer sur 3001.
 *
 * Options :
 *   --check                 diagnostic seul : n'arrête et ne lance rien
 *   --allow-missing-env     démarre même si les variables Supabase manquent
 *   --yes                   n'attend aucune confirmation (défaut : idem, non interactif)
 *   --env-from=<chemin>     copie NEXT_PUBLIC_SUPABASE_* d'un .env.local existant
 *                           vers ./.env.local (valeurs jamais affichées)
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

const PORT = 3000
const FORBIDDEN_PORTS = [3001]
const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']
const DEV_MARKER = '/_next/static/development/_buildManifest.js'

const PROJECT_DIR = fs.realpathSync(path.join(__dirname, '..'))
const NEXT_BIN = path.join(PROJECT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next')
const IS_WINDOWS = process.platform === 'win32'

const argv = process.argv.slice(2)
const opts = {
  check: argv.includes('--check'),
  allowMissingEnv: argv.includes('--allow-missing-env'),
  takeover: argv.includes('--takeover'),
  help: argv.includes('--help') || argv.includes('-h'),
  envFrom: (argv.find((a) => a.startsWith('--env-from=')) || '').split('=').slice(1).join('='),
}

if (opts.help) {
  console.log(
    [
      'dev:safe — démarre uniquement `next dev` sur le port 3000 depuis ce dossier.',
      '',
      'Options :',
      '  --check                diagnostic, aucune action',
      '  --allow-missing-env    démarre sans NEXT_PUBLIC_SUPABASE_* (pages en erreur)',
      '  --takeover             autorise l’arrêt d’un serveur Next lancé en chemin relatif',
      '  --env-from=<fichier>   copie les variables Supabase d’un .env.local existant',
      '  --help                 cette aide',
    ].join('\n'),
  )
  process.exit(0)
}

/* ─────────────────────────────── sortie ─────────────────────────────── */

const log = (msg) => console.log(`[dev:safe] ${msg}`)
const fail = (msg) => {
  console.error(`[dev:safe] ERREUR — ${msg}`)
  process.exit(1)
}

/* ───────────────────────────── utilitaires ───────────────────────────── */

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
  } catch {
    return ''
  }
}

function samePath(a, b) {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\')
  return norm(a) === norm(b)
}

/** Liste { pid, cmd } des processus lisibles sur la machine. */
function listProcesses() {
  if (IS_WINDOWS) {
    const raw = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
    ])
    if (!raw.trim()) return []
    try {
      const parsed = JSON.parse(raw)
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      return rows
        .filter((r) => r && r.ProcessId)
        .map((r) => ({ pid: Number(r.ProcessId), cmd: String(r.CommandLine || '') }))
    } catch {
      return []
    }
  }
  const raw = run('ps', ['-eo', 'pid=,args='])
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/)
      return match ? { pid: Number(match[1]), cmd: match[2] } : null
    })
    .filter(Boolean)
}

/** PIDs qui écoutent réellement sur le port. */
function listenersOnPort(port) {
  if (IS_WINDOWS) {
    const raw = run('netstat', ['-ano'])
    const pids = new Set()
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) continue
      if (parts[0] !== 'TCP') continue
      if (!parts[1].endsWith(`:${port}`)) continue
      if (parts[3] !== 'LISTENING') continue
      const pid = Number(parts[4])
      if (Number.isFinite(pid) && pid > 0) pids.add(pid)
    }
    return [...pids]
  }
  const raw = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  return raw
    .split('\n')
    .map((v) => Number(v.trim()))
    .filter((pid) => Number.isFinite(pid) && pid > 0)
}

/** Vrai si le serveur qui écoute répond comme un serveur de développement. */
function isDevServer(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: DEV_MARKER, timeout: 1500 },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

/** Le processus appartient-il à ce dossier de projet ? */
function belongsToProject(cmd) {
  if (!cmd) return false
  const normalized = cmd.toLowerCase().replace(/\//g, '\\')
  return normalized.includes(PROJECT_DIR.toLowerCase().replace(/\//g, '\\'))
}

/**
 * Serveur Next lancé avec un chemin relatif : impossible de prouver le dossier
 * de travail depuis la ligne de commande. On ne tue jamais « au hasard » :
 * l'arrêt exige alors `--takeover`.
 */
function isRelativeNextCommand(cmd) {
  if (!cmd) return false
  if (/[A-Za-z]:[\\/]|\\\\/.test(cmd)) return false
  return /node_modules[\\/]next[\\/]|next["']?\s+(dev|start|build)\b/i.test(cmd)
}

/* ─────────────────────────── arrêt de processus ─────────────────────────── */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Le PID existe-t-il encore ? (indépendant du port) */
function processAlive(pid) {
  if (IS_WINDOWS) {
    const raw = run('tasklist', ['/FI', `PID eq ${pid}`, '/NH'])
    return raw.includes(String(pid))
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function stopProcess(pid) {
  log(`arrêt du processus ${pid}…`)
  if (IS_WINDOWS) {
    run('taskkill', ['/PID', String(pid), '/T'])
    for (let i = 0; i < 10; i += 1) {
      await sleep(300)
      if (!processAlive(pid)) return true
    }
    run('taskkill', ['/PID', String(pid), '/T', '/F'])
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return true
    }
    for (let i = 0; i < 10; i += 1) {
      await sleep(300)
      if (!processAlive(pid)) return true
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* déjà terminé */
    }
  }
  for (let i = 0; i < 10; i += 1) {
    await sleep(300)
    if (!processAlive(pid)) return true
  }
  return !processAlive(pid)
}

/* ───────────────────────────── variables d'env ───────────────────────────── */

function parseEnvFile(file) {
  const values = {}
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return values
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

function envSources() {
  const projectFiles = ['.env.local', '.env.development.local', '.env'].map((name) =>
    path.join(PROJECT_DIR, name),
  )
  const found = []
  for (const file of projectFiles) {
    if (!fs.existsSync(file)) continue
    const values = parseEnvFile(file)
    if (ENV_KEYS.every((key) => values[key])) found.push({ file, values })
  }
  const fromShell = {}
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    fromShell.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    fromShell.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
  if (ENV_KEYS.every((key) => fromShell[key])) {
    found.push({ file: '(variables du shell)', values: fromShell })
  }
  return found
}

/** Hôte Supabase d'une URL (information publique, jamais la clé). */
function supabaseHost(url) {
  try {
    return new URL(url).host
  } catch {
    return '(URL invalide)'
  }
}

/** .env.local d'autres worktrees du même dépôt contenant les deux variables. */
function otherWorktreeEnvFiles() {
  const raw = run('git', ['worktree', 'list', '--porcelain'])
  const dirs = raw
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter((dir) => dir && !samePath(dir, PROJECT_DIR))
  const result = []
  for (const dir of dirs) {
    const file = path.join(dir, '.env.local')
    if (!fs.existsSync(file)) continue
    const values = parseEnvFile(file)
    if (!ENV_KEYS.every((key) => values[key])) continue
    result.push({ file, host: supabaseHost(values.NEXT_PUBLIC_SUPABASE_URL) })
  }
  return result
}

function linkEnvFile(source) {
  const values = parseEnvFile(source)
  if (!ENV_KEYS.every((key) => values[key])) {
    fail(`source invalide (variables manquantes) : ${source}`)
  }
  const target = path.join(PROJECT_DIR, '.env.local')
  const kept = fs.existsSync(target)
    ? fs
        .readFileSync(target, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() && !ENV_KEYS.some((key) => line.trim().startsWith(`${key}=`)))
    : []
  const lines = [...kept, ...ENV_KEYS.map((key) => `${key}=${values[key]}`)]
  fs.writeFileSync(target, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  log(`.env.local écrit — projet Supabase ciblé : ${supabaseHost(values.NEXT_PUBLIC_SUPABASE_URL)}`)
  log('fichier ignoré par Git ; clés jamais affichées.')
}

/* ───────────────────────────── lancement ───────────────────────────── */

function waitForPort(port, timeoutMs) {
  const started = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      if (listenersOnPort(port).length > 0) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

/** Attend que le serveur réponde comme un serveur de développement. */
async function waitForDevServer(port, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await isDevServer(port)) return true
    await sleep(500)
  }
  return false
}

/** Un `next build` tourne-t-il dans ce dossier ? (jamais interrompu) */
function buildInProgress() {
  return listProcesses().some(
    (p) => belongsToProject(p.cmd) && /next(\.cmd)?["']?\s+build|next\/dist\/bin\/next["']?\s+build/i.test(p.cmd),
  )
}

/** Serveurs de développement de ce projet lancés par erreur sur un autre port. */
async function devServersOnOtherPorts() {
  const processes = listProcesses()
  const found = []
  for (const port of FORBIDDEN_PORTS) {
    const pids = listenersOnPort(port)
    if (pids.length === 0) continue
    const own = pids.filter((pid) => belongsToProject((processes.find((p) => p.pid === pid) || {}).cmd))
    if (own.length === 0) continue
    if (!(await isDevServer(port))) continue
    found.push({ port, pids: own })
  }
  return found
}

/* ─────────────────────────────── principal ─────────────────────────────── */

async function main() {
  log(`projet : ${PROJECT_DIR}`)
  log(`port   : ${PORT} — uniquement \`next dev\` (jamais \`next start\`)`)

  if (opts.envFrom) linkEnvFile(path.resolve(opts.envFrom))

  // 1. Variables Supabase
  const found = envSources()
  if (found.length === 0) {
    const candidates = otherWorktreeEnvFiles()
    const lines = [
      `variables manquantes : ${ENV_KEYS.join(', ')}`,
      'aucun .env.local / .env exploitable dans ce dossier, ni dans les variables du shell.',
    ]
    if (candidates.length > 0) {
      lines.push('fichiers .env.local trouvés dans d’autres worktrees (projet Supabase visé, clés non affichées) :')
      lines.push(...candidates.map((c) => `  - ${c.file} → ${c.host}`))
      lines.push('vérifiez que le projet Supabase est bien celui de cette application avant de copier :')
      lines.push('  npm run dev:safe -- --env-from="<chemin du bon fichier>"')
    } else {
      lines.push('fournir ces deux variables dans un .env.local (ignoré par Git) ou dans le shell.')
    }
    lines.push('pour démarrer malgré tout : npm run dev:safe -- --allow-missing-env (pages Supabase en erreur).')
    if (!opts.allowMissingEnv) fail(lines.join('\n'))
    console.warn(`[dev:safe] AVERTISSEMENT — ${lines.join('\n')}`)
  } else {
    log(`variables Supabase : OK (source : ${found[0].file})`)
  }

  // 2. Port 3000
  const pids = listenersOnPort(PORT)
  if (pids.length > 0) {
    const processes = listProcesses()
    const occupied = pids.map((pid) => ({
      pid,
      cmd: (processes.find((p) => p.pid === pid) || {}).cmd || '',
    }))
    const foreign = occupied.filter(
      (entry) => !belongsToProject(entry.cmd) && !isRelativeNextCommand(entry.cmd),
    )
    if (foreign.length > 0) {
      fail(
        [
          `le port ${PORT} est occupé par un processus étranger à ce projet :`,
          ...foreign.map((entry) => `  PID ${entry.pid} — ${entry.cmd || 'commande inconnue'}`),
          'aucune action prise : libérez le port manuellement (les autres projets ne sont jamais touchés).',
        ].join('\n'),
      )
    }

    // Serveur Next lancé en chemin relatif : dossier invérifiable → accord explicite requis.
    const ambiguous = occupied.filter(
      (entry) => !belongsToProject(entry.cmd) && isRelativeNextCommand(entry.cmd),
    )
    if (ambiguous.length > 0 && !opts.takeover) {
      fail(
        [
          `le port ${PORT} est occupé par un serveur Next lancé avec un chemin relatif :`,
          ...ambiguous.map((entry) => `  PID ${entry.pid} — ${entry.cmd}`),
          'son dossier de travail ne peut pas être vérifié : aucune action automatique.',
          `relancez avec --takeover pour l’arrêter, ou libérez le port ${PORT} manuellement.`,
        ].join('\n'),
      )
    }

    if ((await isDevServer(PORT)) && ambiguous.length === 0) {
      log(`serveur de développement déjà actif sur http://localhost:${PORT} — réutilisation, rien à lancer.`)
      return
    }

    if (buildInProgress()) {
      fail('un `next build` est en cours dans ce projet — réessayez une fois le build terminé.')
    }
    if (opts.check) {
      log(
        `port ${PORT} occupé (PID ${pids.join(', ')}) par un serveur qui n’est pas un \`next dev\` — --check : aucune action.`,
      )
      return
    }
    if (ambiguous.length > 0) {
      log(`prise de contrôle explicite (--takeover) du serveur au chemin relatif (PID ${ambiguous.map((e) => e.pid).join(', ')}).`)
    }
    for (const pid of pids) {
      if (!(await stopProcess(pid))) fail(`impossible d'arrêter le processus ${pid} qui occupe le port ${PORT}.`)
    }
    log('ancien `next start` arrêté (build figé ; aucun build en cours n’a été interrompu).')
  } else {
    log(`port ${PORT} libre.`)
  }

  // 3. Aucun dev de ce projet sur un autre port (Next refuse deux dev par dossier)
  const strays = await devServersOnOtherPorts()
  if (strays.length > 0) {
    if (opts.check) {
      log(`serveur dev de ce projet détecté sur le port ${strays[0].port} — --check : aucune action.`)
      return
    }
    for (const stray of strays) {
      log(`serveur dev de ce projet détecté sur le port ${stray.port} — arrêt (le port imposé est ${PORT}).`)
      for (const pid of stray.pids) {
        if (!(await stopProcess(pid))) fail(`impossible d'arrêter le processus ${pid} (port ${stray.port}).`)
      }
    }
  }

  if (opts.check) {
    log(`--check : tout est prêt, \`next dev -p ${PORT}\` peut démarrer.`)
    return
  }

  // 4. Lancement
  log(`lancement : next dev -p ${PORT}`)
  const child = spawn(process.execPath, [NEXT_BIN, 'dev', '-p', String(PORT)], {
    cwd: PROJECT_DIR,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  let portSwitched = false
  const relay = (stream) => (chunk) => {
    const text = chunk.toString()
    stream.write(text)
    if (/\b3001\b/.test(text)) portSwitched = true
  }
  child.stdout.on('data', relay(process.stdout))
  child.stderr.on('data', relay(process.stderr))

  child.on('exit', (code) => {
    if (portSwitched && code === 0) {
      log('serveur arrêté : Next a tenté de basculer sur le port 3001 (interdit).')
      process.exit(1)
    }
    process.exit(code ?? 0)
  })

  const ready = await waitForPort(PORT, 30000)
  if (!ready || portSwitched) {
    log(`le serveur n'écoute pas sur ${PORT} — arrêt.`)
    child.kill()
    process.exit(1)
  }
  if (!(await waitForDevServer(PORT, 30000))) {
    log(`le serveur qui écoute sur ${PORT} ne répond pas comme un serveur de développement — arrêt.`)
    child.kill()
    process.exit(1)
  }

  log(`prêt : http://localhost:${PORT} (rechargement automatique actif).`)
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error))
})
