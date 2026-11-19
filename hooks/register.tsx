import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Apunte, Libreta } from '../types'

const MODEL = 'haiku'
const PANE = 'apuntes'
// Dónde dibujó la app la nota la última vez: widget (esquina), dock o inline.
let ultimoLugar: string | undefined

// Cambia el tag cuando cambien los campos de Libreta: descarta lo guardado por
// una versión anterior, que sobrevive a una recarga.
const libreta = atom(
  { plugin: 'chat-notes', key: 'libreta' } as const,
  { project: '', items: [], view: 'recortes', busy: false, abierta: false } as Libreta,
  { shape: 'libreta-6' },
)

// La misma paleta que la banda de uso: gris para lo secundario, coral para la
// acción, rojo para borrar.
const MUTED = '#888780'
const ACCENT = '#D85A30'
const RED = '#E24B4A'
const BLUE = '#378ADD'
const DIVIDER = '#3A3A38'
const CARD_BORDER = '#3A3A38'
const CARD_BG = '#232322'
const TIP_BG = '#30302E'
const TIP_TEXT = '#E8E6E1'
const RED_SOFT = '#A8423C'

// Cuántos apuntes muestra la lista desplegada.
const VISIBLES = 8

// Cada cuánto se mira si hay texto resaltado.
const VIGILAR_MS = 600
let vigia: { cancel: () => void } | undefined

// La app sigue devolviendo la última selección aunque ya no esté resaltada en
// pantalla, así que una oferta que no cambia se retira sola pasado este tiempo.
const OFERTA_MS = 12000
let vistaTexto: string | undefined
let vistaDesde = 0
let caducada: string | undefined

// Lo que se guarda entre sesiones, por carpeta de proyecto.
type Guardado = Pick<Libreta, 'items' | 'ordered' | 'orderedAt' | 'orderedCount' | 'tituloGeneral'>

const SYSTEM = [
  'Eres un asistente que ordena apuntes de estudio y de proyecto.',
  'Recibes fragmentos copiados en distintos momentos de una conversación, en el orden en que se guardaron.',
  'Devuelve UN solo documento en Markdown, en español, que los organice:',
  '- La primera línea es "# " seguido de un título de 2 a 4 palabras que resuma de qué tratan todos los apuntes juntos.',
  '- Agrupa por tema con encabezados "## ".',
  '- Usa viñetas cortas. Une lo repetido en una sola viñeta.',
  '- Conserva exactos los datos: números, porcentajes, nombres, comandos y rutas.',
  '- No inventes ni agregues información que no esté en los fragmentos.',
  '- Si un fragmento es una nota personal o una duda (por ejemplo "ojo", "preguntar"), ponla en una sección "## Pendientes y dudas".',
  'Responde solo con el documento, sin introducción ni cierre.',
].join('\n')

// La carpeta del proyecto de esta sesión; se fija en session.start (que corre
// otra vez en cada recarga del mod).
let cwd = ''

const storeKey = (dir: string) => `libreta:${dir.toLowerCase()}`

const projectName = (dir: string) => {
  const parts = dir.split(/[\\/]+/).filter(Boolean)

  return parts[parts.length - 1] ?? dir
}

