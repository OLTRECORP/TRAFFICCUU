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


def _avisar(log, mensaje: str, nivel: str = "info") -> None:
    """`log` es un callable (mensaje, nivel) opcional, p. ej. Bitacora.add."""
    if log:
        log(mensaje, nivel)


class SatError(Exception):
    """Fallo al consultar el SAT; el mensaje se muestra al usuario en el popup de la factura."""


# EstadoSolicitud de VerificaSolicitudDescarga
_EN_ESPERA = {"1", "2"}
_TERMINADA = "3"
_ESTADOS = {"1": "aceptada", "2": "en proceso", "3": "terminada", "4": "error", "5": "rechazada", "6": "vencida"}


def _cargar_fiel(empresa_id: str, log=None):
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
    _avisar(log, f"Leyendo la FIEL de la empresa {cfg['rfc']}…")
    cer = db.storage.from_("fiel").download(cfg["cer_path"])
    key = db.storage.from_("fiel").download(cfg["key_path"])
    try:
        fiel = Fiel(cer, key, decrypt(cfg["password_sat"]))  # la contraseña no se registra en logs
    except Exception as exc:
        raise SatError("No se pudo abrir la FIEL: revisa el archivo .key y su contraseña") from exc
    if fiel.cer.has_expired():
        raise SatError("La FIEL (.cer) está vencida; carga una vigente en Empresa")
    _avisar(log, "FIEL abierta correctamente", "ok")
    return cfg["rfc"], fiel


class Cancelado(Exception):
    """El usuario detuvo la descarga; no es un fallo."""


def _revisar(parar) -> None:
    if parar and parar():
        raise Cancelado()


class SatSinResultados(SatError):
    """El SAT atendió la solicitud pero no hay CFDI en el rango pedido."""


