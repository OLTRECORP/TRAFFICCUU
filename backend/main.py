import logging
import uuid as uuidlib
from datetime import date

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from app.auth import CurrentUser, Tenant, current_tenant, current_user
from app.cfdi_parser import CFDIError, parse_cfdi
from app.config import get_settings
from app.crypto import encrypt
from app.db import get_admin_client
from app.excel_import import ExcelError, guardar, parse_workbook
from app.sat import descargar_cfdis
from app.viajes_service import guardar_viaje

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

    try:
        cfdi = parse_cfdi(content)
    except CFDIError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    viaje = guardar_viaje(tenant, cfdi)
    return {
        "viaje_id": viaje["id"],
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
