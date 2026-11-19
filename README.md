# Apuntes del chat para Claude Code

Un mod que te deja guardar fragmentos de las respuestas de Claude como notas, en un panel junto al chat:

- **Resaltas y guardas**: seleccionas texto del chat y el botón **📝 Apuntes** del pie cambia a **📝 Guardar resaltado**. Un clic y queda como nota, con su formato.
- **Cada nota con su título**: **NOTA 01 — CONFIGURAR LA API**. El título corto lo escribe Claude Haiku.
- **Ordenar con un clic**: Haiku agrupa todas tus notas por tema, sin añadir palabras, y les pone un título general.
- **Notas por proyecto**: cada carpeta tiene las suyas, y siguen ahí al cerrar y volver a abrir Claude.

<p align="center">
  <img src="docs/demo.svg" width="760" alt="En una respuesta de Claude se resaltan el título Antes de publicar y sus tres viñetas; el botón del pie cambia de Apuntes · 2 a Guardar resaltado. Al pulsarlo, la nota aparece arriba en el panel de la derecha como NOTA 03, con su formato, y un momento después recibe el título ANTES DE PUBLICAR. Luego se pulsa Ordenar y el panel muestra las tres notas agrupadas por tema bajo el título LANZAMIENTO DE MI-APP, con los botones Ordenado, Ver apuntes, Copiar y la flecha para exportar.">
</p>

## Qué hace

- **Guarda con su formato**: aunque al resaltar solo se copia texto plano, la nota recupera los títulos, negritas y viñetas de la respuesta original.
- **Ordenar**: junta notas sueltas en un documento por temas. No inventa ni rellena: conserva tus datos, números y comandos tal cual.
- **Editar, copiar y borrar** cada nota desde su tarjeta. Si borras una por error, **↶ Deshacer** la recupera.
- **Copiar y exportar lo ordenado**: **Copiar** lo pasa al portapapeles y la flecha **↑** lo guarda como archivo `.md` donde elijas, empezando en la carpeta del proyecto.
- **Avisa si se acabó tu cupo**: si llegaste al límite de uso de tu plan, **Ordenar** te dice a qué hora se libera en vez de quedarse esperando.

## Instalación

> [!TIP]
> ### La forma más fácil: pídeselo a Claude
>
> Abre Claude Code (la app de escritorio o la terminal), copia este mensaje, pégalo en el chat y envíalo:
>
> ```text
> Instala el plugin chat-notes del marketplace de GitHub mark-quispe/claude-chat-notes, con alcance de usuario.
> ```
>
> Claude hace el resto. Te pedirá permiso antes de ejecutar los comandos: acéptalo. Cuando termine, **abre una sesión nueva**: verás **📝 Apuntes · 0** abajo a la derecha del cuadro de texto. Resalta cualquier parte de una respuesta y pulsa **📝 Guardar resaltado** para guardar tu primera nota.

> [!NOTE]
> **¿Dónde se abre el panel?** Pulsa **📝 Apuntes** en el pie y se abre al costado del chat. En la app de escritorio puedes moverlo a la izquierda desde el menú del panel, o agrandarlo con **⤢** mientras editas una nota. También se abre y cierra escribiendo `/apuntes`.

### Requisitos

- Claude Code: la app de escritorio, donde se ve como en la animación, o la terminal, donde se ve con texto en lugar de tarjetas.
- **Ordenar** y los títulos de cada nota usan Claude Haiku con tu cuenta. Gastan muy poco de tu uso, porque Haiku es el modelo más liviano.
- La flecha **↑** para guardar el `.md` abre el cuadro **Guardar como** de Windows. En Mac y Linux usa **Copiar**.

### Otras formas de instalarlo

En el prompt de una sesión de Claude Code en la terminal:

```
/plugin install chat-notes --marketplace mark-quispe/claude-chat-notes
```

Responde `y` para agregar el marketplace y elige el alcance (usuario, para todas tus sesiones).

Desde una terminal:

```bash
claude plugin install chat-notes --marketplace mark-quispe/claude-chat-notes
```

En la app de escritorio, donde `/plugin` no funciona: haz clic en **+** junto al cuadro de texto, luego **Plugins**, **Add marketplace** con `mark-quispe/claude-chat-notes`, y después **Add plugin**.

El botón **📝 Apuntes** aparece en las sesiones que abras después de instalarlo.

## Dónde quedan tus notas

- Se guardan en tu computadora, separadas por carpeta de proyecto. Todos los chats abiertos en la misma carpeta comparten las mismas notas.
- Los chats sin carpeta tienen sus propias notas, que se borran solas cuando borras ese chat.
- Para vaciar las notas de un proyecto de una vez, escribe `/apuntes vaciar`.
- Solo salen de tu computadora cuando pulsas **Ordenar** o se crea un título: entonces se envían a Claude, como cualquier mensaje tuyo.

## Desinstalar

```bash
claude plugin uninstall chat-notes
```

## Regenerar la animación

La animación de `docs/demo.svg` se arma con los mismos colores y textos del panel real. Si cambias el panel, vuelve a generarla (necesita Python 3):

```bash
python tools/escena_demo.py
```
