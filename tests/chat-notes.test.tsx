import { expect, mock, test } from 'claude-code/testing'

const CWD = String.raw`C:\proyectos\mi-app`

const nota = (placement: 'widget' | 'dock') =>
  ({
    plugin: 'chat-notes',
    component: 'Pane',
    requestId: 'apuntes',
    props: {
      title: 'Apuntes',
      isFocused: false,
      bodyColumns: 50,
      placement,
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const
const NOTA = nota('widget')
const ABIERTA = nota('dock')

type On = Parameters<Parameters<typeof test>[1]>[1]

// El texto de las notas se dibuja como Markdown.
type Montado = { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const notas = async (ui: Montado) => (await ui.findAll({ type: 'Markdown' })).map(m => String(m.props.text))
const hayNota = async (ui: Montado, re: RegExp) => (await notas(ui)).some(t => re.test(t))

const abiertos: string[] = []

const engine = (on: On, selection?: () => string | undefined, notas: string[] = []) => {
  mock.store(on, notas.length ? { [`libreta:${CWD.toLowerCase()}`]: { items: notas.map((text, i) => ({ id: `n${i}`, text, at: i })) } } : {})
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    abiertos.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  // Lo que la app dibuja por su cuenta en el pie.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>modos de la app</Text>
  })
  on('ui.selection', () => {
    const text = selection?.()

    return { value: text === undefined ? undefined : { text } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const start = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })

test('la nota plegada muestra solo el ícono y el número', async ($, on) => {
  engine(on, undefined, ['Primer apunte'])
  await start($)

  const ui = await $.ui.mount({ ...NOTA, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /1 apunte/ }))?.text).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Primer apunte/ })).toBeFalsy()
  await ui.unmount()
})

test('al resaltar texto, la nota ofrece guardarlo y lo guarda con un clic', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, () => 'Abstenerse en vez de inventar cuando la información no está')
  await start($)
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...NOTA, surface })
    expect((await ui.find({ type: 'Text', text: /Abstenerse en vez de inventar/ }))?.text).toBeTruthy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...NOTA, surface: 'desktop' })
  await ui.press({ key: 'guardar-seleccion' })
  expect(await ui.find({ key: 'guardar-seleccion' })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /1 apunte/ }))?.text).toBeTruthy()

  // La misma selección no se vuelve a ofrecer.
  await clock.advance(1000)
  expect(await ui.find({ key: 'guardar-seleccion' })).toBeFalsy()
  await ui.unmount()
})

