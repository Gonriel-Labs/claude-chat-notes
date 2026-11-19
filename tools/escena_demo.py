"""Genera docs/demo.svg: el panel de notas en uso, reconstruido con los colores y textos de hooks/register.tsx.

Uso: python tools/escena_demo.py

Historia: resaltas tres lineas de una respuesta de Claude; el boton del pie cambia a "Guardar resaltado";
lo pulsas y la nota aparece arriba en el panel, con su titulo corto. Luego pulsas Ordenar y el panel
muestra todo agrupado por tema, con un titulo general. Todos los datos son inventados.
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
FONDO, COLUMNA, CAJA, BORDE_CAJA = "#1C1C1B", "#191918", "#2F2E2C", "#3D3C39"
CLARO, TENUE, PLACEHOLDER = "#ECEAE3", "#A6A49C", "#8C8A84"
SELECCION = "#1D3F8A"
PRIMARIO, PRIMARIO_TXT = "#F4F3EE", "#1C1C1B"
SECUNDARIO, SECUNDARIO_TXT = "#3A3937", "#D6D4CC"
FUENTE = "'Segoe UI',system-ui,-apple-system,sans-serif"
MONO = "Consolas,Menlo,monospace"

W, H = 780, 470
CHAT_W = 430                       # columna del chat
PX = CHAT_W + 14                   # el panel empieza aqui
PW = W - PX - 10                   # ancho del panel
PROMPT_Y, PROMPT_H = H - 62, 46


def texto(x, y, spans, ancla="start", tam=13.5, familia=FUENTE):
    negrita = ' font-weight="600"'
    partes = "".join(f'<tspan fill="{c}"{negrita if b else ""}>{escape(t)}</tspan>' for t, c, b in spans)
    return (f'<text x="{x}" y="{y}" font-size="{tam}" font-family="{familia}" '
            f'text-anchor="{ancla}">{partes}</text>')


def ancho(t, tam=13):
    return len(t) * tam * 0.56


def boton(x, y, etiqueta, tipo="secundario", estado="normal", tam=13):
    w = ancho(etiqueta, tam) + 26
    if tipo == "primario":
        relleno = {"normal": PRIMARIO, "encima": "#FFFFFF", "pulsado": "#D9D7CF"}[estado]
        color = PRIMARIO_TXT
    elif tipo == "apagado":
        relleno, color = SECUNDARIO, "#7E7C76"
    else:
        relleno = {"normal": SECUNDARIO, "encima": "#4A4946", "pulsado": "#55534F"}[estado]
        color = SECUNDARIO_TXT
    return w, [f'<rect class="g" x="{x}" y="{y}" width="{w:.0f}" height="28" rx="7" fill="{relleno}"/>',
               texto(x + w / 2, y + 19, [(etiqueta, color, False)], "middle", tam)]


# --- La columna del chat ---------------------------------------------------------------

RESPUESTA = [
    ("p", [("Listo, revisé el plan de lanzamiento de mi-app.", CLARO, False)]),
    ("h", [("Antes de publicar", CLARO, True)]),
    ("li", [("Pruebas del carrito ", CLARO, False), ("en verde", CLARO, True)]),
    ("li", [("Revisar los textos de la pantalla de pago", CLARO, False)]),
    ("li", [("Meta del sprint: ", CLARO, True), ("90 % de pruebas en verde", CLARO, False)]),
    ("p", [("¿Quieres que empiece por las pruebas del carrito?", CLARO, False)]),
]
SELECCIONABLES = [1, 2, 3, 4]      # titulo y las tres viñetas


def chat(resaltadas, pie):
    p = [f'<rect class="g" x="0" y="0" width="{W}" height="{H}" rx="10" fill="{FONDO}"/>']
    p.append(texto(22, 32, [("Tú  ", TENUE, True), ("¿Qué falta para lanzar la app?", CLARO, False)], tam=14))
    y = 70
    for i, (tipo, spans) in enumerate(RESPUESTA):
        x = 40 if tipo == "li" else 22
        alto = 24
        if i in resaltadas:
            largo = sum(len(t) * 14 * 0.5 for t, _, _ in spans)
            p.append(f'<rect x="{x - 2}" y="{y - 16}" width="{largo + 6:.0f}" height="21" fill="{SELECCION}"/>')
        if i in resaltadas:
            # El texto resaltado va en blanco, encima del azul, como en la app
            spans = [(t, "#FFFFFF", b) for t, _, b in spans]
        if tipo == "li":
            p.append(texto(26, y, [("•", CLARO, False)], tam=14))
        p.append(texto(x, y, spans, tam=15 if tipo == "h" else 14))
        y += alto + (8 if tipo in ("p", "h") else 0)
    # Cuadro de mensaje y pie con el boton del mod
    p.append(f'<rect class="g" x="12.5" y="{PROMPT_Y - 40.5}" width="{CHAT_W - 25}" height="{PROMPT_H}" rx="10" '
             f'fill="{CAJA}" stroke="{BORDE_CAJA}"/>')
    p.append(texto(30, PROMPT_Y - 12, [("Responder…", PLACEHOLDER, False)], tam=14))
    p.append(texto(22, PROMPT_Y + 34, [("Opus · Medio · Automático", TENUE, False)], tam=12.5))
    etiqueta, tipo, estado = pie
    w = ancho(etiqueta, 12.5) + 26
    _, b = boton(CHAT_W - 12 - w, PROMPT_Y + 14, etiqueta, tipo, estado, 12.5)
    p += b
    return p


# --- El panel de notas ---------------------------------------------------------------------

NOTAS = [
    ("01", "CONFIGURAR LA API", ["Paso 1: poner la clave de la API", "en el archivo .env"], "09:12"),
    ("02", "COLORES DEL TEMA", ["El botón principal usa el azul", "#378ADD en los dos temas"], "09:40"),
]
NUEVA = ("03", "ANTES DE PUBLICAR", None, "10:41")
NUEVA_MD = [("h", "Antes de publicar"), ("li", "Pruebas del carrito en verde"),
            ("li", "Revisar los textos de la pantalla de pago"), ("li", "Meta del sprint: 90 % en verde")]

ORDENADO = [("h", "Antes de publicar"), ("li", "Pruebas del carrito en verde"),
            ("li", "Revisar textos de la pantalla de pago"), ("li", "Meta del sprint: 90 % en verde"),
            ("h", "Configuración"), ("li", "Clave de la API en el archivo .env"),
            ("h", "Diseño"), ("li", "Botón principal: azul #378ADD")]


def tarjeta(y, num, titulo, lineas, hora, md=None, resaltada=False):
    alto = 30 + (len(md) if md else len(lineas)) * 19 + 26
    borde = BLUE if resaltada else CARD_BORDER
    p = [f'<rect class="g" x="{PX + 0.5}" y="{y + 0.5}" width="{PW - 1}" height="{alto}" rx="9" '
         f'fill="{CARD_BG}" stroke="{borde}"/>']
    cabeza = [(f"NOTA {num}", CLARO, True)]
    if titulo:
        cabeza.append((f" — {titulo}", MUTED, False))
    p.append(texto(PX + 12, y + 22, cabeza, tam=12.5))
    p.append(texto(PX + PW - 12, y + 22, [("Editar", MUTED, False)], "end", 12))
    p.append(f'<rect x="{PX + 12}" y="{y + 30}" width="{PW - 80}" height="1" fill="{CARD_BORDER}"/>')
    yy = y + 48
    for tipo, t in (md or [("p", l) for l in lineas]):
        if tipo == "h":
            p.append(texto(PX + 12, yy, [(t, CLARO, True)], tam=12.5))
        elif tipo == "li":
            p.append(texto(PX + 14, yy, [("•  ", CLARO, False), (t, CLARO, False)], tam=12.5))
        else:
            p.append(texto(PX + 12, yy, [(t, CLARO, False)], tam=12.5))
        yy += 19
    p.append(texto(PX + 12, y + alto - 9, [(hora, MUTED, False)], tam=11.5))
    p.append(texto(PX + PW - 14, y + alto - 9, [("📋   🗑", TENUE, False)], "end", 12))
    return alto, p


def panel(notas_nuevas, titulo_nueva, vista="recortes", ordenar="normal"):
    p = [f'<rect class="g" x="{PX - 6}" y="0" width="{W - PX + 6}" height="{H}" fill="{COLUMNA}"/>',
         f'<rect x="{PX - 6}" y="0" width="1" height="{H}" fill="{CARD_BORDER}"/>',
         texto(PX + 2, 26, [("Apuntes", CLARO, False)], tam=13.5)]
    n = 2 + notas_nuevas
    if vista == "ordenado":
        p.append(texto(PX + 2, 58, [("LANZAMIENTO DE MI-APP", CLARO, True)], tam=13.5))
        p.append(texto(PX + 2, 76, [(f"mi-app · {n} apuntes · ordenado 10:42", MUTED, False)], tam=12))
    else:
        p.append(texto(PX + 2, 58, [("MI-APP", CLARO, True)], tam=13.5))
        estado = "ordenando…" if ordenar == "ordenando" else "sin ordenar"
        p.append(texto(PX + 2, 76, [(f"{n} apuntes · {estado}", MUTED, False)], tam=12))
    x, y = PX + 2, 88
    if vista == "ordenado":
        for etiqueta, tipo in (("Ordenado", "apagado"), ("Ver apuntes", "secundario"),
                               ("Copiar", "secundario"), ("↑", "secundario")):
            w, b = boton(x, y, etiqueta, tipo, tam=12.5)
            p += b
            x += w + 6
        alto = 22 + len(ORDENADO) * 21
        p.append(f'<rect class="g" x="{PX + 0.5}" y="{130.5}" width="{PW - 1}" height="{alto}" rx="9" '
                 f'fill="{CARD_BG}" stroke="{CARD_BORDER}"/>')
        yy = 156
        for tipo, t in ORDENADO:
            if tipo == "h":
                yy += 4
                p.append(texto(PX + 12, yy, [(t, CLARO, True)], tam=13.5))
            else:
                p.append(texto(PX + 14, yy, [("•  ", CLARO, False), (t, CLARO, False)], tam=12.5))
            yy += 20
        return p
    etiqueta = "Ordenando…" if ordenar == "ordenando" else "Ordenar"
    estado = ordenar if ordenar in ("encima", "pulsado") else "normal"
    _, b = boton(x, y, etiqueta, "primario", estado, 12.5)
    p += b
    y = 130
    lista = ([(NUEVA[0], titulo_nueva, None, NUEVA[3], NUEVA_MD)] if notas_nuevas else []) + \
            [(a, b_, c, d, None) for a, b_, c, d in reversed(NOTAS)]
    for i, (num, titulo, lineas, hora, md) in enumerate(lista):
        alto, t = tarjeta(y, num, titulo, lineas, hora, md, resaltada=(notas_nuevas and i == 0 and not titulo))
        p += t
        y += alto + 10
    return p


cuadros = []


def pon(ms, resaltadas=(), pie=("📝 Apuntes · 2", "secundario", "normal"), nuevas=0, titulo=None,
        vista="recortes", ordenar="normal"):
    cuadros.append({"ms": ms, "partes": chat(set(resaltadas), pie) + panel(nuevas, titulo, vista, ordenar)})


pon(1500)
# Resaltas el titulo y las tres viñetas, de arriba abajo
for k in range(1, len(SELECCIONABLES) + 1):
    pon(220, resaltadas=SELECCIONABLES[:k])
guardar = ("📝 Guardar resaltado", "primario")
pon(1300, resaltadas=SELECCIONABLES, pie=(*guardar, "normal"))
pon(450, resaltadas=SELECCIONABLES, pie=(*guardar, "encima"))
pon(160, resaltadas=SELECCIONABLES, pie=(*guardar, "pulsado"))
# La nota aparece arriba, y un momento despues su titulo corto
pie3 = ("📝 Apuntes · 3", "secundario", "normal")
pon(1100, pie=pie3, nuevas=1)
pon(1800, pie=pie3, nuevas=1, titulo=NUEVA[1])
# Ordenar
pon(450, pie=pie3, nuevas=1, titulo=NUEVA[1], ordenar="encima")
pon(160, pie=pie3, nuevas=1, titulo=NUEVA[1], ordenar="pulsado")
pon(1100, pie=pie3, nuevas=1, titulo=NUEVA[1], ordenar="ordenando")
pon(4200, pie=pie3, nuevas=1, titulo=NUEVA[1], vista="ordenado")

escena = {"ancho": W, "alto": H, "quieto": len(cuadros) - 7, "cuadros": cuadros}
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as t:
    json.dump(escena, t, ensure_ascii=False)
subprocess.run([sys.executable, str(RAIZ / "tools" / "armar_svg.py"), str(RAIZ / "docs" / "demo.svg"), t.name,
                "--pausa", "600"], check=True)
Path(t.name).unlink()
