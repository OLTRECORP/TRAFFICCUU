import logging
from typing import Literal
import uuid as uuidlib
from datetime import date

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from app.auth import CurrentUser, Tenant, current_tenant, current_user
from app.cfdi_parser import CFDIError, parse_cfdi, resumen_cfdi
from app.config import get_settings
from app.crypto import encrypt
from app.db import get_admin_client
from app.descarga_masiva import asegurar_factura_xml, cancelar as descarga_cancelar, ejecutar as descarga_ejecutar, iniciar as descarga_iniciar, iniciar_zip, rfc_cliente as descarga_rfc_cliente
from app.sat import diagnosticar as sat_diagnosticar
from app.mapas import MapaError, geocodificar
from app.rutas_service import asignar_viaje, calcular_km_viajes, calcular_ruta
from app.facturas_sat import ejecutar as sat_ejecutar, preparar as sat_preparar
from app.excel_import import ExcelError, guardar, parse_workbook
from app.sat import descargar_cfdis
from app.viajes_service import guardar_viaje
from app import depuracion, semanal
from app.nombres import clientes_parecidos
from app.remisiones_excel import RemisionesError, importar as remisiones_importar, parse_libro as remisiones_parse

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api")

app = FastAPI(title="ERP Logístico API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health")
def health() -> dict:
    """Usado para monitorear/despertar el cold-start de Render."""
    return {"status": "online"}


@app.post("/api/xml/procesar", status_code=status.HTTP_201_CREATED)
async def procesar_xml(file: UploadFile = File(...), tenant: Tenant = Depends(current_tenant)) -> dict:
    if not (file.filename or "").lower().endswith(".xml"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo debe ser .xml")

    limit = get_settings().max_xml_bytes
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "El XML excede el tamaño máximo permitido")

    db = get_admin_client()
    try:
        receptor = resumen_cfdi(content).get("receptor") or {}
        cliente_sem = semanal.cliente_semanal(db, tenant.empresa_id, receptor.get("rfc"), receptor.get("nombre"))
    except Exception:   # XML inválido (lo reporta parse_cfdi) o migración 022 aún sin aplicar
        cliente_sem = None
    if cliente_sem:
        # Factura semanal (p. ej. La Purísima): no es un viaje; agrupa los viajes de lunes a domingo de su semana.
        factura_id, factura_creada = asegurar_factura_xml(tenant, content)
        r = semanal.ligar_auto(db, tenant.empresa_id, cliente_sem)
        return {"factura_id": factura_id, "factura_creada": factura_creada, "factura_semanal": cliente_sem["nombre"],
                "ligadas": r["ligadas"], "warnings": [] if r["ligadas"] else [
                    "No hubo una semana con el mismo subtotal; lígala a mano en Clientes → semanas"]}

    try:
        cfdi = parse_cfdi(content)
    except CFDIError as exc:
        # Factura de ingreso emitida por la empresa sin Carta Porte (p. ej. la de un cliente que factura por semana o
        # por periodo): no es un viaje, pero sí una factura; se crea o se liga y sus viajes se ligan después.
        try:
            r = resumen_cfdi(content)
        except CFDIError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        if r.get("tipo_comprobante") != "I" or (r["emisor"]["rfc"] or "").upper() != tenant.rfc.upper():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        factura_id, factura_creada = asegurar_factura_xml(tenant, content)
        return {"factura_id": factura_id, "factura_creada": factura_creada, "uuid": r["uuid"], "folio": r.get("folio"),
                "sin_carta_porte": True, "ligadas": [],
                "warnings": ["El XML no trae Carta Porte: se guardó como factura. Liga sus viajes desde la factura (pestaña Viajes)."]}

    # Sin factura relacionada (el Excel no la trae aún) se crea con los datos del XML; el Excel posterior la actualiza.
    factura_id, factura_creada = asegurar_factura_xml(tenant, content) if tenant.rfc == cfdi.rfc_emisor else (None, False)
    viaje = guardar_viaje(tenant, cfdi, factura_id=factura_id)
    return {
        "viaje_id": viaje["id"],
        "factura_id": factura_id,
        "factura_creada": factura_creada,
        "uuid": cfdi.uuid,
        "folio": cfdi.folio,
        "distancia_xml": float(cfdi.distancia_xml),
        "distancia_operativa": float(cfdi.distancia_operativa),
        "carta_porte": cfdi.version_carta_porte,
        "warnings": cfdi.warnings,
    }


