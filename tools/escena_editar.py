"""Genera docs/editar.svg: cómo se edita una nota, en la misma toma que la demo principal (chat y panel).

Uso: python tools/escena_editar.py

Historia: pulsas Editar en una nota con viñetas y una tabla. Tocas el lápiz de una viñeta: solo esa
línea se abre en Markdown, el resto sigue formateado; cambias el precio y pulsas Listo. Luego tocas el
lápiz de la tabla: se abre en Markdown con su vista previa debajo, que cambia mientras escribes.
Pulsas Terminar y la nota queda actualizada. Todos los datos son inventados.
"""
import json
import subprocess
import sys
import tempfile
from html import escape
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# Mismos valores que hooks/register.tsx
MUTED = "#888780"
BLUE = "#378ADD"
CARD_BORDER = "#3A3A38"
CARD_BG = "#232322"

# Colores de la app (tema oscuro)
COLUMNA, CLARO, TENUE = "#191918", "#ECEAE3", "#A6A49C"
PRIMARIO, PRIMARIO_TXT = "#F4F3EE", "#1C1C1B"
SECUNDARIO, SECUNDARIO_TXT = "#3A3937", "#D6D4CC"
FOCO, CAMPO = "#3B82F6", "#2A2A28"
CELDA, CELDA_CABEZA = "#2C2C2A", "#333331"
SIMBOLO = "'Segoe UI Symbol','DejaVu Sans',sans-serif"
FUENTE = "'Segoe UI','Segoe UI Emoji','Apple Color Emoji',system-ui,-apple-system,sans-serif"

# La tarjeta va en el panel de la demo principal, a su tamaño real
_fuente = (RAIZ / "tools" / "escena_demo.py").read_text(encoding="utf-8")
DEMO = {"__file__": str(RAIZ / "tools" / "escena_demo.py")}
exec(_fuente[:_fuente.index("cuadros = []")], DEMO)
TW, TH = DEMO["W"], DEMO["H"]
PX, PW = DEMO["PX"], DEMO["PW"]
ARRIBA = 118                # donde empieza la tarjeta, bajo el botón Ordenar
W, H = TW, TH - ARRIBA
X, CW = PX, PW              # tarjeta
IX = X + 12                 # sangría del contenido


def texto(x, y, spans, ancla="start", tam=12.5):
    negrita = ' font-weight="600"'
    partes = "".join(f'<tspan fill="{c}"{negrita if b else ""}>{escape(t)}</tspan>' for t, c, b in spans)
    return f'<text x="{x}" y="{y}" font-size="{tam}" font-family="{FUENTE}" text-anchor="{ancla}">{partes}</text>'


def ancho(t, tam=13):
    return len(t) * tam * 0.53


def boton(x, y, etiqueta, tipo="secundario", estado="normal", tam=13):
    w = ancho(etiqueta, tam) + 26
    if tipo == "primario":
        relleno = {"normal": PRIMARIO, "encima": "#FFFFFF", "pulsado": "#D9D7CF"}[estado]
        color = PRIMARIO_TXT
    else:
        relleno = {"normal": SECUNDARIO, "encima": "#4A4946", "pulsado": "#55534F"}[estado]
        color = SECUNDARIO_TXT
    return w, [f'<rect class="g" x="{x:.0f}" y="{y}" width="{w:.0f}" height="28" rx="7" fill="{relleno}"/>',
               texto(x + w / 2, y + 19, [(etiqueta, color, False)], "middle", tam)]


def icono_lapiz(cx, cy, color):
    """El lápiz ✎ dibujado como figura: si fuera texto, algunos navegadores lo pintan como emoji amarillo."""
    return (f'<g class="g" transform="translate({cx} {cy}) rotate(45)" fill="{color}">'
            f'<rect x="-1.9" y="-6.5" width="3.8" height="2" rx=".6"/>'
            f'<rect x="-1.9" y="-4" width="3.8" height="7"/>'
            f'<path d="M-1.9 3.6 L0 6.8 L1.9 3.6 Z"/></g>')


