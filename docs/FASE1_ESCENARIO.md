# FASE 1 — Diseño completo del escenario (antes de implementar)

**Premisa arquitectónica.** El jugador es el vigilante nocturno de una planta
industrial clausurada. Ocupa la **caseta de control**: un cubículo de hormigón y
chapa de 3 × 3 × 2,5 m encajado dentro de una nave mayor. No es un decorado:
cada apertura existe porque un edificio real la necesitaría — una puerta de
acceso, un pasillo de servicio, un ventanuco a la sala de máquinas contigua, un
conducto de climatización y un registro de saneamiento en el suelo. **Esas cinco
aperturas son, exactamente, las cinco vías de entrada del enemigo.** La
arquitectura ES el diseño de juego.

**Por qué la sala mide justo lo que mide el cubo.** El U-Box es 3 × 3 × 2,5 m y
las 4 cámaras off-axis tienen su plano-imagen sobre cada pared física. Si la sala
virtual midiera otra cosa, la perspectiva mentiría. Por tanto: **sala virtual =
cubo físico**, y toda la profundidad se consigue **más allá** de las aperturas
(pasillo, huecos, conductos). Es lo que hace que el sitio parezca grande sin
romper la proyección.

---

## 1. Sistema de coordenadas y cotas

Origen en el centro del suelo. `+X` = derecha, `+Y` = arriba, **`−Z` = frente**.

| Magnitud | Valor | Nota |
|---|---|---|
| Sala | X ∈ [−1,5 , 1,5] · Y ∈ [0 , 2,5] · Z ∈ [−1,5 , 1,5] | = U-Box real |
| Ojo del jugador | (0 · 1,60 · 0) | vértice CAVE, sentado/de pie quieto |
| Pared FRENTE | z = −1,5 | pantalla frontal |
| Pared IZQUIERDA | x = −1,5 | pantalla izquierda |
| Pared DERECHA | x = +1,5 | pantalla derecha |
| Suelo | y = 0 | pantalla suelo (solo 70 % superior del panel) |
| Techo | y = 2,5 | visible solo de refilón |
| **Pared TRASERA (z = +1,5)** | — | **NO se ve nunca** (no hay pantalla trasera) |

> **Decisión de presupuesto:** la pared trasera no tiene pantalla, así que no
> recibe props ni detalle — solo lo justo para que las sombras proyectadas hacia
> atrás tengan contra qué caer. Todo el gasto de geometría va a IZQ/FRENTE/DCHA/SUELO.

---

## 2. Elementos, cota por cota, con justificación

### 2.1 FRENTE (z = −1,5) — el pasillo de servicio
| Elemento | Posición / tamaño | Justificación |
|---|---|---|
| Vano del pasillo | centrado, 1,30 ancho × 2,15 alto | Acceso principal a la nave. Da **profundidad real** a la pantalla protagonista. |
| Pasillo | 3,2 m hacia −Z (hasta z = −4,7) | Permite la conducta "cruzar el pasillo" y aproximaciones largas y legibles. |
| Puertas laterales del pasillo | z = −2,6 y z = −3,7, ambos lados, 0,55 × 1,50 | Sugieren que la planta continúa. Escondites intermedios. |
| Luz de salida (roja) | z = −4,7, y ≈ 1,1 | Backlight: **silueta a contraluz** al fondo del pasillo. El recurso más barato y más eficaz de terror. |
| Rejilla de ventilación | x = −0,90 · y = 0,60 · 1,00 × 0,68 | Climatización. Baja y descentrada → obliga a bajar la linterna. |
| Reloj de pared | x = 0 · y = 2,28 | **HUD diegético**: marca 00:00 → 06:00. Sustituye la barra de tiempo. |
| Panel eléctrico + CRT | x = +1,05 · y = 1,45 | Soporte del **menú diegético** (§6). |

