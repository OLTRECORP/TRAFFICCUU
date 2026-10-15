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
    calle: str | None = None        # lugar concreto de entrega/carga (ej. "CEMEX ... PLANTA SAN PEDRO")
    fecha: datetime | None = None   # FechaHoraSalidaLlegada


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
    toneladas_facturadas: Decimal | None = None   # concepto facturado en toneladas (Cantidad)
    precio_tonelada: Decimal | None = None        # ValorUnitario de ese concepto
    peso_bruto_total_kg: Decimal | None = None    # PesoBrutoTotal tal cual; el portal lo toma como capacidad del tracto
    mercancia: str | None = None
    tipo_permiso_sct: str | None = None
    num_permiso_sct: str | None = None
    aseguradora: str | None = None
    poliza_seguro: str | None = None
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
        calle=(dom.get("Calle") or "").strip() or None if dom is not None else None,
        fecha=_fecha_opcional(node.get("FechaHoraSalidaLlegada")),
    )


def _fecha_opcional(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


def _opt_dec(value: str | None) -> Decimal | None:
    try:
        return Decimal(value) if value not in (None, "") else None
    except InvalidOperation:
        return None


def _toneladas(root: ET.Element) -> tuple[Decimal | None, Decimal | None]:
    """(toneladas, precio por tonelada) de los conceptos facturados en toneladas (A75/TNE o unidad «tonelada»)."""
    nodo = _child(root, "Conceptos")
    total, precio = Decimal(0), None
    for c in (_children(nodo, "Concepto") if nodo is not None else []):
        if c.get("ClaveUnidad") in ("A75", "TNE") or "TONELADA" in (c.get("Unidad") or "").upper():
            cant = _opt_dec(c.get("Cantidad"))
            if cant:
                total += cant
                precio = precio if precio is not None else _opt_dec(c.get("ValorUnitario"))
    return (total, precio) if total else (None, None)


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

    toneladas, precio = _toneladas(root)
    mercancia = _child(mercancias, "Mercancia")
    seguros = _child(auto, "Seguros")
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
        toneladas_facturadas=toneladas,
        precio_tonelada=precio,
        peso_bruto_total_kg=_opt_dec(mercancias.get("PesoBrutoTotal")),
        mercancia=mercancia.get("Descripcion") if mercancia is not None else None,
        tipo_permiso_sct=auto.get("PermSCT"),
        num_permiso_sct=auto.get("NumPermisoSCT"),
        aseguradora=(seguros.get("AseguraRespCivil") if seguros is not None else None),
        poliza_seguro=(seguros.get("PolizaRespCivil") if seguros is not None else None),
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


def _referencia_ubicacion(u: ET.Element) -> str | None:
    """Nombre de referencia del lugar: «cliente - lugar de entrega» (el cliente puede tener varios destinos)."""
    nombre = (u.get("NombreRemitenteDestinatario") or u.get("NombreRemitente") or u.get("NombreDestinatario") or "").strip()
    dom = _child(u, "Domicilio")
    calle = ((dom.get("Calle") if dom is not None else "") or "").strip()
    return " - ".join(p for p in (nombre, calle) if p) or None


_IMPUESTOS = {"001": "ISR", "002": "IVA", "003": "IEPS"}


def impuestos_cfdi(root: ET.Element) -> dict:
    """Impuestos del comprobante (nodo Impuestos del propio CFDI, no los de cada concepto): lo trasladado (IVA) y lo
    retenido (IVA e ISR), que el Total ya trae descontado. Importes como texto con 2 decimales."""
    nodo = _child(root, "Impuestos")
    por_tipo = {"traslados": {}, "retenciones": {}}
    if nodo is not None:
        for clave, lista, hijo in (("traslados", "Traslados", "Traslado"), ("retenciones", "Retenciones", "Retencion")):
            padre = _child(nodo, lista)
            for t in (_children(padre, hijo) if padre is not None else []):
                nombre = _IMPUESTOS.get(t.get("Impuesto") or "", t.get("Impuesto") or "?")
                por_tipo[clave][nombre] = por_tipo[clave].get(nombre, Decimal(0)) + (_opt_dec(t.get("Importe")) or Decimal(0))

    def total(clave: str, atributo: str) -> Decimal:
        declarado = _opt_dec(nodo.get(atributo)) if nodo is not None else None
        return declarado if declarado is not None else sum(por_tipo[clave].values(), Decimal(0))

    f = lambda d: str(d.quantize(Decimal("0.01")))
    return {
        "iva_trasladado": f(por_tipo["traslados"].get("IVA", Decimal(0))),
        "retencion_iva": f(por_tipo["retenciones"].get("IVA", Decimal(0))),
        "retencion_isr": f(por_tipo["retenciones"].get("ISR", Decimal(0))),
        "total_trasladados": f(total("traslados", "TotalImpuestosTrasladados")),
        "total_retenidos": f(total("retenciones", "TotalImpuestosRetenidos")),
    }


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
             "calle": (_child(u, "Domicilio").get("Calle") if _child(u, "Domicilio") is not None else None),
             "referencia": _referencia_ubicacion(u),
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
        "descuento": root.get("Descuento"),
        "impuestos": impuestos_cfdi(root),
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