def lapiz(y, estado="normal"):
    color = {"normal": MUTED, "encima": CLARO, "pulsado": CLARO}[estado]
    p = []
    if estado != "normal":
        p.append(f'<rect class="g" x="{X + CW - 34}" y="{y - 15}" width="22" height="20" rx="5" fill="#3A3937"/>')
    p.append(icono_lapiz(X + CW - 23, y - 5, color))
    return p


# --- Bloques de la nota --------------------------------------------------------------------

def viñeta(precio_pro):
    return [("- Precio del plan **Pro**: " + precio_pro,
             [("•  ", CLARO, False), ("Precio del plan ", CLARO, False), ("Pro", CLARO, True),
              (f": {precio_pro}", CLARO, False)])]


def filas(precio_pro):
    return [("Plan", "Precio"), ("Básico", "$5"), ("Pro", precio_pro)]


def md_tabla(precio_pro):
    return ["| Plan | Precio |", "| --- | --- |", "| Básico | $5 |", f"| Pro | {precio_pro} |"]


def tabla(y, datos):
    """Una tabla formateada como la dibuja la app; devuelve su alto."""
    total = CW - 28 - 34
    w = [round(total * 0.4) - 2, total - round(total * 0.4)]
    p, col = [], [IX, IX + w[0] + 2]
    for f, (a, b) in enumerate(datos):
        relleno = CELDA_CABEZA if f == 0 else CELDA
        for c, valor in enumerate((a, b)):
            p.append(f'<rect x="{col[c]}" y="{y + f * 30}" width="{w[c]}" height="28" fill="{relleno}"/>')
            p.append(texto(col[c] + 10, y + f * 30 + 19, [(valor, CLARO, f == 0)], tam=13))
    return len(datos) * 30, p


def campo(y, lineas, etiqueta="listo"):
    """El cuadro de texto con el Markdown crudo y el chip de la app a la derecha."""
    alto = 16 + len(lineas) * 20
    cw = CW - 104
    p = [f'<rect class="g" x="{IX - 2}" y="{y}" width="{cw}" height="{alto}" rx="8" fill="{CAMPO}" '
         f'stroke="{FOCO}" stroke-width="1.6"/>']
    for k, l in enumerate(lineas):
        p.append(texto(IX + 8, y + 22 + k * 20, [(l, CLARO, False)], tam=13))
    _, b = boton(IX + cw + 8, y + 2, etiqueta, tam=12.5)
    return alto, p + b


# --- Un cuadro --------------------------------------------------------------------------------