### 2.2 IZQUIERDA (x = −1,5) — la puerta y su rendija
| Elemento | Posición / tamaño | Justificación |
|---|---|---|
| Puerta industrial | z = +0,35 · 1,08 × 2,12 · retranqueo 1,0 m | Acceso de personal. Batiente hacia dentro, bisagra izquierda. |
| Apertura en reposo | 32° entreabierta | Genera la **rendija**: el hueco por donde se ven dos ojos antes que un cuerpo. |
| Estantería metálica | z = −0,85 · 0,9 alto | Rompe la pared, crea **zona de sombra** y ocluye parcialmente. |
| Celda de batería | z = +0,95 · y = 1,25 | §5. |

### 2.3 DERECHA (x = +1,5) — el ventanuco roto
| Elemento | Posición / tamaño | Justificación |
|---|---|---|
| Ventana de observación | z = −0,15 · hueco 1,30 × 0,95 · centro y = 1,20 | Comunicaba con la sala de máquinas. **Está reventada** = es la brecha. |
| Alféizar | y = 0,62 · profundidad 0,28 | Superficie de apoyo: el enemigo **pasa una pierna por encima**. Lectura instantánea. |
| Vidrios astillados en el marco | perímetro | Cuentan que la rotura es antigua y violenta. |
| Cajas apiladas | z = +1,0 | Escondite lateral + sombra. |
| Celda de batería | z = +0,50 · y = 1,45 | §5. |

### 2.4 SUELO (y = 0) — el registro
| Elemento | Posición / tamaño | Justificación |
|---|---|---|
| Registro/arqueta con rejilla | (0,55 · 0,45) · 0,80 × 0,80 · foso 0,6 | Saneamiento. Justifica que **algo salga del suelo** — usa la 4ª pantalla como amenaza, no como decorado. |
| Franja de peligro pintada | delante del vano, z = −1,15 | Señalética industrial: da escala y lectura de "umbral". |
| Suciedad/charcos | dispersos | Humedad; los charcos **devuelven el reflejo de la linterna**. |

### 2.5 Techo y servicios
Tubos a x = −1,15 / +1,05 / +1,25 (y = 2,37) · fluorescente en (0 · 2,45 · 0,40)
· cables colgando en z = +0,90. Los tubos **cortan la luz** y proyectan barras de
sombra móviles al barrer la linterna: movimiento en la periferia = tensión gratis.

### 2.6 Zonas de sombra (dónde puede "vivir" un enemigo sin ser visto)
`S1` esquina frente-izquierda (−1,35 · −1,35) · `S2` esquina frente-derecha
(+1,35 · −1,35) · `S3` boca del pasillo (0 · −1,45) · `S4` tras la estantería
izquierda · `S5` tras las cajas derechas · `S6` bajo la mesa.
**Regla:** ningún enemigo aparece nunca fuera de S1–S6 o de una apertura.

### 2.7 Materiales (coherencia PBR)
| Superficie | Material | Acabado |
|---|---|---|
| Suelo | hormigón pulido sucio | rugosidad alta, charcos con rugosidad baja |
| Paredes | chapa atornillada sobre hormigón | metalness 0,5 · goterones verticales |
| Techo | hormigón encofrado | manchas de humedad |
| Puertas / marcos / alféizar | acero pintado desgastado | metalness 0,6 |
| Tubos / arqueta / rejillas | acero oxidado | óxido en aristas |
| Personajes | piel/tejido húmedo | oscuro, rugosidad 0,6, ligero especular = "mojado" |

---

## 3. Iluminación

| Fuente | Tipo | Intensidad | Papel |
|---|---|---|---|
| Linterna | SpotLight + sombras | 55 · ángulo 0,40 · penumbra 0,52 | **Única luz fiable.** Es el cursor. |
| Emergencia roja | PointLight pared dcha | 3,4 · alcance 6,5 | Piso mínimo de lectura: nunca negro absoluto total. |
| Fluorescente | PointLight techo | 0 ↔ 20-42 a ráfagas | **Revelados** de 30-130 ms. Enseña la sala entera un instante. |
| Salida del pasillo | PointLight rojo al fondo | 1,4 | Contraluz para siluetas. |
| Celdas de batería | PointLight verde | 0,9 | Baliza localizable. |
| Ambiente | AmbientLight | 0,13 | Evita el negro aplastado. |

