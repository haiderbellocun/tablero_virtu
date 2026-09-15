"""Consultas del reporte de virtualizacion (fabrica.archivo y tablas relacionadas).

A diferencia del reporte de costos, aqui no hay una tabla materializada: los
paneles se arman sobre el join real (archivo -> granulo -> materia -> programa
-> escuela) descrito en el ERD que compartio Haider. No existe una columna de
nivel (pregrado/especializacion/diplomado/maestria); Haider confirmo que ese
dato viene como texto dentro de programa.nombre, asi que se deriva con un
CASE/ILIKE (NIVEL_EXPR) reutilizado en todas las consultas que lo necesitan.

Los filtros se dividen en dos grupos porque afectan universos distintos:

- ESTRUCTURALES (escuela, programa, nivel, semestre): describen el catalogo
  academico y no dependen de si hay o no archivos cargados. Se usan solos
  para calcular denominadores como "materias totales" en el panel de
  cobertura.
- DE CONTENIDO (periodo, extension, busqueda): solo tienen sentido sobre
  filas de archivo. Se combinan con los estructurales para cualquier
  consulta que parta de fabrica.archivo.

Todas las funciones devuelven (sql, params) listos para pasar a
db.consultar(sql, params) — nunca se interpola un valor de filtro directo en
el texto SQL, solo nombres de columna fijos y placeholders %s.
"""

from __future__ import annotations

import os
import re

_IDENT = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _ident(valor: str, nombre: str) -> str:
    valor = (valor or "").strip().lower()
    if not _IDENT.match(valor):
        raise ValueError(f"{nombre} invalido: {valor!r}")
    return valor


ESQUEMA = _ident(os.environ.get("FABRICA_SCHEMA", "fabrica"), "FABRICA_SCHEMA")

NIVEL_EXPR = (
    "CASE "
    "WHEN pr.nombre ILIKE '%%diplomado%%'  THEN 'Diplomado' "
    "WHEN pr.nombre ILIKE '%%especializ%%' THEN 'Especialización' "
    "WHEN pr.nombre ILIKE '%%maestr%%'     THEN 'Maestría' "
    "ELSE 'Pregrado' END"
)
NIVELES = ["Diplomado", "Especialización", "Maestría", "Pregrado"]

# fabrica.escuela trae la misma escuela repetida bajo varias grafias (typos,
# falta de "DE", encoding roto de tildes) segun quien la haya cargado. Se
# normaliza aqui — sin tocar el dato de origen — para que cada escuela real
# aparezca como una sola fila en los paneles y en los desplegables. Las filas
# con e.nombre = '' (sin escuela asignada) se excluyen directamente en
# WHERE_BASE / where_materia mientras se corrige en el origen.
ESCUELA_EXPR = (
    "CASE "
    "WHEN e.nombre ILIKE '%%DISE%%COMUNICACION%%' THEN 'Escuela de Diseño y Comunicación' "
    "WHEN e.nombre ILIKE '%%CIENCIAS_SOCIALES%%GOBIERNO%%' THEN 'Escuela de Ciencias Sociales, Jurídicas y de Gobierno' "
    "WHEN e.nombre ILIKE '%%INGENIERIA%%' THEN 'Escuela de Ingeniería' "
    "WHEN e.nombre ILIKE '%%TRANSFORMACION_EMPRESARIAL%%' THEN 'Escuela de Transformación Empresarial' "
    "WHEN e.nombre ILIKE '%%SALUD%%BIENESTAR%%' THEN 'Escuela de Salud y Bienestar' "
    "ELSE initcap(replace(e.nombre, '_', ' ')) END"
)

# programa.nombre solo necesita formato (guion bajo -> espacio, mayusculas
# iniciales); a diferencia de escuela, no hay variantes duplicadas conocidas.
PROGRAMA_EXPR = "initcap(replace(pr.nombre, '_', ' '))"

