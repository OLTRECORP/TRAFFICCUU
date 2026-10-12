"""Registro en vivo de una corrida (`sat_descargas.bitacora`): cada paso del proceso con hora y nivel,
para que el portal muestre qué está haciendo el SAT y por qué falla. Se escribe a la base de forma
espaciada (cada pocos segundos) y siempre al registrar un aviso o un error."""
import logging
import time
from datetime import datetime, timezone

log = logging.getLogger("bitacora")

MAX_LINEAS = 400
INTERVALO = 2.0   # segundos mínimos entre escrituras de líneas informativas


class Bitacora:
    def __init__(self, db, job_id: str):
        self.db, self.job_id = db, job_id
        self.lineas: list[dict] = []
        self._ultimo = 0.0
        self._sucio = False
        self._cancel = False
        self._revisado = 0.0

    def cancelado(self) -> bool:
        """¿Pidió el usuario detener esta corrida? Consulta la base como máximo cada 3 segundos."""
        if self._cancel or time.monotonic() - self._revisado < 3:
            return self._cancel
        self._revisado = time.monotonic()
        try:
            fila = self.db.table("sat_descargas").select("cancelar").eq("id", self.job_id).limit(1).execute().data
            self._cancel = bool(fila and fila[0].get("cancelar"))
        except Exception:
            log.exception("No se pudo consultar si se pidió detener %s", self.job_id)
        return self._cancel

    def add(self, mensaje: str, nivel: str = "info") -> None:
        """nivel: info | ok | aviso | error"""
        getattr(log, "error" if nivel == "error" else "info")("[%s] %s", self.job_id, mensaje)
        self.lineas.append({"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "n": nivel, "m": mensaje[:500]})
        if len(self.lineas) > MAX_LINEAS:
            del self.lineas[1:len(self.lineas) - MAX_LINEAS + 1]   # conserva la primera línea
        self._sucio = True
        if nivel in ("aviso", "error") or time.monotonic() - self._ultimo >= INTERVALO:
            self.flush()

    def flush(self, **extra) -> None:
        """Escribe la bitácora (y campos extra de la corrida). Un fallo al escribir nunca detiene el proceso."""
        if not (self._sucio or extra):
            return
        try:
            self.db.table("sat_descargas").update({"bitacora": self.lineas, **extra}).eq("id", self.job_id).execute()
            self._sucio = False
        except Exception:
            log.exception("No se pudo escribir la bitácora de %s", self.job_id)
        self._ultimo = time.monotonic()