**Regla de oro:** la sala es legible **solo** a ráfagas. En reposo, el jugador
ve un 15 % del espacio. Esa asimetría entre lo que sabe y lo que ve es el miedo.

---

## 4. Enemigos: rutas, puestas en escena y animaciones

### 4.1 Reparto (Mixamo, ya elegido)
| Personaje | Rol | Aperturas | Altura |
|---|---|---|---|
| **Romero** | acechador principal | puerta IZQ · pasillo · S1/S2 | 1,85 m |
| **Parasite L Starkie** | criatura del conducto | ventilación · arqueta suelo | 1,50 m |
| **Drake** | variante corpulenta | ventana DCHA · pasillo | 1,90 m |

### 4.2 Máquina de estados (sustituye al "avance por pasos" actual)
Nada de teletransportes: cada estado tiene **posición sobre una ruta** y **clip**.

| Estado | Qué se ve | Clip (búsqueda difusa en el pack) |
|---|---|---|
`HIDDEN` | nada; solo audio direccional | — |
`PEEK` | asoma **lentamente** por la puerta / mira por la rendija; solo cara y hombro | `idle` / `look` |
`SLIT` | dos ojos en el hueco, inmóviles | `idle` (congelado) |
`EMERGE` | sale **a medias** de la ventilación / empuja la rejilla del suelo | `crawl` |
`CROSS` | **cruza el pasillo** de lado a lado sin entrar (falsa alarma, puro susto) | `walk` |
`STARE` | quieto en una zona de sombra, mirándote | `idle` |
`STALK` | avanza por la ruta cuando no lo iluminas | `walk` |
`RETREAT` | **retrocede despacio** al ser iluminado | `walk` (timeScale −1) |
`HIDE` | vuelve al escondite y desaparece | `crawl` / `walk` |
`ATTACK` | se abalanza → screamer | `scream` / `attack` |

Enlace de clips por **coincidencia difusa** sobre los nombres reales que imprima
`build_models.sh` (no invento nombres del pack), con fallback a `idle`.

### 4.3 Rutas (waypoints)
- **R1 Puerta IZQ (Romero):** `(−1,18 · 0,35)` rendija → `(−1,05 · 0,20)` asomar
  → `(−0,75 · 0,05)` umbral → `(−0,45 · −0,05)` dentro → ataque.
- **R2 Pasillo (Romero/Drake):** `(0 · −4,2)` silueta a contraluz → `(0 · −3,0)`
  → `(0 · −2,0)` → `(0 · −1,55)` en el vano → `(0 · −0,9)` dentro. *Variante
  `CROSS`: entra por z = −2,4 y sale por el lado opuesto sin acercarse.*
- **R3 Ventilación (Parasite):** dentro del conducto → medio cuerpo fuera
  `(−0,90 · −1,25)` → cae al suelo `(−0,85 · −1,0)` → repta → ataque.
- **R4 Arqueta suelo (Parasite):** empuja la rejilla → asoma `(0,55 · 0,45)` →
  sale → repta.
- **R5 Ventana DCHA (Drake):** cara tras el hueco `(1,42 · −0,15)` → pierna sobre
  el alféizar → dentro `(1,05 · −0,15)` → ataque.

### 4.4 Regla de banish
Iluminar **la cabeza** ≥ `banishTime` (0,45–0,95 s según personaje) → `RETREAT`
→ `HIDE`. Si el haz se va antes, el dwell decae: obliga a **mantener** la luz.

---

## 5. Sistema de batería (rediseño)

Problema actual: recarga infinita por celdas con cooldown → no hay escasez.
**Nuevo modelo = recurso finito.**

