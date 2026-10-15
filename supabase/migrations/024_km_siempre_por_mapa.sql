-- Km de los viajes = los del mapa, para todos los clientes. Requiere 004-023. Idempotente.
--
--  * Antes solo los clientes con «km por mapa» usaban la distancia del mapa; el resto usaba la del XML (Carta Porte),
--    y el viaje mostraba un número distinto al que calcula el mapa. Ahora, si el viaje ya tiene distancia por mapa,
--    sus km operativos = ida por mapa x 2; mientras no la tenga, se usa la del XML x 2.
--  * Los viajes que ya tenían la ruta calculada en `rutas` pero sin distancia (o con una vieja) se igualan a ella.
--  * Al reescribir la distancia, el trigger recalcula los km y ajusta el kilometraje del tracto con la diferencia.

create or replace function public.fn_viaje_km_efectivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.km_por_mapa := new.distancia_mapa_km is not null;
  new.distancia_operativa := round(
    case when new.distancia_mapa_km is not null then new.distancia_mapa_km * 2
         else coalesce(new.distancia_xml, 0) * 2 end, 2);
  return new;
end;
$$;

-- Viajes con origen y destino cuya ruta ya está calculada: toman su distancia.
update public.viajes v
   set distancia_mapa_km = r.distancia_km
  from public.rutas r
 where r.empresa_id = v.empresa_id
   and r.origen_id  = v.lugar_origen_id
   and r.destino_id = v.lugar_destino_id
   and v.distancia_mapa_km is distinct from r.distancia_km;

-- Todos los demás viajes con distancia por mapa recalculan sus km con la regla nueva.
update public.viajes set distancia_mapa_km = distancia_mapa_km where distancia_mapa_km is not null;

notify pgrst, 'reload schema';
