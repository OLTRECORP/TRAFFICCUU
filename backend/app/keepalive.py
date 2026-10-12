"""Mantiene despierto el servidor mientras corre una descarga. El plan gratuito de Render se duerme tras ~15 min
sin tráfico entrante y mata las tareas en segundo plano; antes solo el navegador abierto lo evitaba. Mientras hay una
corrida, el propio servidor consulta su /health por la URL pública (Render la da en RENDER_EXTERNAL_URL)."""
import logging
import os
import threading
import urllib.request
from contextlib import contextmanager

log = logging.getLogger("keepalive")

INTERVALO = 240  # segundos; bastante menos que los ~15 min de inactividad de Render


def _ping(url: str) -> None:
    try:
        urllib.request.urlopen(url, timeout=15).read(64)
    except Exception as exc:   # un ping fallido no debe tumbar la descarga
        log.warning("Ping de keep-alive a %s falló: %s", url, exc)


@contextmanager
def mantener_despierto(intervalo: float = INTERVALO, url: str | None = None):
    base = (url or os.environ.get("RENDER_EXTERNAL_URL") or "").rstrip("/")
    if not base:   # en local o fuera de Render no hace falta
        yield False
        return
    parar = threading.Event()

    def bucle() -> None:
        while not parar.wait(intervalo):
            _ping(f"{base}/health")

    hilo = threading.Thread(target=bucle, name="keepalive", daemon=True)
    hilo.start()
    try:
        yield True
    finally:
        parar.set()