@app.post("/api/importar/excel")
async def importar_excel(file: UploadFile = File(...), tenant: Tenant = Depends(current_tenant)) -> dict:
    """Carga el Excel de administración de fletes: crea o actualiza facturas y órdenes sin duplicar."""
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo debe ser .xlsx")
    limit = get_settings().max_excel_bytes
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "El Excel excede el tamaño máximo permitido")
    try:
        parsed = parse_workbook(content)
    except ExcelError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    resultado = guardar(get_admin_client(), tenant.empresa_id, parsed)
    return {**resultado, "omitidas": parsed["omitidas"], "uuid_danados": parsed["uuid_danados"]}


@app.post("/api/remisiones/importar")
async def remisiones_importar_excel(file: UploadFile = File(...), cliente_id: str | None = Form(default=None),
                                    confirmar: bool = Form(default=False), tenant: Tenant = Depends(current_tenant)) -> dict:
    """Viajes por remisión (Excel con hojas PRECIOS y VIAJES). confirmar=false devuelve solo la vista previa."""
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo debe ser .xlsx")
    limit = get_settings().max_excel_bytes
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "El Excel excede el tamaño máximo permitido")
    if cliente_id:
        try:
            cliente_id = str(uuidlib.UUID(cliente_id))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "cliente_id inválido")
    db = get_admin_client()
    try:
        resultado = remisiones_importar(db, tenant.empresa_id, remisiones_parse(content), cliente_id or None, confirmar)
    except RemisionesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if confirmar:
        cliente = db.table("clientes").select("*").eq("id", resultado["cliente"]["id"]).single().execute().data
        resultado["facturas_ligadas"] = semanal.ligar_auto(db, tenant.empresa_id, cliente)["ligadas"] if cliente.get("factura_semanal") else []
    return resultado


def _cliente(tenant: Tenant, cliente_id: uuidlib.UUID) -> dict:
    c = get_admin_client().table("clientes").select("*").eq("empresa_id", tenant.empresa_id).eq("id", str(cliente_id)).limit(1).execute().data
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente no encontrado")
    return c[0]


