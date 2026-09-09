"""Reporte de virtualizacion de contenidos — Direccion de Operaciones, CUN.

Cubre pregrados, especializaciones, diplomados y maestrias sobre
fabrica.archivo y las tablas relacionadas (ver queries.py para el mapeo
completo tomado del ERD). Pensado para Cloud Run: escucha en $PORT, no
guarda estado propio y expone /health.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app import db, queries  # noqa: E402  (necesita el .env cargado)

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("reporte")

ESTATICOS = Path(__file__).parent / "static"
CACHE_SEGUNDOS = int(os.environ.get("CACHE_SEGUNDOS", "180"))

_cache: dict[str, tuple[float, dict]] = {}


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    log.info("Reporte de virtualizacion listo · esquema %s", queries.ESQUEMA)
    yield
    db.cerrar_pool()


app = FastAPI(
    title="Reporte de virtualizacion · CUN",
    version="1.0.0",
    lifespan=ciclo_de_vida,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


def _serializable(valor):
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


def _limpiar(filas: list[dict]) -> list[dict]:
    return [{k: _serializable(v) for k, v in fila.items()} for fila in filas]


def _filtros(
    periodo: str | None, escuela: str | None, programa: str | None,
    nivel: str | None, semestre: int | None, extension: str | None, q: str | None,
) -> dict:
    return {
        "periodo": periodo or None, "escuela": escuela or None,
        "programa": programa or None, "nivel": nivel or None,
        "semestre": semestre, "extension": extension or None,
        "q": (q or "").strip() or None,
    }


@app.get("/health")
def health():
    try:
        db.consultar_uno("SELECT 1 AS ok")
        return {"estado": "ok", "esquema": queries.ESQUEMA}
    except Exception as e:  # noqa: BLE001
        log.exception("Health check fallido")
        return {"estado": "sin base de datos", "detalle": str(e)[:300]}


@app.get("/api/filtros")
def filtros_disponibles():
    try:
        resultado = {}
        for nombre, (sql, params) in queries.sql_opciones_filtros().items():
            resultado[nombre] = _limpiar(db.consultar(sql, params))
        resultado["niveles"] = queries.NIVELES
        return resultado
    except Exception as e:  # noqa: BLE001
        log.exception("Fallo cargando opciones de filtro")
        raise HTTPException(status_code=503, detail=f"No se pudieron cargar los filtros: {e}") from e


def _clave_cache(f: dict) -> str:
    return "|".join(f"{k}={f.get(k)}" for k in sorted(f))


@app.get("/api/reporte")
def reporte(
    refrescar: bool = False,
    periodo: str | None = None,
    escuela: str | None = None,
    programa: str | None = None,
    nivel: str | None = None,
    semestre: int | None = None,
    extension: str | None = None,
    q: str | None = Query(None, max_length=200),
):
    f = _filtros(periodo, escuela, programa, nivel, semestre, extension, q)
    clave = _clave_cache(f)
    ahora = time.time()
    if not refrescar and clave in _cache:
        guardado_en, payload = _cache[clave]
        if ahora - guardado_en < CACHE_SEGUNDOS:
            return payload

    advertencias: list[dict] = []

    def ejecutar(nombre: str, sql_params, uno: bool = False):
        try:
            sql, params = sql_params
            return db.consultar_uno(sql, params) if uno else db.consultar(sql, params)
        except Exception as e:  # noqa: BLE001
            log.exception("Panel %s fallo", nombre)
            advertencias.append({"panel": nombre, "error": str(e)[:300]})
            return None if uno else []

    kpis = ejecutar("kpis", queries.sql_kpis(f), uno=True)
    if kpis is None:
        raise HTTPException(
            status_code=503,
            detail="No se pudo calcular ni siquiera los indicadores base. "
            "Revisa la conexion o si el esquema/tablas existen.",
        )

    materias_totales = ejecutar("materias_totales", queries.sql_materias_totales(f), uno=True) or {}

    por_escuela = ejecutar("por_escuela", queries.sql_por_escuela(f))
    nivel_por_escuela = ejecutar("nivel_por_escuela", queries.sql_nivel_por_escuela(f))
    bubble_escuela = ejecutar("bubble_escuela", queries.sql_bubble_escuela(f))
    cobertura_contenido = ejecutar("cobertura_contenido", queries.sql_cobertura_por_escuela(f))
    cobertura_totales = ejecutar("cobertura_totales", queries.sql_materias_totales_por_escuela(f))
    por_extension = ejecutar("por_extension", queries.sql_por_extension(f))
    por_programa = ejecutar("por_programa", queries.sql_por_programa(f))
    por_semestre = ejecutar("por_semestre", queries.sql_por_semestre(f))

    totales_map = {r["escuela"]: r["materias_totales"] for r in cobertura_totales}
    cobertura_escuela = [
        {
            "escuela": r["escuela"],
            "materias_con_contenido": r["materias_con_contenido"],
            "materias_totales": totales_map.get(r["escuela"], r["materias_con_contenido"]),
        }
        for r in cobertura_contenido
    ]

    materias_con_contenido_total = kpis.get("materias") or 0
    materias_totales_total = materias_totales.get("materias") or materias_con_contenido_total
    cobertura_pct = (
        round(materias_con_contenido_total / materias_totales_total * 100, 1)
        if materias_totales_total else 0
    )

    payload = {
        "kpis": {**{k: _serializable(v) for k, v in kpis.items()},
                 "materias_totales": _serializable(materias_totales.get("materias")),
                 "programas_totales": _serializable(materias_totales.get("programas")),
                 "cobertura_pct": cobertura_pct},
        "por_escuela": _limpiar(por_escuela),
        "nivel_por_escuela": _limpiar(nivel_por_escuela),
        "bubble_escuela": _limpiar(bubble_escuela),
        "cobertura_escuela": _limpiar(cobertura_escuela),
        "por_extension": _limpiar(por_extension),
        "por_programa": _limpiar(por_programa),
        "por_semestre": _limpiar(por_semestre),
        "advertencias": advertencias,
        "filtros_aplicados": f,
    }
    _cache[clave] = (ahora, payload)
    return payload


@app.get("/api/detalle")
def detalle(
    pagina: int = Query(1, ge=1),
    tamano: int = Query(200, ge=1, le=1000),
    orden_col: str = "semestre",
    orden_dir: str = "asc",
    periodo: str | None = None,
    escuela: str | None = None,
    programa: str | None = None,
    nivel: str | None = None,
    semestre: int | None = None,
    extension: str | None = None,
    q: str | None = Query(None, max_length=200),
):
    f = _filtros(periodo, escuela, programa, nivel, semestre, extension, q)
    try:
        total = db.consultar_uno(*queries.sql_detalle_total(f))["total"]
        sql, params = queries.sql_detalle(f, orden_col, orden_dir, tamano, (pagina - 1) * tamano)
        filas = db.consultar(sql, params)
    except Exception as e:  # noqa: BLE001
        log.exception("Fallo la consulta de detalle")
        raise HTTPException(status_code=503, detail=f"No se pudo consultar el detalle: {e}") from e

    return {"total": total, "pagina": pagina, "tamano": tamano, "filas": _limpiar(filas)}


@app.get("/api/detalle/exportar.csv")
def exportar_csv(
    periodo: str | None = None,
    escuela: str | None = None,
    programa: str | None = None,
    nivel: str | None = None,
    semestre: int | None = None,
    extension: str | None = None,
    q: str | None = Query(None, max_length=200),
):
    f = _filtros(periodo, escuela, programa, nivel, semestre, extension, q)
    try:
        sql, params = queries.sql_detalle_exportar(f)
        flujo = db.exportar_csv(sql, params, queries.COLUMNAS_DETALLE)
    except Exception as e:  # noqa: BLE001
        log.exception("Fallo iniciando la exportacion")
        raise HTTPException(status_code=503, detail=f"No se pudo exportar: {e}") from e

    return StreamingResponse(
        flujo,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=virtualizacion_detalle.csv"},
    )


@app.get("/")
def inicio():
    return FileResponse(ESTATICOS / "index.html")


app.mount("/", StaticFiles(directory=ESTATICOS), name="static")
