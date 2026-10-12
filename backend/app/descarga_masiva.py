"""Descarga masiva de XML de facturas emitidas desde el SAT.

Pide al SAT los CFDI emitidos mes por mes (todo el año, o solo los meses con facturas sin XML),
asigna cada XML a una factura y guarda el XML en `facturas_sat`. Los complementos de pago (tipo P)
se guardan en `complementos_pago` ligados por UUID a las facturas que cubren (y, por ellas, a las
órdenes de compra). El avance de cada corrida queda en `sat_descargas`.

Reglas de asignación (en este orden):
  1. UUID del XML == UUID de la factura.
  2. Si ninguna factura tiene ese UUID: facturas SIN UUID (el Excel lo trae dañado o vacío) cuyo folio
     coincide con Serie+Folio o Folio del XML y cuyo total coincide (±1 centavo). Debe haber exactamente
     una candidata; si hay varias o ninguna el XML queda en `sin_asignar` para revisión manual.
     La factura asignada así recupera su UUID."""
import calendar
import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status

from .cfdi_parser import CFDIError, pagos_cfdi, resumen_cfdi
from .db import get_admin_client
from .sat import SatError, descargar_emitidos_rango

log = logging.getLogger("descarga_masiva")

LOTE = 200
PAGINA = 1000
MAX_SIN_ASIGNAR = 200       # XML sin factura que se conservan en la corrida para revisarlos
ACTIVA_MAX = timedelta(hours=2)   # una corrida "en proceso" más vieja se considera abandonada


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _dec(value) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def normalizar_folio(folio: str | None) -> str:
    """'A-00123' / 'a 123' / '0123' -> 'a123' / '123' (solo alfanumérico, sin ceros a la izquierda)."""
    t = re.sub(r"[^0-9a-z]", "", (folio or "").lower())
    m = re.fullmatch(r"([a-z]*)(\d+)", t)
    return m[1] + (m[2].lstrip("0") or "0") if m else t


def _claves_folio(serie: str | None, folio: str | None) -> set[str]:
    claves = {normalizar_folio(folio), normalizar_folio(f"{serie or ''}{folio or ''}")}
    claves.discard("")
    return claves


def _leer_todo(construir) -> list[dict]:
    """Pagina una consulta de Supabase (límite de 1000 filas por llamada). `construir(a, b)` arma la consulta."""
    filas: list[dict] = []
    a = 0
    while True:
        lote = construir(a, a + PAGINA - 1).execute().data or []
        filas.extend(lote)
        if len(lote) < PAGINA:
            return filas
        a += PAGINA


def meses_pendientes(empresa_id: str, anio: int) -> list[int]:
    """Meses del año con facturas vigentes (por fecha de emisión) que aún no tienen XML del SAT."""
    db = get_admin_client()
    facturas = _leer_todo(lambda a, b: (
        db.table("facturas").select("id, fecha_emision, estado").eq("empresa_id", empresa_id)
        .gte("fecha_emision", f"{anio}-01-01").lte("fecha_emision", f"{anio}-12-31").order("id").range(a, b)
    ))
    con_xml = {r["factura_id"] for r in _leer_todo(lambda a, b: (
        db.table("facturas_sat").select("factura_id").eq("empresa_id", empresa_id)
        .eq("estado", "ok").not_.is_("xml", "null").order("factura_id").range(a, b)
    ))}
    meses = {
        int(f["fecha_emision"][5:7]) for f in facturas
        if f.get("estado") != "cancelado" and f.get("fecha_emision") and f["id"] not in con_xml
    }
    return sorted(meses)


def iniciar(empresa_id: str, anio: int, modo: str) -> dict:
    """Valida, calcula los meses a pedir y crea la corrida (estado 'pendiente'). Devuelve la fila."""
    hoy = date.today()
    if anio > hoy.year or anio < 2014:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Año fuera de rango")
    db = get_admin_client()

    activas = (
        db.table("sat_descargas").select("id, updated_at").eq("empresa_id", empresa_id)
        .in_("estado", ["pendiente", "en_proceso"]).execute().data
    )
    if any(_ahora() - _parse_ts(r["updated_at"]) < ACTIVA_MAX for r in activas):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay una descarga masiva en curso; espera a que termine")

    if modo == "faltantes":
        meses = meses_pendientes(empresa_id, anio)
        if not meses:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"No hay facturas de {anio} sin XML por descargar")
    else:
        meses = list(range(1, (hoy.month if anio == hoy.year else 12) + 1))

    fila = {"empresa_id": empresa_id, "modo": modo, "anio": anio, "meses": meses}
    return db.table("sat_descargas").insert(fila).execute().data[0]