| Parámetro | Valor | Razón |
|---|---|---|
| Autonomía a pleno | **~40 s** (2,5 %/s) | Fuerza apagar la linterna constantemente. |
| Apagado manual | tecla / clic | El jugador **elige** quedarse a oscuras. Ahí está la tensión. |
| Baterías físicas | **6 por noche**, colocadas en S1–S6 y repisas | Objeto real, no "estación". |
| Detección | apuntar **1,5 s continuados** | Feedback progresivo: la celda **sube de brillo y late** mientras apuntas → queda claro que la estás apuntando. |
| Recogida | automática al completar | Animación: se eleva, gira y se desvanece + sonido de "clunk + carga". |
| Recarga | **+28 %** (nunca al 100 %) | Parcial a propósito. |
| Reaparición | ninguna (finitas) | Gestión de recursos real. |
| Aviso | a 25 %: parpadeo + zumbido | Ya implementado el parpadeo; se mantiene. |

Total disponible por noche: 100 % inicial + 6 × 28 % = 268 % ≈ **107 s** de luz
para una noche de 150 s → **obliga** a jugar a oscuras ~30 % del tiempo.

---

## 6. Menú principal diegético (prioridad máxima)

**Se elimina toda la UI DOM.** Cero rectángulos, cero botones web.

**Puesta en escena:** un **carro de instrumentación** aparcado en la boca del
pasillo, ocupando el centro de la pantalla frontal. Encima, un **monitor CRT**
encendido; al lado, un **panel eléctrico** con interruptores físicos.

- El **CRT** es una `CanvasTexture` (fósforo verde, scanlines, jitter, quemado de
  imagen) con el título y las opciones. La geometría es un tubo real con cristal
  curvo y reflejo especular.
- **Selección de noche:** cinco **palancas** físicas en el panel; la que está
  arriba es la activa.
- **Empezar:** una **palanca grande** roja con etiqueta serigrafiada.
- **Interacción = la linterna.** Apuntar 1,2 s sobre un control lo activa
  (misma gramática que las baterías → un solo lenguaje de interacción en todo el
  juego). Al apuntar, el control se ilumina y el CRT reacciona.
- **Transición al juego:** el CRT hace *degauss* y se apaga con chasquido, el
  carro **rueda solo** hacia el fondo del pasillo, la luz de emergencia baja y el
  reloj empieza a correr. **No hay corte**: nunca sales del escenario.
- **HUD in-game:** ninguno. El **reloj de pared** da el tiempo y el **propio haz**
  (brillo + parpadeo) da la batería. Fin de partida: el CRT vuelve a rodar hasta
  su sitio y se enciende con el resultado.

---

## 7. Criterios de aceptación de Fase 1 → Fase 2

Firmo la fase cuando:
1. Cada apertura del §2 existe con sus cotas y **se reconoce de un vistazo**
   qué es (puerta / ventana / conducto / arqueta / pasillo).
2. Las 5 rutas del §4.3 son recorribles y **sin saltos de posición** visibles.
3. Los 9 estados del §4.2 tienen clip asignado a partir de los nombres **reales**
   del pack.
4. La batería cumple la aritmética del §5 (medida, no estimada).
5. El menú del §6 no contiene **ningún** elemento DOM.
6. Rendimiento: **≥ 50 fps** con 4 viewports y 2 personajes skinned en pantalla
   (medido; si no, bajar sombras a 1024 y/o simplificar el pasillo).
7. Audio: un oyente colocado a ciegas acierta la apertura ≥ 8/10 veces.

## 8. Orden de implementación (Fase 2)
1. Ingesta de los 3 GLB + binding difuso de clips (bloqueado por tus descargas).
2. Refactor del enemigo a la máquina de estados §4.2 con rutas §4.3.
3. Reconstrucción del escenario §2 (cotas exactas) + materiales §2.7.
4. Batería finita §5.
5. Menú diegético §6 (y borrado de `ui.js` DOM).
6. Screamer con el personaje real + su clip de ataque.
7. Pase de rendimiento y de audio; validación §7.
