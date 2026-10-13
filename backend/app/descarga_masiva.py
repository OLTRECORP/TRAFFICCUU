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
import io
import zipfile
import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status

from .auth import Tenant
from .bitacora import Bitacora
from .carta_porte_service import registrar as registrar_carta_porte
from .cfdi_parser import CFDIError, pagos_cfdi, resumen_cfdi
from .config import get_settings
from .db import get_admin_client
from .keepalive import mantener_despierto
from .rutas_service import LugaresCatalogo, calcular_km_viajes
from .sat import Cancelado, SatError, descargar_emitidos_rango

log = logging.getLogger("descarga_masiva")

LOTE = 200
PAGINA = 1000
MAX_SIN_ASIGNAR = 200       # XML sin factura que se conservan en la corrida para revisarlos
# Una corrida activa escribe su bitácora cada pocos segundos; si lleva más de esto sin actualizarse, el servidor
# que la ejecutaba se reinició o se durmió (p. ej. plan gratuito de Render) y se considera interrumpida.
ACTIVA_MAX = timedelta(minutes=5)
MAX_ZIP_ENTRADAS = 3000
MAX_ZIP_DESCOMPRIMIDO = 300 * 1024 * 1024


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

    if modo == "reprocesar":
        meses = []
    elif modo == "faltantes":
        meses = meses_pendientes(empresa_id, anio)
        if not meses:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"No hay facturas de {anio} sin XML por descargar")
    else:
        meses = list(range(1, (hoy.month if anio == hoy.year else 12) + 1))

    fila = {"empresa_id": empresa_id, "modo": modo, "anio": anio, "meses": meses}
    return db.table("sat_descargas").insert(fila).execute().data[0]


def cancelar(empresa_id: str) -> dict:
    """Detiene las descargas activas de la empresa. Si el proceso sigue vivo se le avisa y termina en unos
    segundos; si está interrumpido (sin latido) se marca como cancelado de inmediato."""
    db = get_admin_client()
    activas = (
        db.table("sat_descargas").select("id, updated_at").eq("empresa_id", empresa_id)
        .in_("estado", ["pendiente", "en_proceso"]).execute().data
    )
    res = {"detenidas": 0, "solicitadas": 0}
    for r in activas:
        if _ahora() - _parse_ts(r["updated_at"]) >= ACTIVA_MAX:
            db.table("sat_descargas").update({
                "estado": "cancelado", "cancelar": True,
                "error": "Interrumpida: el servidor dejó de responder. Lo ya asignado se conservó.",
            }).eq("id", r["id"]).execute()
            res["detenidas"] += 1
        else:
            db.table("sat_descargas").update({"cancelar": True}).eq("id", r["id"]).execute()
            res["solicitadas"] += 1
    return res


def iniciar_zip(empresa_id: str, nombre: str) -> dict:
    """Crea la corrida para un .zip de XML subido por el usuario."""
    db = get_admin_client()
    activas = (
        db.table("sat_descargas").select("id, updated_at").eq("empresa_id", empresa_id)
        .in_("estado", ["pendiente", "en_proceso"]).execute().data
    )
    if any(_ahora() - _parse_ts(r["updated_at"]) < ACTIVA_MAX for r in activas):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay un proceso en curso; espera a que termine o detenlo")
    fila = {"empresa_id": empresa_id, "modo": "zip", "anio": date.today().year, "meses": []}
    return db.table("sat_descargas").insert(fila).execute().data[0]


