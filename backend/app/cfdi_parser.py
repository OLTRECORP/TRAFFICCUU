"""Parser de CFDI 3.3/4.0 con complemento Carta Porte 2.0 / 3.0 (solo stdlib)."""
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation


class CFDIError(ValueError):
    """XML inválido o sin la información mínima requerida."""


@dataclass
class UbicacionData:
    id_ubicacion: str
    nombre: str | None = None
    municipio: str | None = None
    estado: str | None = None
    domicilio: str | None = None    # calle, colonia, CP... de la Carta Porte (no se guarda en `ubicaciones`)


@dataclass
class CFDIViaje:
    uuid: str
    fecha: datetime
    folio: str | None
    subtotal: Decimal
    total: Decimal
    rfc_emisor: str
    rfc_receptor: str
    version_carta_porte: str
    origen: UbicacionData
    destino: UbicacionData
    distancia_xml: Decimal  # ida: suma de DistanciaRecorrida
    placa_vehiculo: str
    configuracion_vehicular: str | None
    placa_remolque: str | None
    subtipo_remolque: str | None
    chofer_rfc: str
    chofer_nombre: str
    chofer_licencia: str | None
    modelo_vehiculo: str | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def distancia_operativa(self) -> Decimal:
        """Viaje redondo: la unidad regresa, por eso ida * 2."""
        return self.distancia_xml * 2


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(node: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in node if _local(c.tag) == name]


def _child(node: ET.Element | None, name: str) -> ET.Element | None:
    if node is None:
        return None
    found = _children(node, name)
    return found[0] if found else None


def _dec(value: str | None, field_name: str) -> Decimal:
    try:
        return Decimal(value if value not in (None, "") else "0")
    except InvalidOperation:
        raise CFDIError(f"Valor numérico inválido en {field_name}: {value!r}")


def _parse_fecha(value: str | None) -> datetime:
    if not value:
        raise CFDIError("El CFDI no tiene atributo Fecha")
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise CFDIError(f"Fecha inválida: {value!r}")


def _ubicacion(node: ET.Element) -> UbicacionData:
    dom = _child(node, "Domicilio")
    nombre = node.get("NombreRemitenteDestinatario") or node.get("NombreRemitente") or node.get("NombreDestinatario")
    return UbicacionData(
        id_ubicacion=node.get("IDUbicacion") or "",
        nombre=nombre,
        municipio=dom.get("Municipio") if dom is not None else None,
        estado=dom.get("Estado") if dom is not None else None,
        domicilio=_domicilio_texto(dom),
    )


def _domicilio_texto(dom: ET.Element | None) -> str | None:
    if dom is None:
        return None
    calle = " ".join(p for p in (dom.get("Calle"), dom.get("NumeroExterior")) if p)
    cp = f"C.P. {dom.get('CodigoPostal')}" if dom.get("CodigoPostal") else None
    partes = [calle or None, dom.get("Colonia"), dom.get("Localidad"), dom.get("Municipio"), dom.get("Estado"), cp, dom.get("Pais")]
    return ", ".join(p for p in partes if p) or None