class _Indice:
    """Facturas de la empresa indexadas para asignar XML sin consultar la base por cada uno."""

    def __init__(self, facturas: list[dict]):
        self.por_uuid = {str(f["uuid"]).lower(): f for f in facturas if f.get("uuid")}
        self.sin_uuid_por_folio: dict[str, list[dict]] = {}
        for f in facturas:
            if not f.get("uuid") and f.get("estado") != "cancelado":
                self.sin_uuid_por_folio.setdefault(normalizar_folio(f["folio"]), []).append(f)
        self.usadas: set[str] = set()

    def buscar(self, r: dict) -> tuple[dict | None, str]:
        """(factura, motivo): motivo explica por qué no hubo asignación única."""
        f = self.por_uuid.get(r["uuid"].lower())
        if f:
            return f, ""
        total = _dec(r.get("total"))
        candidatas = {}
        for clave in _claves_folio(r.get("serie"), r.get("folio")):
            for c in self.sin_uuid_por_folio.get(clave, []):
                ct = _dec(c.get("total"))
                if total is not None and ct is not None and abs(ct - total) <= Decimal("0.01") and c["id"] not in self.usadas:
                    candidatas[c["id"]] = c
        if len(candidatas) == 1:
            return next(iter(candidatas.values())), ""
        return None, "varias facturas coinciden en folio y total" if candidatas else "ninguna factura coincide en UUID, folio y total"


def _lote(tabla, filas: list[dict], conflicto: str) -> None:
    for i in range(0, len(filas), LOTE):
        tabla.upsert(filas[i:i + LOTE], on_conflict=conflicto).execute()


def procesar_xmls(db, empresa_id: str, indice: _Indice, xmls, id_solicitud: str | None, acumulado: dict) -> None:
    """Asigna cada XML (factura o complemento de pago) y guarda. `acumulado` lleva los contadores."""
    ahora = _ahora().isoformat()
    sat_rows: list[dict] = []
    try:
        _recorrer(db, empresa_id, indice, xmls, id_solicitud, acumulado, sat_rows, ahora)
    finally:   # si el SAT falla a medio paquete, lo ya asignado se conserva
        _lote(db.table("facturas_sat"), sat_rows, "factura_id")


def _recorrer(db, empresa_id, indice, xmls, id_solicitud, acumulado, sat_rows, ahora) -> None:
    for xml in xmls:
        acumulado["xml_recibidos"] += 1
        try:
            r = resumen_cfdi(xml)
        except CFDIError as exc:
            acumulado["ignorados"] += 1
            log.warning("XML descartado: %s", exc)
            continue
        tipo = r.get("tipo_comprobante")
        if tipo == "P":
            try:
                _guardar_complemento(db, empresa_id, indice, r, pagos_cfdi(xml), xml, acumulado)
            except CFDIError:
                acumulado["ignorados"] += 1
            continue
        if tipo != "I":              # egresos y traslados no son facturas del Excel
            acumulado["ignorados"] += 1
            continue

        r_plano = {"uuid": r["uuid"], "serie": r.get("serie"), "folio": r.get("folio"), "total": r.get("total")}
        factura, motivo = indice.buscar(r_plano)
        if factura is None:
            if len(acumulado["sin_asignar"]) < MAX_SIN_ASIGNAR:
                acumulado["sin_asignar"].append({
                    "uuid": r["uuid"], "folio": " ".join(p for p in (r.get("serie"), r.get("folio")) if p),
                    "total": r.get("total"), "fecha": (r.get("fecha") or "")[:10], "motivo": motivo,
                })
            acumulado["sin_asignar_total"] += 1
            continue
        if not factura.get("uuid"):
            # Recupera el UUID dañado/vacío del Excel con el del XML (índice único por empresa+uuid).
            db.table("facturas").update({"uuid": r["uuid"].lower()}).eq("id", factura["id"]).execute()
            factura["uuid"] = r["uuid"].lower()
            indice.por_uuid[factura["uuid"]] = factura
            acumulado["uuid_recuperados"] += 1
        indice.usadas.add(factura["id"])
        sat_rows.append({
            "factura_id": factura["id"], "empresa_id": empresa_id, "uuid": r["uuid"].lower(), "estado": "ok",
            "error": None, "id_solicitud": id_solicitud, "datos": r, "xml": xml.decode("utf-8", errors="replace"),
            "actualizado_en": ahora,
        })
        acumulado["facturas_asignadas"] += 1


