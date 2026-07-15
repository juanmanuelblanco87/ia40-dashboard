# NCM de nuevas categorías (investigación 15/07/2026)

Códigos NCM (Nomenclatura Común del Mercosur) investigados para agregar siete
categorías nuevas al Módulo de Importaciones, además de "Sillas de ruedas"
(la única existente hoy, NCM 8713.10.00).

Metodología: búsqueda web sobre fuentes oficiales (AFIP, Mercosur, notas
explicativas del Sistema Armonizado) y agregadores de clasificación arancelaria
(Argentina y Brasil — el NCM es común a los 4 países del Mercosur a nivel de
8 dígitos, así que un código confirmado en Brasil es, en principio, válido
también para Argentina, salvo excepciones puntuales). **No se consultó
directamente el arancel integrado de AFIP ni IA40/Cobus** porque no hay acceso
automatizado a esas fuentes desde esta sesión — la confirmación final para las
categorías de confianza baja/media queda pendiente (ver sección
"Cómo verificar" al final).

## Tabla resumen

| Categoría | Slug propuesto | NCM elegido | Confianza | Alternativas si el elegido no trae datos |
|---|---|---|---|---|
| Sillas de Ruedas Eléctricas | `sillas_ruedas_electricas` | **8713.90.00** | Confirmado con sync real (474 filas) | — |
| Andadores | `andadores` | ~~9021.10.00~~ → **9021.10.10** | Confirmado por el usuario + sync real (2577 filas). 9021.10.00 dio 0 filas. | — |
| Bastones | `bastones` | **6602.00.00** | Confirmado con sync real (737 filas) | — |
| Almohadones Ortopédicos | `almohadones_ortopedicos` | ~~9021.10.00~~ → **9404.90.00** | Confirmado con sync real (2300 filas). 9021.10.00 dio 0 filas. | — |
| Sillas de Ducha | `sillas_ducha` | **9401.79.00** | Confirmado con sync real (3295 filas) | — |
| Elevadores de Inodoro | `elevadores_inodoro` | **3922.20.00** | Confirmado con sync real (1702 filas) | — |
| Camas Hospitalarias | `camas_hospitalarias` | **9402.90.20** | Confirmado con sync real (312 filas) | — |

**Actualización 15/07/2026 (post primer sync real):** de los 8 códigos originales, 2 dieron 0 filas
(Andadores y Almohadones Ortopédicos, ambos con 9021.10.00) y se corrigieron con los códigos de
arriba (9021.10.10 confirmado por el usuario; 9404.90.00 era la alternativa ya documentada). Los
otros 6, incluidas las 3 categorías marcadas originalmente "confianza baja" (Sillas de Ducha,
Elevadores de Inodoro, y Almohadones ya corregido), resultaron correctos con datos reales.

## Detalle por categoría

### Sillas de Ruedas Eléctricas — NCM 8713.90.00 (Alta)
Partida 87.13: "Sillones de ruedas y demás vehículos para inválidos, incluso
con motor u otro mecanismo de propulsión". Subdivisión:
- 8713.10.00 — sin mecanismo de propulsión (la que ya usa la categoría
  "Sillas de ruedas" existente).
- 8713.90.00 — las demás (con motor u otro mecanismo de propulsión) → **esta
  es la que corresponde a eléctricas**.

Nota: los scooters de movilidad con columna de dirección separada y regulable
NO entran acá, van a la partida 87.03.

### Andadores — NCM 9021.10.00 (Media-alta)
Partida 90.21: "Artículos y aparatos de ortopedia...". La nota explicativa
del Sistema Armonizado menciona expresamente "marcos para andar (andadores)"
como ejemplo dentro de esta partida. No pude confirmar si Argentina subdivide
más allá de los 8 dígitos base (Brasil sí lo subdivide en 9021.10.10 /
9021.10.91 / 9021.10.99 para distintos artículos ortopédicos, pero no está
claro cuál de esas subdivisiones aplicaría a un andador específicamente).

### Bastones — NCM 6602.00.00 (Alta)
Partida 66.02: "Bastones, bastones-asiento, látigos, fustas y artículos
similares". La nota explicativa incluye expresamente "bastones para
invidentes o personas de edad avanzada" como ejemplo de esta partida — por
eso NO es 90.21 (esa partida es para muletas, no bastones de apoyo simple).
Si en algún momento se necesita trackear **muletas** en vez de bastones, esas
sí van en 90.21.10.

### Almohadones Ortopédicos (antiescaras) — NCM 9021.10.00 (Baja)
Clasificación genuinamente disputada: si se considera un aparato ortopédico
(porque compensa una condición médica, ej. prevención de escaras) va en
90.21.10; si se considera un simple cojín/almohadón relleno, va en 94.04.90
("los demás artículos de cama y similares"). La clasificación real depende
del diseño exacto del producto (con celdas de aire, gel, etc. vs. espuma
simple) y es un tipo de consulta que AFIP resuelve por dictamen caso a caso.

### Sillas de Ducha — NCM 9401.79.00 (Baja)
Tres candidatos, sin un criterio uniforme encontrado en la búsqueda:
- 94.01 (asientos) si se toma como mueble — dentro de 94.01, 9401.71.00
  (con armazón de metal) o 9401.79.00 (con armazón de otras materias, ej.
  aluminio, que es lo más común en sillas de ducha).
- 90.21.10 si se considera aparato ortopédico por estar diseñada
  específicamente para personas con discapacidad/movilidad reducida.

### Elevadores de Inodoro — NCM 3922.20.00 (Baja)
- 39.22.20.00 ("artículos sanitarios de plástico") si es un asiento elevador
  de plástico simple, que es el caso más común en el mercado argentino.
- 90.21.10 si se considera aparato ortopédico.

### Camas Hospitalarias — NCM 9402.90.20 (Alta el código base, falta confirmar sufijo AR)
Partida 94.02: "Mobiliario para medicina, cirugía, odontología o veterinaria
...camas con mecanismo para uso clínico...". El código 9402.90.20 ("camas
dotadas de mecanismos para usos clínicos") está confirmado en fuentes
brasileñas de NCM; como el NCM es común a nivel de 8 dígitos en el Mercosur,
debería aplicar igual en Argentina, pero no encontré una fuente 100%
argentina que lo confirme textualmente.

## Cómo verificar las de confianza baja/media

La forma más confiable de confirmar estos códigos es la misma que ya usa el
proyecto para todo lo demás: buscar en IA40/Cobus un puñado de despachos
reales con la descripción de producto esperada (ej. "almohadón antiescaras",
"silla de ducha", "elevador de inodoro") y ver qué NCM declararon los
despachantes en la práctica. Si un código no trae ningún resultado real, es
señal de que hay que probar con la alternativa.

## Fuentes consultadas
- https://www.acavir.com/comercio-exterior/sistema-armonizado/notas-explicativas/partida-8713
- https://www.eaduana.com/sistema-armonizado/notas-explicativas/partidas/partida-9021
- https://www.eaduana.com/sistema-armonizado/notas-explicativas/partidas/partida-6602
- https://www.eaduana.com/sistema-armonizado/notas-explicativas/partidas/partida-9402
- https://tributos.io/ncm/classificacao/item/94029020-camas-dotadas-de-mecanismos-para-usos-clinicos
- https://www.argentina.gob.ar/sites/default/files/nomenclatura_comun_del_mercosur_ncm.pdf