test('la oferta se retira sola si la selección no cambia, y vuelve con una nueva', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  let selected = 'Preguntas de dato exacto'
  engine(on, () => selected)
  await start($)

  const ui = await $.ui.mount({ ...NOTA, surface: 'desktop' })
  await clock.advance(1000)
  expect(await ui.find({ key: 'guardar-seleccion' })).toBeTruthy()

  await clock.advance(13000)
  expect(await ui.find({ key: 'guardar-seleccion' })).toBeFalsy()

  selected = 'Meta del sprint: 90 % de pruebas en verde'
  await clock.advance(1000)
  expect((await ui.find({ type: 'Text', text: /Meta del sprint/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('desplegada, la papelera borra y Deshacer lo recupera', async ($, on) => {
  engine(on, undefined, ['Primer apunte', 'Segundo apunte'])
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  expect(await hayNota(ui, /Segundo apunte/)).toBe(true)

  const keys = (await ui.findAll({ type: 'Button' }))
    .map(b => b.key ?? '')
    .filter(k => k.startsWith('borrar-'))
  expect(keys.length).toBe(2)
  await ui.press({ key: keys[0]! })
  expect(await hayNota(ui, /Segundo apunte/)).toBe(false)

  await ui.press({ key: 'deshacer-borrado' })
  expect(await hayNota(ui, /Segundo apunte/)).toBe(true)
  await ui.unmount()
})

test('Ordenar usa el modelo y muestra el resultado', async ($, on) => {
  engine(on, undefined, ['Preguntas de dato exacto: todas correctas'])
  let prompt = ''
  on('model.complete', (_, e) => {
    prompt = typeof e.prompt === 'string' ? e.prompt : ''

    return {
      value: {
        isAnswered: true,
        text: '## Objetivo al cerrar\n- Dato exacto con doc y página',
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    }
  })
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  await ui.press({ key: 'ordenar' })
  expect(prompt).toMatch(/Fragmento 1/)
  expect((await ui.find({ type: 'Text', text: /ordenado/ }))?.text).toBeTruthy()
  expect(await ui.find({ key: 'cambiar-vista' })).toBeTruthy()
  await ui.unmount()
})

test('los apuntes guardados vuelven en una sesión nueva del mismo proyecto', async ($, on) => {
  mock.store(on, {
    [`libreta:${CWD.toLowerCase()}`]: {
      items: [{ id: 'a', text: 'Paso 1: poner la clave de la API en .env', at: 0 }],
    },
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.selection', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  expect(await hayNota(ui, /clave de la API/)).toBe(true)
  await ui.unmount()
})

const PIE = { plugin: 'chat-notes', component: 'SessionMode', props: { modes: ['Automático'] } } as const

test('el pie muestra 📝 con el número junto a lo de la app, y abre los apuntes', async ($, on) => {
  engine(on, undefined, ['Primer apunte'])
  abiertos.length = 0
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PIE, surface })
    expect((await ui.find({ type: 'Text', text: /modos de la app/ }))?.text).toBeTruthy()
    expect(await ui.find({ key: 'pie-abrir' })).toBeTruthy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PIE, surface: 'desktop' })
  await ui.press({ key: 'pie-abrir' })
  expect(abiertos).toContain('apuntes')
  await ui.unmount()
})

test('con texto resaltado, el pie ofrece guardarlo', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, () => 'Meta del sprint: 90 % de pruebas en verde')
  await start($)
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PIE, surface: 'desktop' })
  await ui.press({ key: 'pie-guardar' })
  expect(await ui.find({ key: 'pie-guardar' })).toBeFalsy()
  expect(await ui.find({ key: 'pie-abrir' })).toBeTruthy()
  await ui.unmount()
})

test('Copiar solo aparece en la versión ordenada y lo confirma un momento', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, undefined, ['Primer apunte'])
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: '## Tema - Primer apunte', usage: { input_tokens: 5, output_tokens: 5 } },
  }))
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  expect(await ui.find({ key: 'copiar' })).toBeFalsy()
  await ui.press({ key: 'ordenar' })
  expect((await ui.find({ key: 'copiar' }))?.props.label).toBe('Copiar')
  await ui.press({ key: 'copiar' })
  expect((await ui.find({ key: 'copiar' }))?.props.label).toBe('Copiado')
  await clock.advance(3000)
  expect((await ui.find({ key: 'copiar' }))?.props.label).toBe('Copiar')
  await ui.unmount()
})

test('el lápiz edita un apunte y lo guarda', async ($, on) => {
  engine(on, undefined, ['Texto con eror'])
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  const lapiz = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('editar-'))!
  await ui.press({ key: lapiz })
  await ui.press({ key: 'editar-todo' })
  const editor = (await ui.findAll({ type: 'Input' }))[0]!
  await ui.input({ key: editor.key!, text: 'Texto corregido', kind: 'submit' })
  expect(await hayNota(ui, /Texto corregido/)).toBe(true)
  expect(await ui.find({ type: 'Input' })).toBeFalsy()
  await ui.unmount()
})

test('cada apunte recibe un título corto junto a NOTA 01', async ($, on) => {
  engine(on, undefined, ['Meta del sprint: 90 % de pruebas en verde y cero errores'])
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'Metas de exactitud.', usage: { input_tokens: 5, output_tokens: 3 } },
  }))
  await start($)

  await new Promise(r => setTimeout(r, 20))
  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /NOTA 01/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /METAS DE EXACTITUD$/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('en la versión ordenada, ↑ pregunta dónde guardar y guarda el .md ahí', async ($, on) => {
  engine(on, undefined, ['Primer apunte'])
  const escritos: Record<string, string> = {}
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'D:/Docs/mis-apuntes.md', stderr: '' } }))
  on('fs.write', (_, e) => {
    escritos[e.path] = e.text

    return { value: undefined }
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: '## Tema - Primer apunte', usage: { input_tokens: 5, output_tokens: 5 } },
  }))
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  expect(await ui.find({ key: 'exportar' })).toBeFalsy()
  await ui.press({ key: 'ordenar' })
  await ui.press({ key: 'exportar' })
  const rutas = Object.keys(escritos)
  expect(rutas.length).toBe(1)
  expect(rutas[0]).toMatch(/Docs.mis-apuntes\.md$/)
  expect(escritos[rutas[0]!]).toMatch(/## Tema/)
  expect((await ui.find({ key: 'exportar' }))?.props.label).toBe('Guardado')
  await ui.unmount()
})