# extension.tipo es varchar(10) y, para archivos/carpetas sin extension real,
# el cargue trunco el nombre a 10 caracteres en vez de dejarlo vacio (p.ej.
# 'identifica', 'isplayer'). Esa basura y las filas sin extension ('') se
# excluyen del panel de extensiones via esta lista blanca; el resto de
# paneles (por escuela, programa, semestre, detalle) no se ve afectado.
EXTENSIONES_VALIDAS = [
    "PDF", "MP3", "MP4", "PNG", "DOCX", "ZIP", "TXT", "PPTX", "XML", "QUIZ",
    "JPG", "PPTM", "WAV", "INI", "ICO", "AI", "SCENARIO", "PRPROJ", "TTF",
    "M4A", "OTF",
]

FROM_ARCHIVO = f"""
FROM       {ESQUEMA}.archivo      a
JOIN       {ESQUEMA}.granulo      g   ON g.id  = a.granulo_id
JOIN       {ESQUEMA}.materia      m   ON m.id  = g.materia_id
JOIN       {ESQUEMA}.programa     pr  ON pr.id = m.programa_id
JOIN       {ESQUEMA}.escuela      e   ON e.id  = pr.escuela_id
JOIN       {ESQUEMA}.paquete      pk  ON pk.id = m.paquete_id
JOIN       {ESQUEMA}.periodo      p   ON p.id  = a.periodo_id
JOIN       {ESQUEMA}.cliente      c   ON c.id  = a.cliente_id
JOIN       {ESQUEMA}.extension    ex  ON ex.id = a.extension_id
"""

# Universo estructural: catalogo academico sin pasar por archivo. Sirve para
# denominadores (cuantas materias/programas EXISTEN) independientes de si ya
# tienen contenido cargado.
FROM_MATERIA = f"""
FROM       {ESQUEMA}.materia      m
JOIN       {ESQUEMA}.programa     pr  ON pr.id = m.programa_id
JOIN       {ESQUEMA}.escuela      e   ON e.id  = pr.escuela_id
"""

WHERE_BASE = "a.activo = TRUE AND c.nombre ILIKE '%%producto%%' AND e.nombre <> ''"

# Misma exclusion de "sin escuela" para el universo estructural (sin join a
# archivo/cliente), usada por where_materia.
_ESCUELA_ASIGNADA = "e.nombre <> ''"


# ---------- filtros ----------

def _condiciones_estructurales(f: dict) -> tuple[list[str], list]:
    cond: list[str] = []
    params: list = []
    if f.get("escuela"):
        cond.append(f"({ESCUELA_EXPR}) = %s")
        params.append(f["escuela"])
    if f.get("programa"):
        cond.append(f"({PROGRAMA_EXPR}) = %s")
        params.append(f["programa"])
    if f.get("nivel"):
        cond.append(f"({NIVEL_EXPR}) = %s")
        params.append(f["nivel"])
    if f.get("semestre") is not None:
        cond.append("m.semestre = %s")
        params.append(f["semestre"])
    return cond, params


def _condiciones_contenido(f: dict) -> tuple[list[str], list]:
    cond: list[str] = []
    params: list = []
    if f.get("periodo"):
        cond.append("p.codigo = %s")
        params.append(f["periodo"])
    if f.get("extension"):
        cond.append("upper(ex.tipo) = upper(%s)")
        params.append(f["extension"])
    if f.get("q"):
        like = f"%{f['q']}%"
        cond.append(
            "(a.nombre ILIKE %s OR a.nombre_original ILIKE %s OR g.nombre ILIKE %s "
            "OR m.nombre ILIKE %s OR pr.nombre ILIKE %s)"
        )
        params.extend([like] * 5)
    return cond, params


def where_archivo(f: dict) -> tuple[str, list]:
    """WHERE completo (estructural + contenido) para consultas sobre FROM_ARCHIVO."""
    cond = [WHERE_BASE]
    params: list = []
    ce, pe = _condiciones_estructurales(f)
    cc, pc = _condiciones_contenido(f)
    cond += ce + cc
    params += pe + pc
    return " AND ".join(cond), params