def _xmls_del_zip(contenido: bytes, avisar, parar, acu: dict):
    """Genera los XML válidos de un .zip y registra en la bitácora cada archivo aceptado o rechazado."""
    try:
        z = zipfile.ZipFile(io.BytesIO(contenido))
    except zipfile.BadZipFile:
        raise SatError("El archivo no es un .zip válido")
    with z:
        entradas = [i for i in z.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
        if len(entradas) > MAX_ZIP_ENTRADAS:
            raise SatError(f"El .zip trae {len(entradas)} archivos; el máximo es {MAX_ZIP_ENTRADAS}")
        if sum(i.file_size for i in entradas) > MAX_ZIP_DESCOMPRIMIDO:
            raise SatError("El contenido del .zip es demasiado grande")
        avisar(f"El .zip trae {len(entradas)} archivo(s)")
        limite = get_settings().max_xml_bytes
        for i in entradas:
            if parar():
                raise Cancelado()
            nombre = i.filename.rsplit("/", 1)[-1]
            if not nombre.lower().endswith(".xml"):
                acu["zip_rechazados"] += 1
                avisar(f"{i.filename}: rechazado (no es .xml)", "aviso")
                continue
            if i.file_size > limite:
                acu["zip_rechazados"] += 1
                avisar(f"{i.filename}: rechazado (pesa más de {limite // 1024} KB)", "aviso")
                continue
            data = z.read(i)
            try:
                r = resumen_cfdi(data)
            except CFDIError as exc:
                acu["zip_rechazados"] += 1
                avisar(f"{i.filename}: rechazado ({exc})", "aviso")
                continue
            acu["zip_aceptados"] += 1
            avisar(f"{i.filename}: CFDI {r['uuid'][:8]}… tipo {r.get('tipo_comprobante')} aceptado")
            yield data


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


LOTE_GUARDADO = 20   # XML asignados que se guardan juntos mientras se recorre un mes


def _lote(tabla, filas: list[dict], conflicto: str) -> None:
    for i in range(0, len(filas), LOTE):
        tabla.upsert(filas[i:i + LOTE], on_conflict=conflicto).execute()


def procesar_xmls(db, empresa_id: str, indice: _Indice, xmls, id_solicitud: str | None, acumulado: dict, ctx: dict | None = None) -> None:
    """Asigna cada XML (factura o complemento de pago) y guarda. `acumulado` lleva los contadores.
    `ctx` (opcional): {"log": callable(mensaje, nivel), "cp": (Tenant, LugaresCatalogo)} para la bitácora y
    para registrar la Carta Porte de cada factura."""
    ahora = _ahora().isoformat()
    sat_rows: list[dict] = []
    try:
        _recorrer(db, empresa_id, indice, xmls, id_solicitud, acumulado, sat_rows, ahora, ctx or {})
    finally:   # si el SAT falla a medio paquete, lo ya asignado se conserva
        _lote(db.table("facturas_sat"), sat_rows, "factura_id")


def _recorrer(db, empresa_id, indice, xmls, id_solicitud, acumulado, sat_rows, ahora, ctx) -> None:
    avisar = ctx.get("log") or (lambda m, n="info": None)
    for xml in xmls:
        if ctx.get("parar") and ctx["parar"]():
            raise Cancelado()
        acumulado["xml_recibidos"] += 1
        try:
            r = resumen_cfdi(xml)
        except CFDIError as exc:
            acumulado["ignorados"] += 1
            avisar(f"XML descartado (no es un CFDI válido): {exc}", "aviso")
            continue
        tipo = r.get("tipo_comprobante")
        if tipo == "P":
            try:
                _guardar_complemento(db, empresa_id, indice, r, pagos_cfdi(xml), xml, acumulado)
                avisar(f"Complemento de pago {r.get('serie') or ''}{r.get('folio') or ''} ({r['uuid'][:8]}…) guardado y ligado a sus facturas", "ok")
            except CFDIError:
                acumulado["ignorados"] += 1
                avisar(f"Complemento de pago {r['uuid'][:8]}… ilegible, se omitió", "aviso")
            continue
        if tipo != "I":              # egresos y traslados no son facturas del Excel
            acumulado["ignorados"] += 1
            avisar(f"CFDI {r['uuid'][:8]}… tipo {tipo} omitido (no es factura de ingreso ni complemento de pago)")
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
            avisar(f"Sin factura para el XML {r['uuid'][:8]}… folio {r.get('serie') or ''}{r.get('folio') or ''} total {r.get('total')}: {motivo}", "aviso")
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
        avisar(f"XML {r['uuid'][:8]}… asignado a la factura {factura['folio']}", "ok")
        if len(sat_rows) >= LOTE_GUARDADO:   # guardar sobre la marcha: si el servidor muere a media descarga no se pierde el avance
            _lote(db.table("facturas_sat"), sat_rows, "factura_id")
            sat_rows.clear()
        if ctx.get("cp"):
            _carta_porte(db, ctx["cp"], xml, factura, acumulado, avisar)


def _carta_porte(db, cp, xml: bytes, factura: dict, acumulado: dict, avisar) -> None:
    tenant, catalogo = cp
    resultado, detalle = registrar_carta_porte(db, tenant, xml, factura["id"], catalogo)
    if resultado == "creado":
        acumulado["viajes"] += 1
        avisar(f"Carta Porte → {detalle}", "ok")
    elif resultado == "existente":
        acumulado["viajes_existentes"] += 1
    elif resultado == "sin_carta_porte":
        acumulado["sin_carta_porte"] += 1
        avisar(f"Factura {factura['folio']}: {detalle}")
    else:
        acumulado["viajes_error"] += 1
        avisar(f"Factura {factura['folio']}: no se registró el viaje: {detalle}", "error")


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


SOLICITUD_VIGENTE = timedelta(hours=72)   # el SAT conserva una solicitud terminada unos días


def _solicitud_previa(db, empresa_id: str, anio: int, mes: int) -> str | None:
    """Id de una solicitud al SAT de ese mes que se envió en una corrida anterior y no terminó (se detuvo, se
    interrumpió o el SAT aún la procesaba), para retomarla en lugar de pedir otra."""
    filas = (db.table("sat_descargas").select("detalle, created_at").eq("empresa_id", empresa_id).eq("anio", anio)
             .order("created_at", desc=True).limit(10).execute().data)
    for f in filas:
        if _ahora() - _parse_ts(f["created_at"]) > SOLICITUD_VIGENTE:
            break
        for e in f.get("detalle") or []:
            if e.get("mes") == mes and e.get("solicitud") and e.get("estado") != "ok":
                return e["solicitud"]
    return None


def _meses_guardados(db, empresa_id: str, anio: int, job_id: str) -> set[int]:
    """Meses que una corrida anterior de ese año guardó completos (descargados, asignados y con su Carta Porte) y que
    no terminó: al reanudar no se vuelven a pedir al SAT. Solo cuenta lo reciente (72 h)."""
    filas = (db.table("sat_descargas").select("id, estado, detalle, created_at").eq("empresa_id", empresa_id).eq("anio", anio)
             .order("created_at", desc=True).limit(10).execute().data)
    hechos: set[int] = set()
    for f in filas:
        if f.get("id") == job_id or f.get("estado") == "ok":   # una corrida terminada no se reanuda: se vuelve a pedir lo nuevo
            continue
        if _ahora() - _parse_ts(f["created_at"]) > SOLICITUD_VIGENTE:
            break
        for e in f.get("detalle") or []:
            if e.get("estado") == "ok" and e.get("guardado") and e.get("mes"):
                hechos.add(e["mes"])
    return hechos


def _xmls_mes(empresa_id: str, ini, fin, avisar, parar, previa: str | None, guardar_solicitud):
    """XML de un mes. Si la solicitud anterior ya no sirve (el SAT la rechaza o venció), pide una nueva."""
    if previa:
        entregados = False
        try:
            for xml in descargar_emitidos_rango(empresa_id, ini, fin, log=avisar, parar=parar, id_existente=previa):
                entregados = True
                yield xml
            return
        except Cancelado:
            raise
        except SatError as exc:
            if entregados:
                raise
            avisar(f"La solicitud anterior ya no sirve ({exc}); se pide una nueva", "aviso")
    yield from descargar_emitidos_rango(empresa_id, ini, fin, on_solicitud=guardar_solicitud, log=avisar, parar=parar)


def _rango_mes(anio: int, mes: int) -> tuple[datetime, datetime]:
    ini = datetime(anio, mes, 1, 0, 0, 0)
    fin = datetime(anio, mes, calendar.monthrange(anio, mes)[1], 23, 59, 59)
    return ini, min(fin, datetime.now() - timedelta(minutes=1))


def _contadores() -> dict:
    return {"xml_recibidos": 0, "ignorados": 0, "facturas_asignadas": 0, "complementos": 0, "uuid_recuperados": 0,
            "sin_asignar": [], "sin_asignar_total": 0, "viajes": 0, "viajes_existentes": 0, "sin_carta_porte": 0,
            "viajes_error": 0, "zip_aceptados": 0, "zip_rechazados": 0}


def _reprocesar(db, empresa_id: str, ctx: dict, acu: dict) -> None:
    """Registra la Carta Porte de los XML que ya están guardados en `facturas_sat` (p. ej. los bajados uno por uno)."""
    avisar, parar = ctx["log"], ctx["parar"]
    filas = _leer_todo(lambda a, b: db.table("facturas_sat").select("factura_id").eq("empresa_id", empresa_id)
                       .eq("estado", "ok").not_.is_("xml", "null").order("factura_id").range(a, b))
    # Solo las que todavía no tienen viaje: un reproceso o una descarga nueva no repasa lo que ya está registrado.
    con_viaje = {v["factura_id"] for v in _leer_todo(lambda a, b: db.table("viajes").select("factura_id").eq("empresa_id", empresa_id)
                                                      .not_.is_("factura_id", "null").order("id").range(a, b))}
    total = len(filas)
    filas = [f for f in filas if f["factura_id"] not in con_viaje]
    avisar(f"{total} factura(s) con XML guardado, {len(filas)} sin viaje; registrando su Carta Porte…")
    folios = {f["id"]: f["folio"] for f in _leer_todo(lambda a, b: db.table("facturas").select("id, folio")
                                                       .eq("empresa_id", empresa_id).order("id").range(a, b))}
    antes = {k: acu[k] for k in ("viajes", "viajes_existentes", "sin_carta_porte", "viajes_error")}
    for fila in filas:
        if parar():
            raise Cancelado()
        xml = db.table("facturas_sat").select("xml").eq("factura_id", fila["factura_id"]).limit(1).execute().data[0]["xml"]
        acu["xml_recibidos"] += 1
        _carta_porte(db, ctx["cp"], xml.encode(), {"id": fila["factura_id"], "folio": folios.get(fila["factura_id"], "?")}, acu, avisar)
    d = {k: acu[k] - antes[k] for k in antes}
    avisar(f"Resultado de la Carta Porte: {d['viajes']} viajes creados, {d['sin_carta_porte']} facturas cuyo XML no trae Carta Porte, "
           f"{d['viajes_error']} con error" + (" (el motivo está en las líneas rojas de arriba)" if d["viajes_error"] else ""),
           "error" if d["viajes_error"] else "ok")


def ejecutar(empresa_id: str, job_id: str, anio: int, meses: list[int], zip_bytes: bytes | None = None) -> None:
    """Tarea de fondo: toda excepción termina con la corrida en un estado final (ok, error o cancelado) y un mensaje."""
    try:
        with mantener_despierto():
            _ejecutar(empresa_id, job_id, anio, meses, zip_bytes)
    except Exception as exc:
        log.exception("Descarga masiva %s falló", job_id)
        marcar_error(job_id, f"Error inesperado: {type(exc).__name__}: {str(exc)[:200]}")


def _ejecutar(empresa_id: str, job_id: str, anio: int, meses: list[int], zip_bytes: bytes | None = None) -> None:
    """Un mes a la vez (o los XML de un .zip, o el reproceso de Carta Porte). Un mes que falla no detiene a los
    demás; el usuario puede detener la corrida; todo queda en la corrida y en su bitácora."""
    db = get_admin_client()
    bit = Bitacora(db, job_id)
    avisar = bit.add
    acu = _contadores()
    detalle: list[dict] = []
    primer_error = None
    cancelado = False

    def guardar(estado: str, error: str | None = None) -> None:
        bit.flush(**{
            "estado": estado, "detalle": detalle, "error": error,
            "xml_recibidos": acu["xml_recibidos"], "facturas_asignadas": acu["facturas_asignadas"],
            "complementos": acu["complementos"], "viajes": acu["viajes"], "sin_asignar": acu["sin_asignar"],
        })

    if zip_bytes is not None:
        avisar(f"Procesando .zip subido ({len(zip_bytes) // 1024} KB)")
    else:
        avisar(f"Descarga iniciada: {'reproceso de Carta Porte' if not meses else f'año {anio}, meses {meses}'}")
    guardar("en_proceso")
    try:
        rfc = db.table("empresa_configuracion").select("rfc").eq("id", empresa_id).single().execute().data["rfc"]
        facturas = _leer_todo(lambda a, b: (
            db.table("facturas").select("id, folio, uuid, total, estado, complemento").eq("empresa_id", empresa_id)
            .order("id").range(a, b)
        ))
        avisar(f"{len(facturas)} facturas cargadas para asignar los XML")
        indice = _Indice(facturas)
        ctx = {"log": avisar, "parar": bit.cancelado,
               "cp": (Tenant(user_id="", empresa_id=empresa_id, rfc=rfc), LugaresCatalogo(db, empresa_id))}
    except Exception as exc:
        avisar(f"No se pudo preparar la descarga: {type(exc).__name__}: {str(exc)[:200]}", "error")
        guardar("error", f"No se pudo preparar la descarga: {type(exc).__name__}")
        return

    ya_guardados: set[int] = set()
    if meses:
        try:
            ya_guardados = _meses_guardados(db, empresa_id, anio, job_id) & set(meses)
        except Exception as exc:   # no es crítico: sin esto simplemente se repiten esos meses
            log.warning("No se pudo leer los meses ya guardados: %s", exc)

    ok = True
    try:
        if zip_bytes is not None:
            procesar_xmls(db, empresa_id, indice, _xmls_del_zip(zip_bytes, avisar, bit.cancelado, acu), None, acu, ctx)
            avisar(f".zip: {acu['zip_aceptados']} XML aceptados, {acu['zip_rechazados']} rechazados", "ok" if acu["zip_aceptados"] else "error")
            ok = acu["zip_aceptados"] > 0
            if not ok:
                primer_error = "Ningún archivo del .zip es un CFDI válido"
        elif not meses:
            _reprocesar(db, empresa_id, ctx, acu)
        else:
            for mes in meses:
                if bit.cancelado():
                    raise Cancelado()
                antes = acu["xml_recibidos"]
                entrada = {"mes": mes, "estado": "en_proceso", "xml": 0, "mensaje": None, "solicitud": None, "guardado": False}
                detalle.append(entrada)
                if mes in ya_guardados:
                    entrada.update(estado="ok", guardado=True, mensaje="Ya guardado en la corrida anterior")
                    avisar(f"— Mes {mes:02d}/{anio} — ya se había guardado completo en la corrida anterior; se omite", "ok")
                    guardar("en_proceso")
                    continue
                avisar(f"— Mes {mes:02d}/{anio} —")

                def guardar_solicitud(id_solicitud: str, entrada=entrada) -> None:
                    # Se anota completa para poder retomarla si el servidor se duerme o el usuario detiene la corrida.
                    entrada["solicitud"] = id_solicitud
                    guardar("en_proceso")

                try:
                    ini, fin = _rango_mes(anio, mes)
                    previa = _solicitud_previa(db, empresa_id, anio, mes)
                    if previa:
                        entrada["solicitud"] = previa
                    procesar_xmls(db, empresa_id, indice,
                                  _xmls_mes(empresa_id, ini, fin, avisar, bit.cancelado, previa, guardar_solicitud), None, acu, ctx)
                    entrada.update(estado="ok", guardado=True)   # punto de control: el mes quedó descargado, asignado y guardado
                    avisar(f"Mes {mes:02d} guardado: {acu['xml_recibidos'] - antes} XML recibidos, "
                           f"{acu['facturas_asignadas']} facturas asignadas en total", "ok")
                except (SatError, Cancelado) as exc:
                    if isinstance(exc, Cancelado):
                        entrada.update(estado="error", mensaje="Detenido por el usuario")
                        raise
                    entrada.update(estado="error", mensaje=str(exc)[:300])
                    primer_error = primer_error or str(exc)[:500]
                    avisar(f"Mes {mes:02d}: {exc}", "error")
                except Exception as exc:
                    log.exception("Descarga masiva %s mes %s: fallo inesperado", job_id, mes)
                    entrada.update(estado="error", mensaje=f"Error inesperado: {type(exc).__name__}: {str(exc)[:150]}")
                    primer_error = primer_error or entrada["mensaje"]
                    avisar(f"Mes {mes:02d}: {entrada['mensaje']}", "error")
                entrada["xml"] = acu["xml_recibidos"] - antes
                guardar("en_proceso")
            ok = not all(e["estado"] == "error" for e in detalle)
            # Los XML que ya estaban guardados de corridas anteriores (o bajados uno por uno) y aún no tienen viaje
            # no se vuelven a descargar, así que su Carta Porte se registra aquí para que el dashboard los cuente.
            try:
                _reprocesar(db, empresa_id, ctx, acu)
            except Cancelado:
                raise
            except Exception as exc:
                log.exception("Descarga masiva %s: no se pudo registrar la Carta Porte pendiente", job_id)
                avisar(f"No se pudo registrar la Carta Porte de los XML guardados: {type(exc).__name__}: {str(exc)[:150]}", "error")
    except Cancelado:
        cancelado = True
        avisar("Proceso detenido por el usuario. Lo ya asignado se conservó; puedes volver a iniciarlo y continuará con lo que falte.", "aviso")
    except SatError as exc:
        ok = False
        primer_error = str(exc)[:500]
        avisar(str(exc), "error")
    except Exception as exc:
        log.exception("Proceso %s interrumpido", job_id)
        ok = False
        primer_error = f"Proceso interrumpido: {type(exc).__name__}"
        avisar(f"Proceso interrumpido: {type(exc).__name__}: {str(exc)[:200]}", "error")

    if acu["viajes"] and not cancelado:
        try:
            avisar("Ubicando orígenes/destinos en el mapa y calculando km operativos…")
            r = calcular_km_viajes(empresa_id, avisar)
            avisar(f"Km operativos: {r['calculados']} viajes calculados, {r['sin_mapa']} sin ubicación en el mapa, {r['pendientes']} pendientes", "ok")
        except Exception as exc:
            avisar(f"No se pudieron calcular los km por mapa: {type(exc).__name__}: {str(exc)[:200]}", "aviso")

    avisar(f"{'Detenido' if cancelado else 'Terminado'}: {acu['xml_recibidos']} XML, {acu['facturas_asignadas']} facturas asignadas, "
           f"{acu['complementos']} complementos, {acu['viajes']} viajes nuevos desde Carta Porte, {acu['sin_asignar_total']} XML sin factura, "
           f"{acu['viajes_error']} viajes con error", "aviso" if cancelado else ("ok" if ok else "error"))
    if cancelado:
        guardar("cancelado", "Detenido por el usuario")
    else:
        guardar("ok" if ok else "error", None if ok else primer_error)


def marcar_error(job_id: str, mensaje: str) -> None:
    """Último recurso si `ejecutar` revienta antes de poder registrar el estado."""
    get_admin_client().table("sat_descargas").update({"estado": "error", "error": mensaje[:500]}).eq("id", job_id).execute()
