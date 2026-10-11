"""Descarga masiva SAT (MOCK). Reemplazar `descargar_cfdis` por una integración real
(p. ej. librería `cfdiclient`) usando FIEL (.cer/.key en Storage) + password descifrado."""
import logging
from datetime import date

from .crypto import decrypt
from .db import get_admin_client

log = logging.getLogger("sat")


def descargar_cfdis(empresa_id: str, desde: date, hasta: date) -> int:
    db = get_admin_client()
    cfg = (
        db.table("empresa_configuracion")
        .select("rfc, cer_path, key_path, password_sat")
        .eq("id", empresa_id)
        .single()
        .execute()
        .data
    )
    if not (cfg.get("cer_path") and cfg.get("key_path") and cfg.get("password_sat")):
        log.error("Empresa %s sin FIEL completa; sincronización abortada", empresa_id)
        return 0

    cer = db.storage.from_("fiel").download(cfg["cer_path"])
    key = db.storage.from_("fiel").download(cfg["key_path"])
    _password = decrypt(cfg["password_sat"])  # no registrar en logs

    # TODO (real): autenticar con el WS del SAT, solicitar -> verificar -> descargar paquetes ZIP,
    # y por cada XML llamar a parse_cfdi + guardar_viaje.
    log.info("[MOCK] SAT sync empresa=%s rfc=%s %s..%s (cer=%dB key=%dB)",
             empresa_id, cfg["rfc"], desde, hasta, len(cer), len(key))
    return 0
