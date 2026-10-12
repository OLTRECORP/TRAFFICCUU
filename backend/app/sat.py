"""Descarga masiva SAT (MOCK). Reemplazar `descargar_cfdis` por una integración real
(p. ej. librería `cfdiclient`) usando FIEL (.cer/.key en Storage) + password descifrado."""
import base64
import io
import logging
import time
import zipfile
from collections.abc import Iterator
from datetime import date, datetime, timedelta

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


class SatError(Exception):
    """Fallo al consultar el SAT; el mensaje se muestra al usuario en el popup de la factura."""


# EstadoSolicitud de VerificaSolicitudDescarga
_EN_ESPERA = {"1", "2"}
_TERMINADA = "3"


def _cargar_fiel(empresa_id: str):
    """FIEL ya cargada en el portal: .cer/.key del bucket privado `fiel` + contraseña cifrada (Fernet)."""
    from cfdiclient import Fiel  # import tardío: solo se necesita al hablar con el SAT

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
        raise SatError("Falta cargar la FIEL completa (.cer, .key y contraseña) en Configuración")
    cer = db.storage.from_("fiel").download(cfg["cer_path"])
    key = db.storage.from_("fiel").download(cfg["key_path"])
    try:
        fiel = Fiel(cer, key, decrypt(cfg["password_sat"]))  # la contraseña no se registra en logs
    except Exception as exc:
        raise SatError("No se pudo abrir la FIEL: revisa el archivo .key y su contraseña") from exc
    return cfg["rfc"], fiel


class SatSinResultados(SatError):
    """El SAT atendió la solicitud pero no hay CFDI en el rango pedido."""


def _verificar(fiel, rfc: str, id_solicitud: str, espera_max: int, intervalo: int) -> list[str]:
    """Espera a que el SAT termine la solicitud y devuelve los ids de paquete a descargar."""
    from cfdiclient import Autenticacion, VerificaSolicitudDescarga

    verifica = VerificaSolicitudDescarga(fiel)
    limite = time.monotonic() + espera_max
    while True:
        token = Autenticacion(fiel).obtener_token()
        v = verifica.verificar_descarga(token, rfc, id_solicitud)
        estado = str(v.get("estado_solicitud"))
        if estado == _TERMINADA:
            return v.get("paquetes") or []
        if str(v.get("codigo_estado_solicitud")) == "5004":
            raise SatSinResultados("El SAT no encontró CFDI para esa solicitud")
        if estado not in _EN_ESPERA:
            raise SatError(f"El SAT respondió: {v.get('mensaje') or 'solicitud rechazada o sin resultados'} (estado {estado})")
        if time.monotonic() > limite:
            raise SatError("El SAT sigue procesando la solicitud; vuelve a intentarlo en unos minutos")
        time.sleep(intervalo)


def _xmls_de_paquetes(fiel, rfc: str, paquetes: list[str]) -> Iterator[bytes]:
    from cfdiclient import Autenticacion, DescargaMasiva

    descarga = DescargaMasiva(fiel)
    for id_paquete in paquetes:
        token = Autenticacion(fiel).obtener_token()
        p = descarga.descargar_paquete(token, rfc, id_paquete)
        if not p.get("paquete_b64"):
            continue
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(p["paquete_b64"]))) as z:
            for name in z.namelist():
                if name.lower().endswith(".xml"):
                    yield z.read(name)


def descargar_cfdi_por_uuid(
    empresa_id: str,
    uuid: str,
    on_solicitud=None,
    espera_max: int = 600,
    intervalo: int = 15,
) -> bytes:
    """Descarga el XML de un CFDI por UUID con el WS de Descarga Masiva del SAT, firmando con la FIEL
    de la empresa. Solicitud -> verificación (con espera) -> descarga del paquete ZIP.
    Solo el emisor o el receptor del CFDI pueden descargarlo."""
    from cfdiclient import Autenticacion, SolicitaDescargaEmitidos, SolicitaDescargaRecibidos

    rfc, fiel = _cargar_fiel(empresa_id)
    uuid = uuid.lower()
    ahora = datetime.now()
    ini, fin = ahora - timedelta(days=5 * 365), ahora  # con UUID el SAT ignora el rango

    token = Autenticacion(fiel).obtener_token()
    id_solicitud = None
    mensajes = []
    for solicitar, filtro in (
        (SolicitaDescargaEmitidos(fiel), {"rfc_emisor": rfc}),
        (SolicitaDescargaRecibidos(fiel), {"rfc_receptor": rfc}),
    ):
        res = solicitar.solicitar_descarga(token, rfc, ini, fin, uuid=uuid, estado_comprobante=None, **filtro)
        if res.get("cod_estatus") == "5000" and res.get("id_solicitud"):
            id_solicitud = res["id_solicitud"]
            break
        mensajes.append(res.get("mensaje") or res.get("cod_estatus") or "sin respuesta")
    if not id_solicitud:
        raise SatError(f"El SAT no aceptó la solicitud: {'; '.join(mensajes)}")
    if on_solicitud:
        on_solicitud(id_solicitud)

    try:
        paquetes = _verificar(fiel, rfc, id_solicitud, espera_max, intervalo)
    except SatSinResultados:
        paquetes = []
    if not paquetes:
        raise SatError("El SAT no encontró un CFDI con ese UUID para tu RFC")
    for data in _xmls_de_paquetes(fiel, rfc, paquetes):
        if uuid.encode() in data.lower():
            return data
    raise SatError("El paquete del SAT no contiene el XML de ese UUID")


def descargar_emitidos_rango(
    empresa_id: str,
    desde: datetime,
    hasta: datetime,
    on_solicitud=None,
    espera_max: int = 1800,
    intervalo: int = 20,
) -> Iterator[bytes]:
    """Descarga masiva de los CFDI EMITIDOS por la empresa entre `desde` y `hasta` (facturas y
    complementos de pago, solo vigentes). Un generador de XML en bytes; vacío si el SAT no tiene
    comprobantes en el rango. Lanza SatError si el SAT rechaza la solicitud."""
    from cfdiclient import Autenticacion, SolicitaDescargaEmitidos

    rfc, fiel = _cargar_fiel(empresa_id)
    token = Autenticacion(fiel).obtener_token()
    res = SolicitaDescargaEmitidos(fiel).solicitar_descarga(
        token, rfc, desde, hasta, rfc_emisor=rfc, tipo_solicitud="CFDI", estado_comprobante="Vigente"
    )
    if res.get("cod_estatus") != "5000" or not res.get("id_solicitud"):
        raise SatError(f"El SAT no aceptó la solicitud: {res.get('mensaje') or res.get('cod_estatus') or 'sin respuesta'}")
    if on_solicitud:
        on_solicitud(res["id_solicitud"])
    try:
        paquetes = _verificar(fiel, rfc, res["id_solicitud"], espera_max, intervalo)
    except SatSinResultados:
        return
    yield from _xmls_de_paquetes(fiel, rfc, paquetes)
