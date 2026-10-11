from decimal import Decimal

import pytest

from app.cfdi_parser import CFDIError, parse_cfdi


def make_xml(cp_ns="CartaPorte20", version="2.0", dest_dists=("350.5",), figura="01"):
    destinos = "".join(
        f'<cartaporte:Ubicacion TipoUbicacion="Destino" IDUbicacion="DE00000{i}" DistanciaRecorrida="{d}">'
        f'<cartaporte:Domicilio Municipio="Monterrey" Estado="NLE"/></cartaporte:Ubicacion>'
        for i, d in enumerate(dest_dists, 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:cartaporte="http://www.sat.gob.mx/{cp_ns}"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="A" Folio="123"
  Fecha="2025-03-10T08:30:00" SubTotal="10000.00" Total="11600.00">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Transportes SA"/>
  <cfdi:Receptor Rfc="BBB020202BBB" Nombre="Cliente"/>
  <cfdi:Complemento>
    <cartaporte:CartaPorte Version="{version}">
      <cartaporte:Ubicaciones>
        <cartaporte:Ubicacion TipoUbicacion="Origen" IDUbicacion="OR000001" NombreRemitenteDestinatario="Planta Chihuahua">
          <cartaporte:Domicilio Municipio="Chihuahua" Estado="CHH"/>
        </cartaporte:Ubicacion>
        {destinos}
      </cartaporte:Ubicaciones>
      <cartaporte:Mercancias>
        <cartaporte:Autotransporte>
          <cartaporte:IdentificacionVehicular ConfigVehicular="T3S2" PlacaVM="12AB3C" AnioModeloVM="2020"/>
          <cartaporte:Remolques><cartaporte:Remolque SubTipoRem="CTR_011" Placa="99XY1Z"/></cartaporte:Remolques>
        </cartaporte:Autotransporte>
      </cartaporte:Mercancias>
      <cartaporte:FiguraTransporte>
        <cartaporte:TiposFigura TipoFigura="{figura}" RFCFigura="XEXX010101000" NombreFigura="Juan Pérez" NumLicencia="LIC123"/>
      </cartaporte:FiguraTransporte>
    </cartaporte:CartaPorte>
    <tfd:TimbreFiscalDigital UUID="ab12cd34-0000-4000-8000-1234567890ab"/>
  </cfdi:Complemento>
</cfdi:Comprobante>""".encode()


@pytest.mark.parametrize("ns,ver", [("CartaPorte20", "2.0"), ("CartaPorte30", "3.0")])
def test_versiones(ns, ver):
    v = parse_cfdi(make_xml(ns, ver))
    assert v.uuid == "AB12CD34-0000-4000-8000-1234567890AB"
    assert v.folio == "A 123"
    assert v.total == Decimal("11600.00")
    assert v.origen.id_ubicacion == "OR000001" and v.destino.id_ubicacion == "DE000001"
    assert v.placa_vehiculo == "12AB3C" and v.placa_remolque == "99XY1Z"
    assert v.chofer_nombre == "Juan Pérez"
    assert v.distancia_xml == Decimal("350.5")
    assert v.distancia_operativa == Decimal("701.0")


def test_suma_multiples_destinos():
    v = parse_cfdi(make_xml(dest_dists=("100", "250.25")))
    assert v.distancia_xml == Decimal("350.25")
    assert v.distancia_operativa == Decimal("700.50")


def test_sin_operador():
    with pytest.raises(CFDIError):
        parse_cfdi(make_xml(figura="02"))


def test_rechaza_entidades():
    with pytest.raises(CFDIError):
        parse_cfdi(b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>')