def _guardar_complemento(db, empresa_id: str, indice: _Indice, r: dict, pagos: list[dict], xml: bytes, acumulado: dict) -> None:
    fechas = [p["fecha_pago"] for p in pagos if p.get("fecha_pago")]
    montos = [m for m in (_dec(p.get("monto")) for p in pagos) if m is not None]
    fila = db.table("complementos_pago").upsert({
        "empresa_id": empresa_id, "uuid": r["uuid"].lower(), "serie": r.get("serie"), "folio": r.get("folio"),
        "fecha_emision": r.get("fecha"), "fecha_pago": min(fechas) if fechas else None,
        "monto": str(sum(montos)) if montos else None, "datos": {**r, "pagos": pagos},
        "xml": xml.decode("utf-8", errors="replace"),
    }, on_conflict="empresa_id,uuid").execute().data[0]

    docs: dict[str, dict] = {}
    for p in pagos:
        for d in p["documentos"]:
            uid = d["uuid_documento"].lower()
            if not re.fullmatch(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", uid):
                continue
            previo = docs.setdefault(uid, {"imp_pagado": Decimal(0), "parcialidad": None})
            previo["imp_pagado"] += _dec(d.get("imp_pagado")) or Decimal(0)
            previo["parcialidad"] = int(d["parcialidad"]) if str(d.get("parcialidad") or "").isdigit() else previo["parcialidad"]
    _lote(db.table("complemento_pago_documentos"), [
        {"empresa_id": empresa_id, "complemento_id": fila["id"], "uuid_documento": uid,
         "parcialidad": v["parcialidad"], "imp_pagado": str(v["imp_pagado"])}
        for uid, v in docs.items()
    ], "complemento_id,uuid_documento")
    acumulado["complementos"] += 1

    # Las facturas ya conocidas pasan a "complemento listo" (el dashboard las cuenta como pagadas).
    for uid in docs:
        f = indice.por_uuid.get(uid)
        if f and f.get("complemento") != "COMPLEMENTO LISTO":
            db.table("facturas").update({"complemento": "COMPLEMENTO LISTO"}).eq("id", f["id"]).execute()
            f["complemento"] = "COMPLEMENTO LISTO"


def _rango_mes(anio: int, mes: int) -> tuple[datetime, datetime]:
    ini = datetime(anio, mes, 1, 0, 0, 0)
    fin = datetime(anio, mes, calendar.monthrange(anio, mes)[1], 23, 59, 59)
    return ini, min(fin, datetime.now() - timedelta(minutes=1))


def ejecutar(empresa_id: str, job_id: str, anio: int, meses: list[int]) -> None:
    """Tarea de fondo: toda excepción termina con la corrida en estado 'error' y un mensaje legible."""
    try:
        _ejecutar(empresa_id, job_id, anio, meses)
    except Exception as exc:
        log.exception("Descarga masiva %s falló", job_id)
        marcar_error(job_id, f"Error inesperado: {type(exc).__name__}")


def _ejecutar(empresa_id: str, job_id: str, anio: int, meses: list[int]) -> None:
    """Un mes a la vez. Un mes que falla no detiene a los demás; todo queda en la corrida."""
    db = get_admin_client()
    tabla = db.table("sat_descargas")
    facturas = _leer_todo(lambda a, b: (
        db.table("facturas").select("id, folio, uuid, total, estado, complemento").eq("empresa_id", empresa_id)
        .order("id").range(a, b)
    ))
    indice = _Indice(facturas)
    acu = {"xml_recibidos": 0, "ignorados": 0, "facturas_asignadas": 0, "complementos": 0,
           "uuid_recuperados": 0, "sin_asignar": [], "sin_asignar_total": 0}
    detalle: list[dict] = []
    primer_error = None

    def guardar(estado: str, error: str | None = None) -> None:
        tabla.update({
            "estado": estado, "detalle": detalle, "error": error,
            "xml_recibidos": acu["xml_recibidos"], "facturas_asignadas": acu["facturas_asignadas"],
            "complementos": acu["complementos"], "sin_asignar": acu["sin_asignar"],
        }).eq("id", job_id).execute()

    guardar("en_proceso")
    for mes in meses:
        antes = acu["xml_recibidos"]
        entrada = {"mes": mes, "estado": "ok", "xml": 0, "mensaje": None}
        detalle.append(entrada)
        try:
            ini, fin = _rango_mes(anio, mes)
            procesar_xmls(db, empresa_id, indice, descargar_emitidos_rango(empresa_id, ini, fin), None, acu)
        except SatError as exc:
            entrada.update(estado="error", mensaje=str(exc)[:300])
            primer_error = primer_error or str(exc)[:500]
            log.warning("Descarga masiva %s mes %s: %s", job_id, mes, exc)
        except Exception as exc:
            log.exception("Descarga masiva %s mes %s: fallo inesperado", job_id, mes)
            entrada.update(estado="error", mensaje=f"Error inesperado: {type(exc).__name__}")
            primer_error = primer_error or entrada["mensaje"]
        entrada["xml"] = acu["xml_recibidos"] - antes
        guardar("en_proceso")

    todos_fallaron = all(e["estado"] == "error" for e in detalle)
    guardar("error" if todos_fallaron else "ok", primer_error if todos_fallaron else None)
    log.info("Descarga masiva %s terminada: %d XML, %d facturas, %d complementos",
             job_id, acu["xml_recibidos"], acu["facturas_asignadas"], acu["complementos"])


def marcar_error(job_id: str, mensaje: str) -> None:
    """Último recurso si `ejecutar` revienta antes de poder registrar el estado."""
    get_admin_client().table("sat_descargas").update({"estado": "error", "error": mensaje[:500]}).eq("id", job_id).execute()