@app.post("/api/clientes/{cliente_id}/semanas")
def clientes_semanas(cliente_id: uuidlib.UUID, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Semanas (lunes a domingo) del cliente con sus viajes, facturas ligadas y facturas del cliente para ligar."""
    db = get_admin_client()
    c = _cliente(tenant, cliente_id)
    semanas = semanal.semanas_del_cliente(db, tenant.empresa_id, c["id"])
    facturas = semanal.facturas_del_cliente(db, tenant.empresa_id, c)
    sugeridas = {s["semana"]: f["id"] for f, s in semanal.emparejar(semanas, facturas)}
    return {"semanas": [{**s, "sugerida": sugeridas.get(s["semana"])} for s in semanas], "facturas": facturas}


@app.post("/api/clientes/similares")
def clientes_similares(tenant: Tenant = Depends(current_tenant)) -> dict:
    """Pares de clientes con nombre parecido; propone conservar el que tiene más viajes."""
    db = get_admin_client()
    try:
        clientes = db.table("clientes_resumen").select("id, nombre, rfc, alias, viajes").eq("empresa_id", tenant.empresa_id).execute().data or []
    except Exception:
        raise HTTPException(status.HTTP_409_CONFLICT, "Falta ejecutar la migración 023 en Supabase (supabase/migrations/023_unificar_clientes.sql)")
    pares = []
    for a, b in clientes_parecidos(clientes):
        conservar, duplicado = (a, b) if (a["viajes"], len(a["nombre"])) >= (b["viajes"], len(b["nombre"])) else (b, a)
        pares.append({"conservar": conservar, "duplicado": duplicado})
    return {"pares": pares}


class UnificarClientesRequest(BaseModel):
    origen_id: uuidlib.UUID      # el duplicado, que desaparece
    destino_id: uuidlib.UUID     # el cliente que se conserva
    confirmar: bool = False


@app.post("/api/clientes/unificar-vista-previa")
def clientes_unificar_vista_previa(body: UnificarClientesRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    return depuracion.vista_previa_unificar_clientes(tenant.empresa_id, str(body.origen_id), str(body.destino_id))


@app.post("/api/clientes/unificar")
def clientes_unificar(body: UnificarClientesRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Une el cliente duplicado al que se conserva (viajes, tarifas, alias, RFC). Exige confirmar=true."""
    if not body.confirmar:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta la confirmación")
    return depuracion.unificar_clientes(tenant.empresa_id, tenant.user_id, str(body.origen_id), str(body.destino_id))


class LigarSemanaRequest(BaseModel):
    semana: date
    factura_id: uuidlib.UUID | None = None   # None = desligar


@app.post("/api/clientes/{cliente_id}/ligar-semana")
def clientes_ligar_semana(cliente_id: uuidlib.UUID, body: LigarSemanaRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    db = get_admin_client()
    c = _cliente(tenant, cliente_id)
    factura = None
    if body.factura_id:
        f = db.table("facturas").select("id, folio").eq("empresa_id", tenant.empresa_id).eq("id", str(body.factura_id)).limit(1).execute().data
        if not f:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Factura no encontrada")
        factura = f[0]
    try:
        n = semanal.ligar_semana(db, tenant.empresa_id, c["id"], body.semana.isoformat(), factura)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return {"viajes": n}


@app.post("/api/clientes/{cliente_id}/ligar-auto")
def clientes_ligar_auto(cliente_id: uuidlib.UUID, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Liga por monto las facturas del cliente a la semana cuyo subtotal coincide."""
    return semanal.ligar_auto(get_admin_client(), tenant.empresa_id, _cliente(tenant, cliente_id))


@app.post("/api/facturas/{factura_id}/viajes-disponibles")
def factura_viajes_disponibles(factura_id: uuidlib.UUID, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Viajes que se pueden ligar a la factura (varios viajes pueden compartir un mismo XML)."""
    db = get_admin_client()
    f = db.table("facturas").select("id, folio").eq("empresa_id", tenant.empresa_id).eq("id", str(factura_id)).limit(1).execute().data
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Factura no encontrada")
    sat = db.table("facturas_sat").select("receptor:datos->receptor").eq("factura_id", str(factura_id)).limit(1).execute().data
    return semanal.viajes_disponibles(db, tenant.empresa_id, str(factura_id), (sat[0]["receptor"] if sat else None))


class LigarViajesRequest(BaseModel):
    ligar: list[uuidlib.UUID] = Field(default_factory=list, max_length=2000)
    desligar: list[uuidlib.UUID] = Field(default_factory=list, max_length=2000)


@app.post("/api/facturas/{factura_id}/ligar-viajes")
def factura_ligar_viajes(factura_id: uuidlib.UUID, body: LigarViajesRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    db = get_admin_client()
    f = db.table("facturas").select("id, folio").eq("empresa_id", tenant.empresa_id).eq("id", str(factura_id)).limit(1).execute().data
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Factura no encontrada")
    return semanal.ligar_viajes(db, tenant.empresa_id, f[0], [str(i) for i in body.ligar], [str(i) for i in body.desligar])


class SyncRequest(BaseModel):
    fecha_inicio: date
    fecha_fin: date

    @model_validator(mode="after")
    def _rango(self):
        if self.fecha_fin < self.fecha_inicio:
            raise ValueError("fecha_fin no puede ser anterior a fecha_inicio")
        if (self.fecha_fin - self.fecha_inicio).days > 366:
            raise ValueError("El rango máximo es de 366 días")
        return self


@app.post("/api/sat/sincronizar", status_code=status.HTTP_202_ACCEPTED)
def sincronizar_sat(body: SyncRequest, background: BackgroundTasks, tenant: Tenant = Depends(current_tenant)) -> dict:
    job_id = str(uuidlib.uuid4())
    background.add_task(_run_sync, job_id, tenant.empresa_id, body.fecha_inicio, body.fecha_fin)
    return {"job_id": job_id, "estado": "en_proceso", "mock": True}


def _run_sync(job_id: str, empresa_id: str, desde: date, hasta: date) -> None:
    try:
        n = descargar_cfdis(empresa_id, desde, hasta)
        log.info("Job %s terminado: %d CFDI", job_id, n)
    except Exception:
        log.exception("Job %s falló", job_id)


class FacturaSatRequest(BaseModel):
    forzar: bool = False  # True = botón de actualización manual: vuelve a pedir el CFDI al SAT


@app.post("/api/facturas/{factura_id}/sat", status_code=status.HTTP_202_ACCEPTED)
def actualizar_factura_sat(
    factura_id: uuidlib.UUID, body: FacturaSatRequest, background: BackgroundTasks, tenant: Tenant = Depends(current_tenant)
) -> dict:
    """Descarga el CFDI (y su Carta Porte) desde el SAT con la FIEL de la empresa. Si la factura ya
    tiene datos del SAT no hace nada, salvo `forzar`. El resultado se lee de `facturas_sat`."""
    r = sat_preparar(tenant.empresa_id, str(factura_id), body.forzar)
    if not r["omitido"]:
        background.add_task(sat_ejecutar, tenant.empresa_id, str(factura_id), r["uuid"])
    return {"estado": r["estado"], "omitido": r["omitido"]}


class PasswordSat(BaseModel):
    password: str = Field(min_length=1, max_length=256)


@app.post("/api/empresa/password-sat", status_code=status.HTTP_204_NO_CONTENT)
def guardar_password_sat(body: PasswordSat, user: CurrentUser = Depends(current_user)) -> None:
    """Cifra (Fernet) y guarda la contraseña de la FIEL. El cliente no puede escribir esa columna."""
    res = (
        get_admin_client()
        .table("empresa_configuracion")
        .update({"password_sat": encrypt(body.password)})
        .eq("user_id", user.user_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Guarda primero los datos fiscales de la empresa")


class DescargaMasivaRequest(BaseModel):
    anio: int = Field(ge=2014, le=2100)
    # "anio" = los 12 meses; "faltantes" = solo los meses (por fecha de emisión) con facturas sin XML;
    # "reprocesar" = no consulta al SAT: registra la Carta Porte de los XML ya guardados
    modo: Literal["anio", "faltantes", "reprocesar"] = "faltantes"
    # Opcionales: `mes` pide solo ese mes (ignora `modo`); `cliente_id` pide solo las facturas a ese cliente (su RFC).
    mes: int | None = Field(default=None, ge=1, le=12)
    cliente_id: str | None = None


@app.post("/api/sat/descarga-masiva", status_code=status.HTTP_202_ACCEPTED)
def descarga_masiva(body: DescargaMasivaRequest, background: BackgroundTasks, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Descarga del SAT los XML de las facturas emitidas (y sus complementos de pago), los asigna por UUID o
    folio+total y los guarda. Corre en segundo plano; el avance se lee de la tabla `sat_descargas`."""
    job = descarga_iniciar(tenant.empresa_id, body.anio, body.modo, body.mes, body.cliente_id)
    rfc = descarga_rfc_cliente(tenant.empresa_id, body.cliente_id) if body.cliente_id else None
    background.add_task(descarga_ejecutar, tenant.empresa_id, job["id"], body.anio, job["meses"], None, rfc)
    return {"id": job["id"], "meses": job["meses"]}


@app.post("/api/sat/descarga-masiva/cancelar")
def descarga_masiva_cancelar(tenant: Tenant = Depends(current_tenant)) -> dict:
    """Detiene la descarga en curso. Si el proceso quedó interrumpido (el servidor se reinició o durmió), la marca
    como cancelada al instante; si sigue vivo, termina en unos segundos y conserva lo ya asignado."""
    return descarga_cancelar(tenant.empresa_id)


@app.post("/api/xml/subir-zip", status_code=status.HTTP_202_ACCEPTED)
async def subir_zip(background: BackgroundTasks, file: UploadFile = File(...), tenant: Tenant = Depends(current_tenant)) -> dict:
    """Sube varios XML de una vez en un .zip: se descomprime en el servidor, se valida cada archivo y se asigna a su
    factura como en la descarga del SAT. Corre en segundo plano; aceptados y rechazados quedan en la bitácora."""
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo debe ser .zip")
    limit = get_settings().max_zip_bytes
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "El .zip excede el tamaño máximo permitido")
    job = iniciar_zip(tenant.empresa_id, file.filename or "xml.zip")
    background.add_task(descarga_ejecutar, tenant.empresa_id, job["id"], job["anio"], [], content)
    return {"id": job["id"]}


@app.post("/api/sat/diagnostico")
def sat_diagnostico(tenant: Tenant = Depends(current_tenant)) -> dict:
    """Prueba tablas, FIEL y autenticación con el SAT y dice cuál paso falla."""
    pasos = sat_diagnosticar(tenant.empresa_id)
    return {"ok": all(p["ok"] for p in pasos), "pasos": pasos}


class GeocodificarRequest(BaseModel):
    direccion: str = Field(min_length=3, max_length=300)


@app.post("/api/mapas/geocodificar")
def mapas_geocodificar(body: GeocodificarRequest, _: Tenant = Depends(current_tenant)) -> dict:
    try:
        return geocodificar(body.direccion)
    except MapaError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))


class RutaRequest(BaseModel):
    origen_id: uuidlib.UUID
    destino_id: uuidlib.UUID
    forzar: bool = False   # True = vuelve a consultar el mapa aunque la distancia ya esté guardada


@app.post("/api/rutas/calcular")
def rutas_calcular(body: RutaRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Distancia por carretera (ida) entre dos lugares; la guarda en `rutas` y actualiza los viajes que la usan."""
    return calcular_ruta(tenant.empresa_id, str(body.origen_id), str(body.destino_id), body.forzar)


class ViajeLugaresRequest(BaseModel):
    origen_id: uuidlib.UUID | None = None
    destino_id: uuidlib.UUID | None = None


@app.post("/api/viajes/{viaje_id}/lugares")
def viaje_lugares(viaje_id: uuidlib.UUID, body: ViajeLugaresRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Asigna origen y destino a un viaje y calcula sus km operativos (ida por mapa x 2)."""
    o, d = (str(x) if x else None for x in (body.origen_id, body.destino_id))
    return asignar_viaje(tenant.empresa_id, str(viaje_id), o, d)


@app.post("/api/viajes/calcular-km")
def viajes_calcular_km(tenant: Tenant = Depends(current_tenant)) -> dict:
    """Asigna origen/destino por nombre a los viajes sin lugares y calcula los km operativos faltantes."""
    return calcular_km_viajes(tenant.empresa_id)


class EliminarFacturasRequest(BaseModel):
    ids: list[uuidlib.UUID] = Field(min_length=1, max_length=depuracion.MAX_FACTURAS)
    motivo: str | None = Field(default=None, max_length=300)
    confirmar: bool = False


class UnificarRequest(BaseModel):
    tipo: Literal["tracto", "gondola"]
    origen_id: uuidlib.UUID      # el duplicado, que desaparece
    destino_id: uuidlib.UUID     # la unidad correcta, que conserva todo
    confirmar: bool = False


@app.post("/api/facturas/eliminar-vista-previa")
def facturas_eliminar_vista_previa(body: EliminarFacturasRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Qué se borraría al eliminar esas facturas (viajes, XML, km), sin borrar nada."""
    return depuracion.vista_previa_eliminar(tenant.empresa_id, body.ids)


@app.post("/api/facturas/eliminar")
def facturas_eliminar(body: EliminarFacturasRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Elimina facturas con su viaje y XML, dejando el respaldo completo en la auditoría. Exige confirmar=true."""
    if not body.confirmar:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta la confirmación")
    return depuracion.eliminar_facturas(tenant.empresa_id, tenant.user_id, body.ids, body.motivo)


@app.post("/api/unidades/unificar-vista-previa")
def unidades_unificar_vista_previa(body: UnificarRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Qué se movería del duplicado al destino, sin cambiar nada."""
    return depuracion.vista_previa_unificar(tenant.empresa_id, body.tipo, str(body.origen_id), str(body.destino_id))


@app.post("/api/unidades/unificar")
def unidades_unificar(body: UnificarRequest, tenant: Tenant = Depends(current_tenant)) -> dict:
    """Unifica un tracto/góndola duplicado con el correcto. Exige confirmar=true."""
    if not body.confirmar:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta la confirmación")
    return depuracion.unificar(tenant.empresa_id, tenant.user_id, body.tipo, str(body.origen_id), str(body.destino_id))