const hhmm = (at: number) => {
  const d = new Date(at)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Las primeras líneas de una nota en Markdown, para que la tarjeta no crezca sin
// fin; el texto completo se ve al editar o copiar.
const recorte = (text: string, max = 12) => {
  const lineas = text.split('\n')

  return lineas.length > max ? `${lineas.slice(0, max).join('\n')}\n\n…` : text
}

const cut = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const estadoTexto = (l: Libreta) => {
  const pendientes = l.orderedCount === undefined ? l.items.length : l.items.length - l.orderedCount

  return l.busy
    ? 'ordenando…'
    : l.orderedAt && pendientes <= 0
      ? `ordenado ${hhmm(l.orderedAt)}`
      : l.orderedAt
        ? `${pendientes} sin ordenar`
        : 'sin ordenar'
}

const textoParaCopiar = (l: Libreta) =>
  l.view === 'ordenado' && l.ordered ? l.ordered : l.items.map(it => `- ${it.text}`).join('\n')

async function save($: EngineInterface, fn: (l: Libreta) => Libreta) {
  const next = await update($, libreta, fn)
  if (cwd) {
    const kept: Guardado = {
      items: next.items,
      ordered: next.ordered,
      orderedAt: next.orderedAt,
      orderedCount: next.orderedCount,
      tituloGeneral: next.tituloGeneral,
    }
    await $.store.set(storeKey(cwd), kept)
  }

  return next
}

// Lo resaltado llega como texto plano (sin **, viñetas ni títulos). Busca esas
// líneas en las respuestas del chat y devuelve el Markdown original, para que
// la nota se vea con su formato y sea fácil de editar.
const plano = (line: string) =>
  line
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

async function recuperarMarkdown($: EngineInterface, seleccion: string) {
  const sel = seleccion.split('\n').map(plano).filter(Boolean)
  if (sel.length === 0) return undefined
  let mensajes: Awaited<ReturnType<EngineInterface['session']['messages']>>
  try {
    mensajes = await $.session.messages()
  } catch {
    return undefined
  }
  if (!Array.isArray(mensajes)) return undefined
  const primera = sel[0]!
  const ultima = sel[sel.length - 1]!
  for (const m of [...mensajes].reverse()) {
    if (m.role !== 'assistant' || !m.text) continue
    const lineas = m.text.split('\n')
    const planas = lineas.map(plano)
    const desde = planas.findIndex(p => p && (p.includes(primera) || (primera.length > 20 && primera.includes(p))))
    if (desde < 0) continue
    // Una sola línea resaltada a medias: se queda como la resaltó.
    if (sel.length === 1 && planas[desde] !== primera) return undefined
    let hasta = -1
    for (let i = desde; i < planas.length; i++) {
      const p = planas[i]!
      if (p && (p.includes(ultima) || (ultima.length > 20 && ultima.includes(p)))) {
        hasta = i
        if (sel.length === 1 || i > desde) break
      }
    }
    if (hasta < desde) continue

    return lineas.slice(desde, hasta + 1).join('\n').trim()
  }

  return undefined
}

async function agregar($: EngineInterface, text: string) {
  const plain = text.trim()
  if (!plain) return false
  const clean = (await recuperarMarkdown($, plain)) ?? plain
  const item: Apunte = { id: newId(), text: clean, at: Date.now() }
  await save($, l => ({ ...l, items: [...l.items, item].slice(-300), view: 'recortes', borrado: undefined }))
  void titular($, item.id, clean)

  return true
}

// Le pone a un apunte un título de un par de palabras, con el modelo rápido.
// Si falla, el apunte se queda sin título y no pasa nada.
async function titular($: EngineInterface, id: string, text: string) {
  if (await sinLimite($)) return
  try {
    const r = await $.model.complete({
      model: MODEL,
      system:
        'Resume de qué trata el texto en un título de 2 a 4 palabras, en español. Responde solo el título: sin comillas, sin punto final, sin emojis.',
      prompt: text.slice(0, 3000),
      maxTokens: 20,
      timeoutMs: 30000,
    })
    if (!r.isAnswered) return
    const titulo = r.text.replace(/["“”*#.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32)
    if (!titulo) return
    await save($, l => ({ ...l, items: l.items.map(it => (it.id === id ? { ...it, titulo } : it)) }))
  } catch {
    // Sin título.
  }
}

// Mira qué tiene resaltado la persona y lo ofrece en la banda; solo escribe
// cuando cambia, para no redibujar en cada vuelta.
async function vigilar($: EngineInterface) {
  const sel = await $.ui.selection()
  const text = sel?.text.trim() || undefined
  const now = await $.clock.now()
  if (text !== vistaTexto) {
    vistaTexto = text
    vistaDesde = now
  } else if (text && now - vistaDesde >= OFERTA_MS) {
    caducada = text
  }
  const l = await read($, libreta)
  const ofrecer = text && text !== l.guardada && text !== caducada ? text : undefined
  if (ofrecer !== l.seleccion) {
    await update($, libreta, x => ({ ...x, seleccion: ofrecer }))
  }
}

async function guardarSeleccion($: EngineInterface) {
  const l = await read($, libreta)
  const text = l.seleccion
  if (!text) return
  await update($, libreta, x => ({ ...x, seleccion: undefined, guardada: text }))
  await agregar($, text)
  void $.ui.toast('Guardado en apuntes')
}

async function descartarSeleccion($: EngineInterface) {
  await update($, libreta, x => ({ ...x, guardada: x.seleccion, seleccion: undefined }))
}

async function borrar($: EngineInterface, id: string) {
  await save($, l => {
    const index = l.items.findIndex(it => it.id === id)
    const item = l.items[index]
    if (!item) return l

    return { ...l, items: l.items.filter(it => it.id !== id), borrado: { item, index } }
  })
}

// Lo que la persona va escribiendo al editar un apunte; se guarda al confirmar.
let borrador: string | undefined

async function editar($: EngineInterface, id: string | undefined) {
  borrador = undefined
  await update($, libreta, (l): Libreta => ({ ...l, editando: id }))
}

async function guardarEdicion($: EngineInterface, texto?: string) {
  const l = await read($, libreta)
  const id = l.editando
  const nuevo = (texto ?? borrador)?.trim()
  borrador = undefined
  await save($, x => ({
    ...x,
    editando: undefined,
    items: nuevo && id ? x.items.map(it => (it.id === id ? { ...it, text: nuevo, titulo: undefined } : it)) : x.items,
  }))
  if (nuevo && id) void titular($, id, nuevo)
}

async function deshacerBorrado($: EngineInterface) {
  await save($, l => {
    if (!l.borrado) return l
    const items = [...l.items]
    items.splice(Math.min(l.borrado.index, items.length), 0, l.borrado.item)

    return { ...l, items, borrado: undefined }
  })
}

async function vaciar($: EngineInterface) {
  await save($, l => ({
    ...l,
    items: [],
    ordered: undefined,
    orderedAt: undefined,
    orderedCount: undefined,
    view: 'recortes',
    error: undefined,
    borrado: undefined,
  }))
}

async function verVista($: EngineInterface, view: Libreta['view']) {
  await update($, libreta, l => ({ ...l, view }))
}

// Si alguna ventana de uso (5 horas, 7 días) está al 100 %.
async function sinLimite($: EngineInterface) {
  try {
    return (await $.session.usage()).rateLimits.some(r => r.percentUsed >= 100)
  } catch {
    return false
  }
}

// "Llegaste al límite de uso. Se libera a las 14:30." con la hora que la app
// conoce; sin ella, solo el aviso.
async function avisoLimite($: EngineInterface) {
  let cuando = ''
  try {
    const lleno = (await $.session.usage()).rateLimits
      .filter(r => r.percentUsed >= 100 && r.resetsAt)
      .map(r => Date.parse(r.resetsAt!))
      .filter(t => !Number.isNaN(t))
      .sort((a, b) => b - a)[0]
    if (lleno) {
      const d = new Date(lleno)
      const hoy = new Date().toDateString() === d.toDateString()
      cuando = hoy ? ` Se libera a las ${hhmm(lleno)}.` : ` Se libera el ${d.getDate()}/${d.getMonth() + 1} a las ${hhmm(lleno)}.`
    }
  } catch {
    // Sin la hora.
  }

  return `Llegaste al límite de uso; espera para ordenar.${cuando}`
}

async function ordenar($: EngineInterface) {
  const now = await read($, libreta)
  if (now.busy) return 'Ya se están ordenando los apuntes.'
  if (now.items.length === 0) return 'No hay apuntes para ordenar.'

  // Sin cupo de uso, ni lo intenta: avisa cuándo se libera.
  if (await sinLimite($)) {
    const msg = await avisoLimite($)
    await update($, libreta, l => ({ ...l, error: msg }))

    return msg
  }

  await update($, libreta, l => ({ ...l, busy: true, error: undefined }))
  const prompt = now.items
    .map((it, i) => `### Fragmento ${i + 1} (${hhmm(it.at)})\n${it.text}`)
    .join('\n\n')
  const r = await $.model.complete({
    model: MODEL,
    system: SYSTEM,
    prompt,
    maxTokens: 4000,
    timeoutMs: 120000,
  })

  if (!r.isAnswered) {
    const sinCupo = r.reason === 'api-error' && (r.error === 'rate_limit' || r.status === 429)
    const msg = sinCupo
      ? await avisoLimite($)
      : `No se pudo ordenar (${r.reason === 'aborted' ? 'tardó demasiado' : r.reason}).`
    await update($, libreta, l => ({ ...l, busy: false, error: msg }))

    return msg
  }

  // La primera línea "# ..." es el título de todo; el resto, lo ordenado.
  let cuerpo = r.text.trim()
  let tituloGeneral: string | undefined
  const primera = /^#\s+(.+)\n?/.exec(cuerpo)
  if (primera) {
    tituloGeneral = primera[1]!.replace(/[*_`]/g, '').trim().slice(0, 60) || undefined
    cuerpo = cuerpo.slice(primera[0].length).trim()
  }

  await save($, l => ({
    ...l,
    busy: false,
    tituloGeneral,
    ordered: cuerpo,
    orderedAt: Date.now(),
    orderedCount: now.items.length,
    view: 'ordenado',
    abierta: true,
  }))
  void $.ui.toast('Apuntes ordenados')

  return 'Apuntes ordenados.'
}

let notaTimer: { cancel: () => void } | undefined
async function copiarNota($: EngineInterface, id: string, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const it = (await read($, libreta)).items.find(x => x.id === id)
  if (!it) return
  const done = await $.ui.copy({ text: it.text, surface })
  if (!done.isCopied) {
    void $.ui.toast('No se pudo copiar')
    return
  }
  await update($, libreta, (x): Libreta => ({ ...x, notaCopiada: id }))
  notaTimer?.cancel()
  notaTimer = $.clock.after(2000, () => void update($, libreta, (x): Libreta => ({ ...x, notaCopiada: undefined })))
}

let copiadoTimer: { cancel: () => void } | undefined
async function copiar($: EngineInterface, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const l = await read($, libreta)
  const cual = l.view === 'ordenado' && l.ordered ? 'ordenado' : 'recortes'
  const done = await $.ui.copy({ text: textoParaCopiar(l), surface })
  if (!done.isCopied) {
    void $.ui.toast('No se pudo copiar')
    return
  }
  const n = l.items.length
  void $.ui.toast(cual === 'ordenado' ? 'Copiaste la versión ordenada' : `Copiaste ${n === 1 ? 'el recorte' : `los ${n} recortes`} tal cual`)
  await update($, libreta, (x): Libreta => ({ ...x, copiado: cual }))
  copiadoTimer?.cancel()
  copiadoTimer = $.clock.after(2500, () => void update($, libreta, (x): Libreta => ({ ...x, copiado: undefined })))
}

// Guarda la versión ordenada como .md donde la persona elija, con el cuadro
// "Guardar como" de Windows. Empieza en la carpeta del proyecto.
const DIALOGO = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  "$f = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
  '$d = New-Object System.Windows.Forms.SaveFileDialog',
  "$d.Title = 'Guardar apuntes'",
  "$d.Filter = 'Markdown (*.md)|*.md|Todos los archivos (*.*)|*.*'",
  '$d.FileName = $env:AP_NOMBRE',
  '$d.InitialDirectory = $env:AP_DIR',
  '$d.OverwritePrompt = $true',
  "if ($d.ShowDialog($f) -eq 'OK') { [Console]::Out.Write($d.FileName) }",
].join('; ')

let exportadoTimer: { cancel: () => void } | undefined
async function exportar($: EngineInterface) {
  const l = await read($, libreta)
  if (!l.ordered) return
  let ruta = ''
  try {
    const r = await $.process.run(['powershell.exe', '-NoProfile', '-STA', '-Command', DIALOGO], {
      env: { AP_DIR: cwd, AP_NOMBRE: 'APUNTES.md' },
      timeoutMs: 600000,
    })
    ruta = r.stdout.trim()
  } catch {
    void $.ui.toast('No se pudo abrir el cuadro para guardar')
    return
  }
  if (!ruta) return
  try {
    await $.fs.write(ruta, `# ${l.tituloGeneral ?? `Apuntes · ${l.project}`}\n\n${l.ordered.trim()}\n`)
  } catch {
    void $.ui.toast('No se pudo guardar el archivo')
    return
  }
  const nombre = ruta.split(/[\/]/).pop() ?? ruta
  void $.ui.toast(`Guardado ${nombre}`)
  await update($, libreta, (x): Libreta => ({ ...x, exportado: nombre }))
  exportadoTimer?.cancel()
  exportadoTimer = $.clock.after(2500, () => void update($, libreta, (x): Libreta => ({ ...x, exportado: undefined })))
}

// Borra los apuntes de chats sin proyecto que ya se borraron: la app crea una
// carpeta temporal para cada uno y la quita al borrar el chat. Solo mira esas
// carpetas temporales, nunca las de un proyecto (un disco desconectado no es
// un proyecto borrado).
async function limpiarHuerfanos($: EngineInterface) {
  const propia = storeKey(cwd)
  for (const key of await $.store.keys()) {
    if (!key.startsWith('libreta:') || key === propia) continue
    const dir = key.slice('libreta:'.length)
    if (!/[\\/]scratch-workspaces[\\/]/.test(dir)) continue
    try {
      await $.fs.stat(dir)
    } catch {
      await $.store.delete(key)
    }
  }
}

// Abre el panel de apuntes si está cerrado y lo cierra si está a la vista.
// Responde si quedó abierto.
async function alternarPanel($: EngineInterface) {
  const panes = await $.ui.panes()
  if (panes.some(p => p.id === PANE && p.isShown)) {
    await $.ui.close({ id: PANE })

    return false
  }
  await $.ui.open({ id: PANE, title: 'Apuntes', focus: true, columns: 34 })

  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    const kept = (await $.store.get(storeKey(cwd))) as Guardado | undefined
    await update($, libreta, (): Libreta => ({
      project: projectName(cwd),
      items: Array.isArray(kept?.items) ? kept.items : [],
      ordered: kept?.ordered,
      orderedAt: kept?.orderedAt,
      orderedCount: kept?.orderedCount,
      tituloGeneral: kept?.tituloGeneral,
      view: 'recortes',
      busy: false,
      abierta: false,
    }))

    await $.command.register({
      name: 'apuntes',
      description: 'Abre o cierra tus apuntes (/apuntes vaciar: borra los de este proyecto)',
    })

    vigia?.cancel()
    vigia = $.clock.every(VIGILAR_MS, () => void vigilar($))

    void limpiarHuerfanos($).catch(() => undefined)

    // Los apuntes de antes, que aún no tienen título.
    for (const it of (await read($, libreta)).items) {
      if (!it.titulo) void titular($, it.id, it.text)
    }

    return next(e)
  })

  on('command.run', { command: 'apuntes' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'vaciar') {
      const l = await read($, libreta)
      await vaciar($)

      return { text: `Se borraron ${l.items.length} apuntes de ${l.project}.` }
    }
    const abierto = await alternarPanel($)

    return { text: abierto ? 'Apuntes abiertos.' : 'Apuntes cerrados.' }
  })

  // El 📝 en el pie del cuadro de mensaje, a la derecha, junto a los modos de
  // la sesión: el número de apuntes, o "Guardar resaltado" si hay texto
  // resaltado. Lo de la app se dibuja igual que siempre, a su lado.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const l = await read($, libreta)
    const boton = l.seleccion ? (
      <Button key="pie-guardar" variant="primary" label="📝 Guardar resaltado" onPress={() => void guardarSeleccion($)} />
    ) : (
      <Button
        key="pie-abrir"
        variant="secondary"
        label={`📝 Apuntes · ${l.items.length}`}
        onPress={() => void alternarPanel($)}
      />
    )

    return (
      <Box flexDirection="row" alignItems="center" gap={2}>
        {engine}
        {boton}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text, Markdown, Input } = $.ui.resolve(e)
    // Un globito con una explicación corta que aparece al pasar el mouse.
    const globo = (id: string, texto: string, lado: 'izq' | 'der', hijo: RenderChildren) => (
      <Box key={`ayuda-${id}`} position="relative" flexShrink={0}>
        {hijo}
        <Box
          position="absolute"
          top={2}
          left={lado === 'izq' ? 0 : undefined}
          right={lado === 'der' ? 0 : undefined}
          width={Math.min(texto.length + 4, ancho)}
          display="none"
          hover={{ display: 'flex' }}
          backgroundColor={TIP_BG}
          borderStyle="round"
          borderColor={CARD_BORDER}
          paddingX={1}
        >
          <Text color={TIP_TEXT}>{texto}</Text>
        </Box>
      </Box>
    )
    const l = await read($, libreta)
    const n = l.items.length
    const ancho = Math.max(24, (e.props.bodyColumns ?? 40) - 6)
    ultimoLugar = e.props.placement

    // Plegada: una notita en la esquina, con el número de apuntes. Cuando hay
    // texto resaltado, ofrece guardarlo ahí mismo.
    if (e.props.placement === 'widget') {
      return l.seleccion ? (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            <Text color={ACCENT}>📝 </Text>
            <Text dimColor italic>{`“${cut(l.seleccion, 40)}”`}</Text>
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="guardar-seleccion" onPress={() => void guardarSeleccion($)}>
              <Text color={ACCENT} bold>
                Guardar resaltado
              </Text>
            </Button>
            <Button key="descartar-seleccion" dimColor onPress={() => void descartarSeleccion($)}>
              <Text>✕</Text>
            </Button>
          </Box>
        </Box>
      ) : (
        <Text>
          <Text color={ACCENT}>📝 </Text>
          <Text bold>{n}</Text>
          <Text dimColor>{n === 1 ? ' apunte' : ' apuntes'}</Text>
        </Text>
      )
    }

    // Desplegada: encabezado limpio, acciones arriba y cada apunte en su tarjeta.
    const recientes = [...l.items].reverse()
    // Viendo lo ordenado y sin apuntes nuevos desde entonces: no hay nada que ordenar.
    const alDia = l.view === 'ordenado' && !!l.ordered && !l.busy && (l.orderedCount ?? 0) >= n
    // La carpeta temporal que crea la app para una sesión sin proyecto.
    const esTemporal = /^scratch-\d/i.test(l.project)
    const cuerpo =
      l.view === 'ordenado' && l.ordered ? (
        <Box borderStyle="round" borderColor={CARD_BORDER} paddingX={1} flexDirection="column">
          <Markdown text={l.ordered} />
        </Box>
      ) : n === 0 ? (
        <Box borderStyle="round" borderColor={CARD_BORDER} paddingX={1} paddingY={1} flexDirection="column">
          <Text color={MUTED}>Todavía no hay apuntes.</Text>
          <Text dimColor>Resalta texto del chat y pulsa 📝 Guardar resaltado.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          {recientes.map(it => (
            <Box
              key={`nota-${it.id}`}
              borderStyle="round"
              borderColor={CARD_BORDER}
              backgroundColor={CARD_BG}
              paddingX={1}
              flexDirection="column"
              hover={{ scope: `nota-${it.id}`, borderColor: BLUE }}
            >
              {l.editando === it.id ? (
                <Box flexDirection="column" gap={1}>
                  <Input
                    key={`editor-${it.id}`}
                    value={it.text}
                    rows={8}
                    autoFocus
                    submitLabel="guardar"
                    onInput={v => {
                      borrador = v
                    }}
                    onSubmit={v => void guardarEdicion($, v)}
                  />
                  <Box flexDirection="row" gap={1}>
                    <Button key="guardar-edicion" variant="primary" label="Guardar" onPress={() => void guardarEdicion($)} />
                    <Button key="cancelar-edicion" variant="secondary" label="Cancelar" onPress={() => void editar($, undefined)} />
                  </Box>
                </Box>
              ) : (
                <Box flexDirection="column">
                  <Box flexDirection="row" alignItems="flex-start" gap={2}>
                    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                      <Box flexDirection="row" flexWrap="nowrap" alignItems="flex-start" gap={1}>
                        <Box flexShrink={0}>
                          <Text>
                            <Text bold>{`NOTA ${String(l.items.indexOf(it) + 1).padStart(2, "0")}`}</Text>
                            {it.titulo ? <Text color={MUTED}> —</Text> : null}
                          </Text>
                        </Box>
                        {it.titulo ? (
                          <Box flexGrow={1} flexShrink={1} minWidth={0}>
                            <Text color={MUTED}>{it.titulo.toLocaleUpperCase("es")}</Text>
                          </Box>
                        ) : null}
                      </Box>
                      <Markdown text="---" />
                    </Box>
                    <Box flexShrink={0}>
                      {globo(`editar-${it.id}`, 'Corregir el texto de esta nota', 'der', <Button key={`editar-${it.id}`} label="Editar" plain dimColor onPress={() => void editar($, it.id)} />)}
                    </Box>
                  </Box>
                  <Markdown text={recorte(it.text)} />
                </Box>
              )}
              <Box flexDirection="row" alignItems="center" justifyContent="space-between">
                <Text color={MUTED}>{hhmm(it.at)}</Text>
                <Box flexDirection="row" gap={1} flexShrink={0}>
                  {globo(`copiar-${it.id}`, 'Copiar esta nota', 'der', <Button key={`copiar-${it.id}`} variant="secondary" label={l.notaCopiada === it.id ? '✔' : '📋'} onPress={press => void copiarNota($, it.id, press.surface)} />)}
                  {globo(`borrar-${it.id}`, 'Borrar nota (se puede deshacer)', 'der', <Button key={`borrar-${it.id}`} variant="secondary" label="🗑" onPress={() => void borrar($, it.id)} />)}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{(l.tituloGeneral ?? (esTemporal ? 'Apuntes' : l.project)).toLocaleUpperCase('es')}</Text>
          <Text color={MUTED}>
            {`${l.tituloGeneral && !esTemporal ? `${l.project} · ` : ''}${n} ${n === 1 ? 'apunte' : 'apuntes'} · ${estadoTexto(l)}`}
          </Text>
        </Box>
        {n > 0 && (
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="flex-start">
            {alDia
              ? globo('ordenar', 'Ya está todo ordenado', 'izq', <Button key="ordenar" variant="secondary" label="Ordenado" dimColor onPress={() => undefined} />)
              : globo('ordenar', 'Haiku agrupa por tema, no añade palabras', 'izq', <Button
                  key="ordenar"
                  variant="primary"
                  label={l.busy ? 'Ordenando…' : 'Ordenar'}
                  onPress={() => void ordenar($)}
                />)}
            {l.ordered &&
              globo('vista', l.view === 'ordenado' ? 'Vuelve a tus apuntes tal cual' : 'Muestra tus apuntes agrupados por tema', 'izq', <Button
                key="cambiar-vista"
                variant="secondary"
                label={l.view === 'ordenado' ? 'Ver apuntes' : 'Ver ordenado'}
                onPress={() => void verVista($, l.view === 'ordenado' ? 'recortes' : 'ordenado')}
              />)}
{l.view === 'ordenado' && l.ordered && globo('copiar', 'Copia lo que ves al portapapeles', 'der', <Button
                key="copiar"
                variant={l.copiado ? 'primary' : 'secondary'}
                label={l.copiado ? 'Copiado' : 'Copiar'}
                onPress={press => void copiar($, press.surface)}
              />)}
            {l.view === 'ordenado' && l.ordered && globo('exportar', 'Guardar como archivo .md', 'der', <Button
                key="exportar"
                variant={l.exportado ? 'primary' : 'secondary'}
                label={l.exportado ? 'Guardado' : '↑'}
                onPress={() => void exportar($)}
              />)}
          </Box>
        )}
        {l.error && <Text color={RED}>{l.error}</Text>}
        {l.seleccion && (
          <Box borderStyle="round" borderColor={ACCENT} paddingX={1} flexDirection="column">
            <Text color={MUTED}>Resaltado</Text>
            <Text italic>“{cut(l.seleccion, ancho * 2)}”</Text>
            <Box flexDirection="row" gap={1}>
              <Button
                key="guardar-seleccion"
                variant="primary"
                label="📝 Guardar"
                onPress={() => void guardarSeleccion($)}
              />
              <Button key="descartar-seleccion" variant="secondary" label="✕" onPress={() => void descartarSeleccion($)} />
            </Box>
          </Box>
        )}
        {l.borrado && (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color={MUTED}>Apunte borrado</Text>
            <Button key="deshacer-borrado" variant="secondary" label="↶ Deshacer" onPress={() => void deshacerBorrado($)} />
          </Box>
        )}
        {cuerpo}
      </Box>
    )
  })
}