def where_materia(f: dict) -> tuple[str, list]:
    """WHERE solo estructural, para consultas sobre FROM_MATERIA (sin archivo)."""
    ce, pe = _condiciones_estructurales(f)
    cond = [_ESCUELA_ASIGNADA] + ce
    return " AND ".join(cond), pe


# ---------- KPIs ----------

def sql_kpis(f: dict) -> tuple[str, list]:
    where, params = where_archivo(f)
    sql = f"""
    SELECT
        count(*)                    AS archivos,
        count(DISTINCT g.id)        AS granulos,
        count(DISTINCT m.id)        AS materias,
        count(DISTINCT pr.id)       AS programas,
        count(DISTINCT ({ESCUELA_EXPR})) AS escuelas,
        count(DISTINCT p.codigo)    AS periodos
    {FROM_ARCHIVO}
    WHERE {where}
    """
    return sql, params


def sql_materias_totales(f: dict) -> tuple[str, list]:
    """Denominador estructural: cuantas materias y programas EXISTEN con los
    filtros de escuela/programa/nivel/semestre, sin importar si tienen
    contenido cargado."""
    where, params = where_materia(f)
    sql = f"""
    SELECT count(DISTINCT m.id) AS materias, count(DISTINCT pr.id) AS programas
    {FROM_MATERIA}
    WHERE {where}
    """
    return sql, params


# ---------- paneles ----------

def sql_por_escuela(f: dict) -> tuple[str, list]:
    """Panel 1: comparativo por escuela (archivos/granulos/materias/programas)."""
    where, params = where_archivo(f)
    sql = f"""
    SELECT
        ({ESCUELA_EXPR})        AS escuela,
        count(*)                AS archivos,
        count(DISTINCT g.id)    AS granulos,
        count(DISTINCT m.id)    AS materias,
        count(DISTINCT pr.id)   AS programas
    {FROM_ARCHIVO}
    WHERE {where}
    GROUP BY ({ESCUELA_EXPR})
    ORDER BY archivos DESC
    """
    return sql, params


def sql_nivel_por_escuela(f: dict) -> tuple[str, list]:
    """Panel 2: composicion de programas por nivel dentro de cada escuela.
    Universo estructural (no depende de si el programa ya tiene contenido)."""
    where, params = where_materia(f)
    sql = f"""
    SELECT
        ({ESCUELA_EXPR}) AS escuela,
        count(DISTINCT pr.id) FILTER (WHERE ({NIVEL_EXPR}) = 'Diplomado')      AS diplomado,
        count(DISTINCT pr.id) FILTER (WHERE ({NIVEL_EXPR}) = 'Especialización') AS especializacion,
        count(DISTINCT pr.id) FILTER (WHERE ({NIVEL_EXPR}) = 'Maestría')       AS maestria,
        count(DISTINCT pr.id) FILTER (WHERE ({NIVEL_EXPR}) = 'Pregrado')       AS pregrado,
        count(DISTINCT pr.id)                                                  AS total
    {FROM_MATERIA}
    WHERE {where}
    GROUP BY ({ESCUELA_EXPR})
    ORDER BY total DESC
    """
    return sql, params


def sql_bubble_escuela(f: dict) -> tuple[str, list]:
    """Panel 3: burbujas por escuela (x=programas, y=materias, tamano=archivos)."""
    where, params = where_archivo(f)
    sql = f"""
    SELECT
        ({ESCUELA_EXPR})        AS escuela,
        count(DISTINCT pr.id)   AS programas,
        count(DISTINCT m.id)    AS materias,
        count(*)                AS archivos
    {FROM_ARCHIVO}
    WHERE {where}
    GROUP BY ({ESCUELA_EXPR})
    """
    return sql, params


def sql_cobertura_por_escuela(f: dict) -> tuple[str, list]:
    """Panel 4 (bullet): materias con al menos un archivo, por escuela.
    Se combina en Python con sql_materias_totales agrupado por escuela."""
    where, params = where_archivo(f)
    sql = f"""
    SELECT ({ESCUELA_EXPR}) AS escuela, count(DISTINCT m.id) AS materias_con_contenido
    {FROM_ARCHIVO}
    WHERE {where}
    GROUP BY ({ESCUELA_EXPR})
    """
    return sql, params