def parse_cfdi(xml_bytes: bytes) -> CFDIViaje:
    # Defensa contra XML bombs / XXE: un CFDI válido nunca lleva DTD ni entidades.
    head = xml_bytes[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in xml_bytes.upper():
        raise CFDIError("El XML contiene DTD/entidades, no es un CFDI válido")

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise CFDIError(f"XML mal formado: {exc}")

    if _local(root.tag) != "Comprobante":
        raise CFDIError("El nodo raíz no es cfdi:Comprobante")

    emisor, receptor = _child(root, "Emisor"), _child(root, "Receptor")
    if emisor is None or receptor is None:
        raise CFDIError("Faltan nodos Emisor/Receptor")

    complemento = _child(root, "Complemento")
    if complemento is None:
        raise CFDIError("El CFDI no tiene Complemento")

    timbre = _child(complemento, "TimbreFiscalDigital")
    uuid = timbre.get("UUID") if timbre is not None else None
    if not uuid:
        raise CFDIError("El CFDI no está timbrado (sin TimbreFiscalDigital/UUID)")

    cp = _child(complemento, "CartaPorte")
    if cp is None:
        raise CFDIError("El CFDI no contiene complemento Carta Porte")
    version = cp.get("Version", "")
    if version not in ("2.0", "3.0", "3.1"):
        raise CFDIError(f"Versión de Carta Porte no soportada: {version!r} (se soporta 2.0 y 3.x)")

    # --- Ubicaciones y distancia --------------------------------------
    ubic_parent = _child(cp, "Ubicaciones")
    ubicaciones = _children(ubic_parent, "Ubicacion") if ubic_parent is not None else []
    origenes = [u for u in ubicaciones if u.get("TipoUbicacion") == "Origen"]
    destinos = [u for u in ubicaciones if u.get("TipoUbicacion") == "Destino"]
    if not origenes or not destinos:
        raise CFDIError("Carta Porte sin ubicación de Origen y/o Destino")

    distancia = sum((_dec(d.get("DistanciaRecorrida"), "DistanciaRecorrida") for d in destinos), Decimal(0))
    warnings: list[str] = []
    if distancia <= 0:
        warnings.append("DistanciaRecorrida es 0; no se sumarán kilómetros al tracto")

    # --- Autotransporte ------------------------------------------------
    mercancias = _child(cp, "Mercancias")
    auto = _child(mercancias, "Autotransporte")
    if auto is None:
        raise CFDIError("Carta Porte sin Mercancias/Autotransporte")
    ident = _child(auto, "IdentificacionVehicular")
    placa = ident.get("PlacaVM") if ident is not None else None
    if not placa:
        raise CFDIError("Falta PlacaVM en IdentificacionVehicular")
    remolques = _child(auto, "Remolques")
    remolque = _child(remolques, "Remolque")

    # --- Chofer (TipoFigura = 01, Operador) -----------------------------
    figuras = _child(cp, "FiguraTransporte")
    operador = next((f for f in _children(figuras, "TiposFigura") if f.get("TipoFigura") == "01"), None) if figuras is not None else None
    if operador is None or not operador.get("RFCFigura"):
        raise CFDIError("No se encontró figura de transporte con TipoFigura=01 (Operador)")

    return CFDIViaje(
        uuid=uuid.upper(),
        fecha=_parse_fecha(root.get("Fecha")),
        folio=" ".join(p for p in (root.get("Serie"), root.get("Folio")) if p) or None,
        subtotal=_dec(root.get("SubTotal"), "SubTotal"),
        total=_dec(root.get("Total"), "Total"),
        rfc_emisor=emisor.get("Rfc", ""),
        rfc_receptor=receptor.get("Rfc", ""),
        version_carta_porte=version,
        origen=_ubicacion(origenes[0]),
        destino=_ubicacion(destinos[-1]),
        distancia_xml=distancia,
        placa_vehiculo=placa,
        configuracion_vehicular=ident.get("ConfigVehicular") if ident is not None else None,
        placa_remolque=remolque.get("Placa") if remolque is not None else None,
        subtipo_remolque=remolque.get("SubTipoRem") if remolque is not None else None,
        chofer_rfc=operador.get("RFCFigura", ""),
        chofer_nombre=operador.get("NombreFigura", ""),
        chofer_licencia=operador.get("NumLicencia"),
        modelo_vehiculo=ident.get("AnioModeloVM") if ident is not None else None,
        warnings=warnings,
    )


def _check_xml(xml_bytes: bytes) -> ET.Element:
    head = xml_bytes[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in xml_bytes.upper():
        raise CFDIError("El XML contiene DTD/entidades, no es un CFDI válido")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise CFDIError(f"XML mal formado: {exc}")
    if _local(root.tag) != "Comprobante":
        raise CFDIError("El nodo raíz no es cfdi:Comprobante")
    return root


def resumen_cfdi(xml_bytes: bytes) -> dict:
    """Resumen JSON de un CFDI para mostrarlo en el portal. A diferencia de `parse_cfdi`,
    no exige Carta Porte: un CFDI de pago o sin traslado devuelve `carta_porte: None`."""
    root = _check_xml(xml_bytes)
    emisor, receptor = _child(root, "Emisor"), _child(root, "Receptor")
    complemento = _child(root, "Complemento")
    timbre = _child(complemento, "TimbreFiscalDigital")
    if timbre is None or not timbre.get("UUID"):
        raise CFDIError("El CFDI no está timbrado (sin TimbreFiscalDigital/UUID)")

    conceptos_node = _child(root, "Conceptos")
    conceptos = [
        {"descripcion": c.get("Descripcion"), "cantidad": c.get("Cantidad"),
         "importe": c.get("Importe"), "clave_prod_serv": c.get("ClaveProdServ")}
        for c in (_children(conceptos_node, "Concepto") if conceptos_node is not None else [])
    ]

    carta_porte = None
    cp = _child(complemento, "CartaPorte")
    if cp is not None:
        ubic_parent = _child(cp, "Ubicaciones")
        ubicaciones = [
            {"tipo": u.get("TipoUbicacion"), "id": u.get("IDUbicacion"),
             "nombre": u.get("NombreRemitenteDestinatario") or u.get("NombreRemitente") or u.get("NombreDestinatario"),
             "fecha": u.get("FechaHoraSalidaLlegada"), "distancia": u.get("DistanciaRecorrida"),
             "municipio": (_child(u, "Domicilio").get("Municipio") if _child(u, "Domicilio") is not None else None),
             "estado": (_child(u, "Domicilio").get("Estado") if _child(u, "Domicilio") is not None else None)}
            for u in (_children(ubic_parent, "Ubicacion") if ubic_parent is not None else [])
        ]
        mercancias = _child(cp, "Mercancias")
        auto = _child(mercancias, "Autotransporte")
        ident = _child(auto, "IdentificacionVehicular")
        remolques = _child(auto, "Remolques")
        figuras = _child(cp, "FiguraTransporte")
        carta_porte = {
            "version": cp.get("Version"),
            "id_ccp": cp.get("IdCCP"),
            "total_dist_rec": cp.get("TotalDistRec"),
            "ubicaciones": ubicaciones,
            "mercancias": [
                {"descripcion": m.get("Descripcion"), "cantidad": m.get("Cantidad"),
                 "peso_kg": m.get("PesoEnKg"), "clave_unidad": m.get("ClaveUnidad")}
                for m in (_children(mercancias, "Mercancia") if mercancias is not None else [])
            ],
            "peso_bruto_total": mercancias.get("PesoBrutoTotal") if mercancias is not None else None,
            "vehiculo": {
                "placa": ident.get("PlacaVM") if ident is not None else None,
                "config": ident.get("ConfigVehicular") if ident is not None else None,
                "anio": ident.get("AnioModeloVM") if ident is not None else None,
            },
            "remolques": [
                {"placa": r.get("Placa"), "subtipo": r.get("SubTipoRem")}
                for r in (_children(remolques, "Remolque") if remolques is not None else [])
            ],
            "figuras": [
                {"tipo": f.get("TipoFigura"), "rfc": f.get("RFCFigura"), "nombre": f.get("NombreFigura"),
                 "licencia": f.get("NumLicencia")}
                for f in (_children(figuras, "TiposFigura") if figuras is not None else [])
            ],
        }

    return {
        "uuid": timbre.get("UUID").upper(),
        "version": root.get("Version"),
        "tipo_comprobante": root.get("TipoDeComprobante"),
        "serie": root.get("Serie"),
        "folio": root.get("Folio"),
        "fecha": root.get("Fecha"),
        "fecha_timbrado": timbre.get("FechaTimbrado"),
        "moneda": root.get("Moneda"),
        "subtotal": root.get("SubTotal"),
        "total": root.get("Total"),
        "emisor": {"rfc": emisor.get("Rfc") if emisor is not None else None,
                   "nombre": emisor.get("Nombre") if emisor is not None else None},
        "receptor": {"rfc": receptor.get("Rfc") if receptor is not None else None,
                     "nombre": receptor.get("Nombre") if receptor is not None else None},
        "conceptos": conceptos,
        "carta_porte": carta_porte,
    }


def pagos_cfdi(xml_bytes: bytes) -> list[dict]:
    """Pagos de un complemento de pago (CFDI tipo P, Pagos 1.0 y 2.0): fecha, monto y los documentos
    (facturas) que cubre, con el UUID de cada uno en `uuid_documento`."""
    root = _check_xml(xml_bytes)
    complemento = _child(root, "Complemento")
    pagos_node = _child(complemento, "Pagos")
    if pagos_node is None:
        return []
    pagos = []
    for pago in _children(pagos_node, "Pago"):
        fecha = (pago.get("FechaPago") or "")[:10] or None
        pagos.append({
            "fecha_pago": fecha,
            "monto": pago.get("Monto"),
            "moneda": pago.get("MonedaP"),
            "documentos": [
                {"uuid_documento": (d.get("IdDocumento") or "").upper(), "serie": d.get("Serie"), "folio": d.get("Folio"),
                 "parcialidad": d.get("NumParcialidad"), "imp_pagado": d.get("ImpPagado")}
                for d in _children(pago, "DoctoRelacionado")
            ],
        })
    return pagos
