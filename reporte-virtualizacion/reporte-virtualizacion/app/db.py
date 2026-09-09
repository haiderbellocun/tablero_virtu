"""Pool de conexiones a PostgreSQL.

Mismo patron que el reporte de costos: pool perezoso con chequeo de conexion
viva, porque en Cloud Run el contenedor se congela entre peticiones.
"""

from __future__ import annotations

import logging
import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

log = logging.getLogger("reporte.db")

_pool: ConnectionPool | None = None


def _conninfo() -> str:
    host = os.environ.get("PGHOST", "127.0.0.1")
    port = os.environ.get("PGPORT", "5432")
    dbname = os.environ.get("PGDATABASE", "planner_db")
    user = os.environ.get("PGUSER", "planner_user")
    password = os.environ.get("PGPASSWORD", "")
    sslmode = os.environ.get("PGSSLMODE", "prefer")
    return (
        f"host={host} port={port} dbname={dbname} user={user} "
        f"password={password} sslmode={sslmode} connect_timeout=10"
    )


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        log.info("Abriendo pool hacia %s:%s", os.environ.get("PGHOST"), os.environ.get("PGPORT"))
        _pool = ConnectionPool(
            conninfo=_conninfo(),
            min_size=0,
            max_size=int(os.environ.get("PG_POOL_MAX", "4")),
            max_idle=60,
            timeout=15,
            check=ConnectionPool.check_connection,
            open=True,
            kwargs={"row_factory": dict_row},
        )
    return _pool


def cerrar_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def consultar(sql: str, params: tuple | list | None = None) -> list[dict]:
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def consultar_uno(sql: str, params: tuple | list | None = None) -> dict | None:
    filas = consultar(sql, params)
    return filas[0] if filas else None


def exportar_csv(sql: str, params: tuple | list | None, columnas: list[str]):
    """Generador que hace streaming de un SELECT como filas CSV, usando un
    cursor con nombre (server-side) para no cargar todo en memoria."""
    import csv
    import io

    with get_pool().connection() as conn:
        with conn.cursor(name="export_csv") as cur:
            cur.itersize = 1000
            cur.execute(sql, params)

            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";")
            w.writerow(columnas)
            yield buf.getvalue()

            for fila in cur:
                buf = io.StringIO()
                w = csv.writer(buf, delimiter=";")
                w.writerow([fila.get(c, "") for c in columnas])
                yield buf.getvalue()