def sql_materias_totales_por_escuela(f: dict) -> tuple[str, list]:
    """Denominador del panel de cobertura, desglosado por escuela."""
    where, params = where_materia(f)
    sql = f"""
    SELECT ({ESCUELA_EXPR}) AS escuela, count(DISTINCT m.id) AS materias_totales
    {FROM_MATERIA}
    WHERE {where}
    GROUP BY ({ESCUELA_EXPR})
    """
    return sql, params


def sql_por_extension(f: dict) -> tuple[str, list]:
    """Panel 5: distribucion de archivos por tipo de extension.

    Se agrupa por upper(ex.tipo) para no separar 'pdf' de 'PDF', y se limita
    a EXTENSIONES_VALIDAS para no mostrar las filas sin extension real (ver
    comentario junto a esa constante)."""
    where, params = where_archivo(f)
    sql = f"""
    SELECT upper(ex.tipo) AS extension, count(*) AS archivos
    {FROM_ARCHIVO}
    WHERE {where} AND upper(ex.tipo) = ANY(%s)
    GROUP BY upper(ex.tipo)
    ORDER BY archivos DESC
    """
    return sql, [*params, EXTENSIONES_VALIDAS]


def sql_por_programa(f: dict) -> tuple[str, list]:
    """Panel 6: ranking de programas por volumen de archivos."""
    where, params = where_archivo(f)
    sql = f"""
    SELECT
        ({PROGRAMA_EXPR})        AS programa,
        ({ESCUELA_EXPR})         AS escuela,
        count(*)                 AS archivos,
        count(DISTINCT m.id)     AS materias
    {FROM_ARCHIVO}
    WHERE {where}
    GROUP BY ({PROGRAMA_EXPR}), ({ESCUELA_EXPR})
    ORDER BY archivos DESC
    """
    return sql, params


def sql_por_semestre(f: dict) -> tuple[str, list]:
    """Panel 7: archivos y materias con contenido por semestre curricular."""
    where, params = where_archivo(f)
    sql = f"""
    SELECT
        m.semestre               AS semestre,
        count(*)                 AS archivos,
        count(DISTINCT m.id)     AS materias
    {FROM_ARCHIVO}
    WHERE {where}
    GROUP BY m.semestre
    ORDER BY m.semestre
    """
    return sql, params


# ---------- filtros para los desplegables ----------

def sql_opciones_filtros() -> dict[str, tuple[str, list]]:
    """Una consulta por desplegable. Todas se acotan al mismo universo
    (activo + cliente producto) para no ofrecer opciones que devuelven cero
    filas."""
    return {
        "periodos": (
            f"""SELECT DISTINCT p.codigo AS valor
                FROM {ESQUEMA}.periodo p
                JOIN {ESQUEMA}.archivo a ON a.periodo_id = p.id
                JOIN {ESQUEMA}.cliente c ON c.id = a.cliente_id
                WHERE a.activo = TRUE AND c.nombre ILIKE '%%producto%%'
                ORDER BY 1 DESC""",
            [],
        ),
        "extensiones": (
            f"""SELECT DISTINCT upper(ex.tipo) AS valor
                FROM {ESQUEMA}.extension ex
                JOIN {ESQUEMA}.archivo a ON a.extension_id = ex.id
                JOIN {ESQUEMA}.cliente c ON c.id = a.cliente_id
                WHERE a.activo = TRUE AND c.nombre ILIKE '%%producto%%'
                  AND upper(ex.tipo) = ANY(%s)
                ORDER BY 1""",
            [EXTENSIONES_VALIDAS],
        ),
        "semestres": (
            f"""SELECT DISTINCT m.semestre AS valor
                {FROM_ARCHIVO}
                WHERE {WHERE_BASE} AND m.semestre IS NOT NULL
                ORDER BY 1""",
            [],
        ),
        "escuelas_programas": (
            f"""SELECT DISTINCT ({ESCUELA_EXPR}) AS escuela, ({PROGRAMA_EXPR}) AS programa,
                       ({NIVEL_EXPR}) AS nivel
                {FROM_ARCHIVO}
                WHERE {WHERE_BASE}
                ORDER BY 1, 2""",
            [],
        ),
    }