def cuadro(modo, pro_viñeta="$12", pro_tabla="$12", escrito=None, abierto=None, boton_estado=None,
           lapiz_en=None, editar_estado="normal"):
    p = [f'<rect class="g" x="0" y="0" width="{W}" height="{H}" rx="10" fill="{COLUMNA}"/>']
    y = 12
    alto_total_inicio = y
    contenido = []
    yy = y + 24
    # Encabezado de la tarjeta; al editar, la app lo oculta
    if modo == "edicion":
        yy += 8
    else:
        contenido.append(texto(IX, yy, [("NOTA 02", CLARO, True), (" — PLANES Y PRECIOS", MUTED, False)], tam=12.5))
        ec = {"normal": MUTED, "encima": CLARO, "pulsado": CLARO}[editar_estado]
        contenido.append(texto(X + CW - 14, yy, [("Editar", ec, False)], "end", 12.5))
        contenido.append(f'<rect x="{IX}" y="{yy + 9}" width="{CW - 100}" height="1" fill="{CARD_BORDER}"/>')
        yy += 34
    if modo == "edicion" and abierto is None:
        contenido.append(texto(IX, yy, [("Toca", MUTED, False)], tam=12.5))
        contenido.append(icono_lapiz(IX + 38, yy - 5, MUTED))
        contenido.append(texto(IX + 48, yy, [("junto al párrafo que quieras cambiar.", MUTED, False)], tam=12.5))
        yy += 28

    bloques = ["v1", "v2", "tabla"]
    for nombre in bloques:
        if nombre == "v1":
            crudo, spans = viñeta(pro_viñeta)[0]
            if abierto == "v1":
                alto, b = campo(yy - 16, [escrito if escrito is not None else crudo])
                contenido += b
                yy += alto + 8
                w, b1 = boton(IX, yy - 14, "Listo", "primario", boton_estado or "normal", 12.5)
                _, b2 = boton(IX + w + 8, yy - 14, "Cancelar", tam=12.5)
                contenido += b1 + b2
                yy += 44
            else:
                contenido.append(texto(IX, yy, spans, tam=12.5))
                if modo == "edicion" and abierto is None:
                    contenido += lapiz(yy, "encima" if lapiz_en == "v1" else "normal")
                yy += 28
        elif nombre == "v2":
            contenido.append(texto(IX, yy, [("•  ", CLARO, False), ("Prueba gratis de ", CLARO, False),
                                             ("7 días", CLARO, True)], tam=12.5))
            if modo == "edicion" and abierto is None:
                contenido += lapiz(yy)
            yy += 22
        else:
            if abierto == "tabla":
                lineas = md_tabla(pro_tabla)
                if escrito is not None:
                    lineas[-1] = escrito
                alto, b = campo(yy, lineas)
                contenido += b
                yy += alto + 22
                contenido.append(texto(IX, yy, [("Vista previa", MUTED, False)], tam=12.5))
                yy += 10
                vista = pro_tabla if escrito is None else escrito.split("|")[2].strip() or " "
                caja_y = yy
                th, tb = tabla(yy + 12, filas(vista))
                contenido.append(f'<rect class="g" x="{IX - 4.5}" y="{caja_y + .5}" width="{CW - 20}" '
                                 f'height="{th + 22}" rx="8" fill="none" stroke="{CARD_BORDER}"/>')
                contenido += tb
                yy += th + 40
                w, b1 = boton(IX, yy - 10, "Listo", "primario", boton_estado or "normal", 12.5)
                _, b2 = boton(IX + w + 8, yy - 10, "Cancelar", tam=12.5)
                contenido += b1 + b2
                yy += 40
            else:
                yy += 4
                th, tb = tabla(yy, filas(pro_tabla))
                contenido += tb
                if modo == "edicion" and abierto is None:
                    contenido += lapiz(yy + 20, "encima" if lapiz_en == "tabla" else "normal")
                yy += th + 16

    if modo == "edicion" and abierto is None:
        w, b1 = boton(IX, yy - 4, "Terminar", "primario", boton_estado or "normal", 12.5)
        _, b2 = boton(IX + w + 8, yy - 4, "Editar todo", tam=12.5)
        contenido += b1 + b2
        yy += 40
    # Pie de la tarjeta: hora, copiar y borrar
    contenido.append(texto(IX, yy + 4, [("10:41", MUTED, False)], tam=12))
    for k, ic in enumerate(("📋", "🗑")):
        bx = X + CW - 86 + k * 42
        contenido.append(f'<rect class="g" x="{bx}" y="{yy - 14}" width="34" height="26" rx="6" fill="{SECUNDARIO}"/>')
        contenido.append(texto(bx + 17, yy + 4, [(ic, TENUE, False)], "middle", 12))
    yy += 22
    # El relleno de la tarjeta es el mismo en todos los cuadros (llega hasta abajo) y una franja del color
    # del fondo lo corta donde termina la tarjeta: así lo que se repite entre cuadros nunca queda tapado.
    p.append(f'<rect class="g" x="{X}" y="{alto_total_inicio}" width="{CW}" height="{H - 10 - alto_total_inicio}" '
             f'rx="10" fill="{CARD_BG}"/>')
    contenido.insert(0, f'<rect x="{X - 1}" y="{yy + 1}" width="{CW + 2}" height="{H - yy}" fill="{COLUMNA}"/>')
    contenido.insert(1, f'<rect class="g" x="{X + .5}" y="{alto_total_inicio + .5}" width="{CW - 1}" '
                        f'height="{yy - alto_total_inicio}" rx="10" fill="none" '
                        f'stroke="{BLUE if modo == "edicion" else CARD_BORDER}"/>')
    return p + contenido


# --- La toma completa: el chat a la izquierda y el panel con la tarjeta a la derecha -----------------
# Reutiliza el chat y los botones de la demo principal (tools/escena_demo.py), para que las dos
# animaciones se vean iguales.