def _verificar(fiel, rfc: str, id_solicitud: str, espera_max: int, intervalo: int, log=None, parar=None) -> list[str]:
    """Espera a que el SAT termine la solicitud y devuelve los ids de paquete a descargar."""
    from cfdiclient import Autenticacion, VerificaSolicitudDescarga

    verifica = VerificaSolicitudDescarga(fiel)
    limite = time.monotonic() + espera_max
    while True:
        _revisar(parar)
        token = Autenticacion(fiel).obtener_token()
        v = verifica.verificar_descarga(token, rfc, id_solicitud)
        estado = str(v.get("estado_solicitud"))
        _avisar(log, f"SAT: solicitud {id_solicitud[:8]}… estado {estado} ({_ESTADOS.get(estado, 'desconocido')}), "
                     f"CFDI {v.get('numero_cfdis')}, código {v.get('codigo_estado_solicitud')}")
        if estado == _TERMINADA:
            return v.get("paquetes") or []
        if str(v.get("codigo_estado_solicitud")) == "5004":
            raise SatSinResultados("El SAT no encontró CFDI para esa solicitud")
        if estado not in _EN_ESPERA:
            raise SatError(f"El SAT respondió: {v.get('mensaje') or 'solicitud rechazada o sin resultados'} (estado {estado})")
        if time.monotonic() > limite:
            raise SatError("El SAT sigue procesando la solicitud; vuelve a intentarlo en unos minutos")
        _avisar(log, f"Esperando {intervalo}s para volver a preguntar al SAT…")
        for _ in range(max(1, intervalo // 5)):   # dormir en tramos para poder detenerse pronto
            time.sleep(min(5, intervalo))
            _revisar(parar)


def _xmls_de_paquetes(fiel, rfc: str, paquetes: list[str], log=None, parar=None) -> Iterator[bytes]:
    from cfdiclient import Autenticacion, DescargaMasiva

    descarga = DescargaMasiva(fiel)
    for id_paquete in paquetes:
        _revisar(parar)
        token = Autenticacion(fiel).obtener_token()
        _avisar(log, f"Descargando paquete {id_paquete[:12]}…")
        p = descarga.descargar_paquete(token, rfc, id_paquete)
        if not p.get("paquete_b64"):
            _avisar(log, f"El SAT no entregó contenido del paquete: {p.get('mensaje') or p.get('cod_estatus')}", "aviso")
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
    log=None,
    parar=None,
    id_existente: str | None = None,
) -> Iterator[bytes]:
    """Descarga masiva de los CFDI EMITIDOS por la empresa entre `desde` y `hasta` (facturas y
    complementos de pago, solo vigentes). Un generador de XML en bytes; vacío si el SAT no tiene
    comprobantes en el rango. Lanza SatError si el SAT rechaza la solicitud. Con `id_existente` no pide una
    solicitud nueva: retoma la que se hizo antes (el SAT la conserva varios días) y solo espera su resultado."""
    from cfdiclient import Autenticacion, SolicitaDescargaEmitidos

    rfc, fiel = _cargar_fiel(empresa_id, log)
    if id_existente:
        id_solicitud = id_existente
        _avisar(log, f"Retomando la solicitud {id_solicitud[:8]}… que ya se había enviado al SAT", "aviso")
    else:
        _avisar(log, "Autenticando con el SAT…")
        token = Autenticacion(fiel).obtener_token()
        _avisar(log, "Autenticado. Enviando solicitud de CFDI emitidos "
                     f"{desde:%Y-%m-%d} a {hasta:%Y-%m-%d}…")
        res = SolicitaDescargaEmitidos(fiel).solicitar_descarga(
            token, rfc, desde, hasta, rfc_emisor=rfc, tipo_solicitud="CFDI", estado_comprobante="Vigente"
        )
        _avisar(log, f"SAT respondió a la solicitud: código {res.get('cod_estatus')} — {res.get('mensaje')}")
        if res.get("cod_estatus") != "5000" or not res.get("id_solicitud"):
            raise SatError(f"El SAT no aceptó la solicitud (código {res.get('cod_estatus')}): {res.get('mensaje') or 'sin respuesta'}")
        id_solicitud = res["id_solicitud"]
        if on_solicitud:
            on_solicitud(id_solicitud)
    try:
        paquetes = _verificar(fiel, rfc, id_solicitud, espera_max, intervalo, log, parar)
    except SatSinResultados:
        _avisar(log, "El SAT no tiene CFDI emitidos en ese periodo", "aviso")
        return
    _avisar(log, f"Solicitud terminada: {len(paquetes)} paquete(s) por descargar", "ok")
    yield from _xmls_de_paquetes(fiel, rfc, paquetes, log, parar)


def diagnosticar(empresa_id: str) -> list[dict]:
    """Prueba paso a paso lo que necesita la descarga (tablas, FIEL, autenticación con el SAT) y dice
    cuál falla. Devuelve [{paso, ok, detalle}]; se detiene en el primer fallo."""
    pasos: list[dict] = []

    def paso(nombre: str, ok: bool, detalle: str) -> bool:
        pasos.append({"paso": nombre, "ok": ok, "detalle": detalle})
        return ok

    db = get_admin_client()
    try:
        db.table("sat_descargas").select("id").limit(1).execute()
        db.table("complementos_pago").select("id").limit(1).execute()
        db.table("lugares").select("id").limit(1).execute()
        db.table("sat_descargas").select("bitacora").limit(1).execute()
    except Exception:
        paso("Base de datos", False, "Faltan tablas o columnas: ejecuta en Supabase las migraciones 009 y 010")
        return pasos
    paso("Base de datos", True, "Migraciones 009 y 010 aplicadas")
    try:
        rfc, fiel = _cargar_fiel(empresa_id)
    except SatError as exc:
        paso("FIEL", False, str(exc))
        return pasos
    vence = fiel.cer.get_notAfter().decode()[:8]
    paso("FIEL", True, f"RFC {rfc}, vence {vence[:4]}-{vence[4:6]}-{vence[6:]}")
    try:
        from cfdiclient import Autenticacion

        Autenticacion(fiel).obtener_token()
    except Exception as exc:
        paso("Autenticación con el SAT", False, f"El SAT rechazó la autenticación o no respondió ({type(exc).__name__}: {str(exc)[:200]})")
        return pasos
    paso("Autenticación con el SAT", True, "Token obtenido; la descarga masiva puede solicitarse")
    return pasos
