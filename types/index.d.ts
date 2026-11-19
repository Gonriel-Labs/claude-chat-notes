export type Apunte = { id: string; text: string; at: number; titulo?: string }

export type Libreta = {
  project: string
  items: Apunte[]
  ordered?: string
  orderedAt?: number
  orderedCount?: number
  // Título de todo, que Haiku escribe al ordenar.
  tituloGeneral?: string
  view: 'recortes' | 'ordenado'
  busy: boolean
  error?: string
  // El texto que la persona tiene resaltado ahora, si no está ya guardado.
  seleccion?: string
  // El último texto resaltado que se guardó, para no volver a ofrecerlo.
  guardada?: string
  // El último apunte borrado y dónde estaba, para poder deshacerlo.
  borrado?: { item: Apunte; index: number }
  // Si la banda muestra la lista de apuntes desplegada.
  abierta: boolean
  // Qué versión se acaba de copiar, para avisarlo un momento en el botón.
  copiado?: 'ordenado' | 'recortes'
  // El apunte que se está editando.
  editando?: string
  // Lo que se va escribiendo al editar, para verlo formateado.
  vistaPrevia?: string
  // Al editar: el bloque abierto, o todo el texto en Markdown.
  bloque?: number
  todo?: boolean
  // El archivo .md que se acaba de guardar, para avisarlo un momento.
  exportado?: string
  // La nota que se acaba de copiar con su botón.
  notaCopiada?: string
}

declare module 'claude-code' {
  interface PluginState {
    'chat-notes': { libreta: Shaped<Libreta> }
  }
}