test('al ordenar, el título de Haiku reemplaza el nombre de la carpeta arriba', async ($, on) => {
  engine(on, undefined, ['Primer apunte'])
  on('model.complete', (_, e) =>
    typeof e.prompt === 'string' && e.prompt.includes('Fragmento')
      ? { value: { isAnswered: true, text: '# Mod de apuntes en la app\n## Tema\n- Primer apunte', usage: { input_tokens: 5, output_tokens: 5 } } }
      : { value: { isAnswered: false, reason: 'refused' } },
  )
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^MI-APP$/ }))?.text).toBeTruthy()
  await ui.press({ key: 'ordenar' })
  expect((await ui.find({ type: 'Text', text: /^MOD DE APUNTES EN LA APP$/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^mi-app · 1 apunte/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('el botón de copiar de una nota copia solo esa nota', async ($, on) => {
  engine(on, undefined, ['Primer apunte', 'Segundo apunte'])
  let copiado = ''
  on('ui.copy', (_, e) => {
    copiado = e.text

    return { value: { isCopied: true } }
  })
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => /^copiar-/.test(k))
  expect(keys.length).toBe(2)
  await ui.press({ key: keys[0]! })
  expect(copiado).toBe('Segundo apunte')
  expect((await ui.find({ key: keys[0]! }))?.props.label).toBe('✔')
  await ui.unmount()
})

test('al abrir, borra los apuntes de chats temporales que ya no existen y deja los de proyectos', async ($, on) => {
  const temporal = 'libreta:c:/usuarios/ana/appdata/roaming/claude/scratch-workspaces/a/b/scratch-viejo'
  const proyecto = 'libreta:m:/otro/proyecto'
  const data: Record<string, unknown> = {
    [temporal]: { items: [{ id: 'a', text: 'viejo', at: 0 }] },
    [proyecto]: { items: [{ id: 'b', text: 'del proyecto', at: 0 }] },
  }
  on('store.get', (_, e) => ({ value: data[e.key] }))
  on('store.set', (_, e) => {
    data[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete data[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(data) }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.selection', () => ({ value: undefined }))
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await start($)
  await new Promise(r => setTimeout(r, 20))

  expect(Object.keys(data)).not.toContain(temporal)
  expect(Object.keys(data)).toContain(proyecto)
})

test('sin cupo de uso, Ordenar avisa el límite y no llama al modelo', async ($, on) => {
  engine(on, undefined, ['Primer apunte'])
  let llamadas = 0
  on('model.complete', () => {
    llamadas++

    return { value: { isAnswered: true, text: 'x', usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { percent: 10 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2099-01-01T14:30:00Z' }],
    },
  }))
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  await ui.press({ key: 'ordenar' })
  expect(llamadas).toBe(0)
  expect((await ui.find({ type: 'Text', text: /límite de uso/ }))?.text).toBeTruthy()
  expect((await ui.find({ key: 'ordenar' }))?.props.label).toBe('Ordenar')
  await ui.unmount()
})

test('si el modelo responde 429, Ordenar avisa el límite de uso', async ($, on) => {
  engine(on, undefined, ['Primer apunte'])
  on('model.complete', () => ({
    value: { isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: { input_tokens: 0, output_tokens: 0 } },
  }))
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  await ui.press({ key: 'ordenar' })
  expect((await ui.find({ type: 'Text', text: /límite de uso/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('al guardar lo resaltado, recupera el Markdown original de la respuesta', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, () => 'Objetivo realista\nPreguntas de dato exacto: todas correctas.\nAbstenerse en vez de inventar.')
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'hola', toolUses: [] },
      {
        role: 'assistant',
        text: 'Intro\n\n### Objetivo realista\n\n1. **Preguntas de dato exacto**: todas correctas.\n2. **Abstenerse** en vez de inventar.\n\nCierre',
        toolUses: [],
      },
    ],
  }))
  await start($)
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  await ui.press({ key: 'guardar-seleccion' })
  expect(await notas(ui)).toContain('### Objetivo realista\n\n1. **Preguntas de dato exacto**: todas correctas.\n2. **Abstenerse** en vez de inventar.')
  await ui.unmount()
})

test('viendo lo ordenado y al día, Ordenar se vuelve "Ordenado" apagado', async ($, on) => {
  engine(on, undefined, ['Primer apunte'])
  let llamadas = 0
  on('model.complete', (_, e) => {
    if (typeof e.prompt === 'string' && e.prompt.includes('Fragmento')) llamadas++

    return { value: { isAnswered: true, text: '## Tema - Primer apunte', usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  await ui.press({ key: 'ordenar' })
  expect((await ui.find({ key: 'ordenar' }))?.props.label).toBe('Ordenado')
  await ui.press({ key: 'ordenar' })
  expect(llamadas).toBe(1)
  await ui.press({ key: 'cambiar-vista' })
  expect((await ui.find({ key: 'ordenar' }))?.props.label).toBe('Ordenar')
  await ui.unmount()
})

test('al guardar una tabla resaltada, la nota guarda la tabla en Markdown', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, () => 'Plan\tPrecio\nBásico\t$5\nPro\t$12')
  on('session.messages', () => ({
    value: [
      {
        role: 'assistant',
        text: 'Estos son los planes:\n\n| Plan | Precio |\n| --- | ---: |\n| **Básico** | $5 |\n| Pro | $12 |\n\nElige uno.',
        toolUses: [],
      },
    ],
  }))
  await start($)
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  await ui.press({ key: 'guardar-seleccion' })
  expect(await notas(ui)).toContain('| Plan | Precio |\n| --- | ---: |\n| **Básico** | $5 |\n| Pro | $12 |')
  await ui.unmount()
})

test('al editar, la vista previa muestra lo escrito ya formateado', async ($, on) => {
  engine(on, undefined, ['Texto viejo'])
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  const lapiz = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('editar-'))!
  await ui.press({ key: lapiz })
  await ui.press({ key: 'editar-todo' })
  const editor = (await ui.findAll({ type: 'Input' }))[0]!
  await ui.input({ key: editor.key!, text: '## Título nuevo - punto', kind: 'change' })
  expect(await notas(ui)).toContain('## Título nuevo - punto')
  await ui.unmount()
})

test('al editar, solo el párrafo elegido se abre en Markdown y el resto sigue formateado', async ($, on) => {
  const lineas = (p: string) => ['## Plan', '', p, '', '- punto uno', '- punto dos'].join('\n')
  engine(on, undefined, [lineas('Primer párrafo con **negrita**.')])
  await start($)

  const ui = await $.ui.mount({ ...ABIERTA, surface: 'desktop' })
  const lapiz = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').find(k => k.startsWith('editar-n'))!
  await ui.press({ key: lapiz })
  expect(await ui.find({ type: 'Input' })).toBeFalsy()
  expect(await notas(ui)).toContain('Primer párrafo con **negrita**.')

  const lapices = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('editar-bloque-'))
  expect(lapices.length).toBe(4)
  await ui.press({ key: lapices[1]! })
  const editor = (await ui.findAll({ type: 'Input' }))[0]!
  expect(editor.props.value).toBe('Primer párrafo con **negrita**.')
  expect(await notas(ui)).toContain('## Plan')
  expect(await notas(ui)).toContain('- punto uno')
  await ui.input({ key: editor.key!, text: 'Párrafo *corregido*.', kind: 'submit' })

  await ui.press({ key: 'terminar-edicion' })
  expect(await notas(ui)).toContain(lineas('Párrafo *corregido*.'))
  await ui.unmount()
})