# ---------- pestaña Detalle ----------

COLUMNAS_DETALLE = [
    "raiz", "destinatario", "periodo", "cliente", "escuela", "programa",
    "nivel", "semestre", "paquete", "materia", "granulo_codigo", "granulo",
    "archivo", "nombre_original", "extension", "enlace", "fecha_registro",
]

FROM_DETALLE = f"""
FROM       {ESQUEMA}.archivo      a
JOIN       {ESQUEMA}.granulo      g   ON g.id  = a.granulo_id
JOIN       {ESQUEMA}.materia      m   ON m.id  = g.materia_id
JOIN       {ESQUEMA}.programa     pr  ON pr.id = m.programa_id
JOIN       {ESQUEMA}.escuela      e   ON e.id  = pr.escuela_id
JOIN       {ESQUEMA}.paquete      pk  ON pk.id = m.paquete_id
JOIN       {ESQUEMA}.raiz         r   ON r.id  = a.raiz_id
JOIN       {ESQUEMA}.destinatario d   ON d.id  = a.destinatario_id
JOIN       {ESQUEMA}.periodo      p   ON p.id  = a.periodo_id
JOIN       {ESQUEMA}.cliente      c   ON c.id  = a.cliente_id
JOIN       {ESQUEMA}.extension    ex  ON ex.id = a.extension_id
"""

SELECT_DETALLE = f"""
SELECT
    r.nombre              AS raiz,
    d.codigo               AS destinatario,
    p.codigo                AS periodo,
    c.nombre                AS cliente,
    ({ESCUELA_EXPR})         AS escuela,
    ({PROGRAMA_EXPR})        AS programa,
    ({NIVEL_EXPR})           AS nivel,
    m.semestre               AS semestre,
    pk.nombre                 AS paquete,
    m.nombre                   AS materia,
    g.codigo                    AS granulo_codigo,
    g.nombre                     AS granulo,
    a.nombre                      AS archivo,
    a.nombre_original              AS nombre_original,
    upper(ex.tipo)                  AS extension,
    a.enlace                         AS enlace,
    a.fecha_registro                  AS fecha_registro
"""

ORDEN_DETALLE = {
    "escuela": "e.nombre", "programa": "pr.nombre", "semestre": "m.semestre",
    "materia": "m.nombre", "granulo": "g.codigo", "archivo": "a.nombre",
    "extension": "ex.tipo", "periodo": "p.codigo", "fecha_registro": "a.fecha_registro",
}


def sql_detalle(f: dict, orden_col: str, orden_dir: str, limite: int, desplazamiento: int) -> tuple[str, list]:
    where, params = where_archivo(f)
    columna = ORDEN_DETALLE.get(orden_col, "m.semestre, m.nombre, g.codigo")
    direccion = "DESC" if orden_dir == "desc" else "ASC"
    sql = f"""
    {SELECT_DETALLE}
    {FROM_DETALLE}
    WHERE {where}
    ORDER BY {columna} {direccion}
    LIMIT %s OFFSET %s
    """
    return sql, [*params, limite, desplazamiento]


def sql_detalle_total(f: dict) -> tuple[str, list]:
    where, params = where_archivo(f)
    sql = f"SELECT count(*) AS total {FROM_DETALLE} WHERE {where}"
    return sql, params


def sql_detalle_exportar(f: dict) -> tuple[str, list]:
    where, params = where_archivo(f)
    sql = f"""
    {SELECT_DETALLE}
    {FROM_DETALLE}
    WHERE {where}
    ORDER BY e.nombre, pr.nombre, m.semestre, m.nombre, g.codigo
    """
    return sql, params