def toma(**estado):
    t, b = DEMO["texto"], DEMO["boton"]
    partes = DEMO["chat"](set(), ("📝 Apuntes · 2", "secundario", "normal"))
    partes += [f'<rect class="g" x="{PX - 6}" y="0" width="{TW - PX + 6}" height="{TH}" fill="{COLUMNA}"/>',
               f'<rect x="{PX - 6}" y="0" width="1" height="{TH}" fill="{CARD_BORDER}"/>']
    # Con la tabla abierta la tarjeta crece: el panel se desplaza hacia arriba, como en la app
    bajar = -96 if estado.get("abierto") == "tabla" else 0
    panel = [t(PX + 2, 58, [("MI-APP", CLARO, True)], tam=13.5),
             t(PX + 2, 76, [("2 apuntes · sin ordenar", MUTED, False)], tam=12)]
    panel += b(PX + 2, 88, "Ordenar", "primario", "normal", 12.5)[1]
    panel += cuadro(**estado)[1:]   # la tarjeta, sin el fondo propio de la escena
    partes.append(f'<g transform="translate(0 {ARRIBA - 12 + bajar})">'
                  f'<g transform="translate(0 {12 - ARRIBA})">{"".join(panel[:4])}</g>{"".join(panel[4:])}</g>')
    # La barra de título del panel queda fija encima
    # (va dentro de un grupo propio de cada cuadro: si se repitiera igual en todos, armar_svg la dibujaría
    # una sola vez debajo de todo y el panel desplazado la taparía)
    partes.append(f'<g data-desplazado="{bajar}"><rect x="{PX - 5}" y="0" width="{TW - PX + 5}" height="38" '
                  f'fill="{COLUMNA}"/>{t(PX + 2, 26, [("Apuntes", CLARO, False)], tam=13.5)}</g>')
    return partes


cuadros = []


def pon(ms, **estado):
    cuadros.append({"ms": ms, "partes": toma(**estado)})


# La nota tal cual; pulsas Editar
pon(1500, modo="normal")
pon(400, modo="normal", editar_estado="encima")
pon(150, modo="normal", editar_estado="pulsado")
# Modo edición: cada bloque con su lápiz
pon(1400, modo="edicion")
pon(450, modo="edicion", lapiz_en="v1")
# Se abre solo la viñeta y cambias $12 por $15
crudo = "- Precio del plan **Pro**: $1"
pon(900, modo="edicion", abierto="v1")
pon(350, modo="edicion", abierto="v1", escrito=crudo)
pon(500, modo="edicion", abierto="v1", escrito=crudo + "5")
pon(350, modo="edicion", abierto="v1", escrito=crudo + "5", boton_estado="encima")
pon(150, modo="edicion", abierto="v1", escrito=crudo + "5", boton_estado="pulsado")
pon(1200, modo="edicion", pro_viñeta="$15")
# Ahora la tabla: se abre con su vista previa, que cambia mientras escribes
pon(450, modo="edicion", pro_viñeta="$15", lapiz_en="tabla")
pon(1300, modo="edicion", pro_viñeta="$15", abierto="tabla")
pon(350, modo="edicion", pro_viñeta="$15", abierto="tabla", escrito="| Pro | $1 |")
pon(1400, modo="edicion", pro_viñeta="$15", abierto="tabla", escrito="| Pro | $15 |")
pon(350, modo="edicion", pro_viñeta="$15", abierto="tabla", escrito="| Pro | $15 |", boton_estado="encima")
pon(150, modo="edicion", pro_viñeta="$15", abierto="tabla", escrito="| Pro | $15 |", boton_estado="pulsado")
pon(1100, modo="edicion", pro_viñeta="$15", pro_tabla="$15")
# Terminar
pon(350, modo="edicion", pro_viñeta="$15", pro_tabla="$15", boton_estado="encima")
pon(150, modo="edicion", pro_viñeta="$15", pro_tabla="$15", boton_estado="pulsado")
pon(3000, modo="normal", pro_viñeta="$15", pro_tabla="$15")

escena = {"ancho": TW, "alto": TH, "quieto": 14, "cuadros": cuadros}
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as t:
    json.dump(escena, t, ensure_ascii=False)
subprocess.run([sys.executable, str(RAIZ / "tools" / "armar_svg.py"), str(RAIZ / "docs" / "editar.svg"), t.name,
                "--pausa", "600"], check=True)
Path(t.name).unlink()
