# VIGILIA — El Turno de Noche · Arquitectura técnica

Experiencia de terror inmersiva para el **Cubo de Ubicuity** (U-Box: 3 paredes +
suelo, 3 × 3 × 2,5 m). Un solo `index.html`, sin build, Three.js r160 vendido en
local (`vendor/three.module.js`). Todo el contenido es **procedural** (geometría,
texturas PBR, audio) — cero assets de terceros, cero problemas de IP con FNAF.

> **Concepto**: el jugador está inmóvil dentro de una sala de mantenimiento
> abandonada. Su única herramienta es una linterna (= el cursor). Algo se mueve
> en la oscuridad — sólo lo oyes. Debes iluminarlo antes de que llegue. Si tardas,
> salta.

---

## 1. El insight que define todo: es un CAVE, no 4 pantallas planas

Las 4 superficies del cubo se sirven como **una sola tira horizontal en un único
canvas**: `[ IZQUIERDA ][ FRENTE ][ DERECHA ][ SUELO ]`, cada panel `25vw × 100vh`
(reutiliza el modelo de `realsociedad`). En vez de dibujar 4 escenas planas,
montamos **una única habitación 3D** y la miramos con **4 cámaras de proyección
descentrada (off-axis)**, una por superficie física, todas compartiendo el mismo
punto de ojo (el operador en el centro del cubo).

Esto es la **proyección general de Kooima (2009)**, la que usan los CAVE reales.
Dos consecuencias que resuelven requisitos del brief **por construcción**:

1. **Costuras invisibles.** El plano-imagen de cada cámara *es* esa pared física.
   Como paredes contiguas comparten una arista real (la esquina de la sala), las
   4 imágenes empalman sin costura. Verificado: iluminando la esquina, pared
   izquierda = 144 y pared frontal = 147 de brillo (idénticas → sin salto).
2. **La linterna "salta" al suelo sola.** La linterna es un `SpotLight` real que
   rota en la sala. Al barrer hacia abajo por una pared, el haz físicamente cae
   sobre el suelo y la cámara del suelo lo recoge. No hay teletransporte de cursor
   ni casos especiales: el mundo es continuo, así que el haz también.

### La matemática (en `engine/caveRig.js`)

Sala en metros, origen en el centro del suelo, `-Z` = frente, `+Y` = arriba:

```
Suelo   y=0     x∈[-1.5,1.5]  z∈[-1.5,1.5]     (3×3, ratio 1:1)
Frente  z=-1.5  x∈[-1.5,1.5]  y∈[0,2.5]        (3×2.5, ratio 1.2:1)
Izqda   x=-1.5  z∈[-1.5,1.5]  y∈[0,2.5]
Dcha    x=+1.5  z∈[-1.5,1.5]  y∈[0,2.5]
Ojo     E = (0, 1.6, 0)
```

Para cada pantalla, con esquinas `pa`(abajo-izq), `pb`(abajo-dcha), `pc`(arriba-izq):

```
vr = norm(pb-pa)          // eje derecha de la pantalla
vu = norm(pc-pa)          // eje arriba
vn = norm(vr × vu)        // normal, apunta hacia el ojo
va,vb,vc = pa-E, pb-E, pc-E
d  = -va·vn               // distancia ojo→plano de pantalla
n,f = near, far
l = (vr·va)·n/d   r = (vr·vb)·n/d
b = (vu·va)·n/d   t = (vu·vc)·n/d
projectionMatrix = frustum(l,r,t,b,n,f)         // asimétrico (off-axis)
orientación cámara: ejes locales (vr, vu, vn), posición = E
```

Las esquinas se eligen para que **compartan arista**: `IZQUIERDA.pb == FRENTE.pa`
(esquina frontal-izquierda) y `DERECHA.pa == FRENTE.pb` (frontal-derecha). El suelo
se orienta con su "arriba" hacia el frente (−Z) para que su borde superior continúe
el borde inferior de la pared frontal.

### Rasterizado (1 contexto, 4 viewports)

Un `WebGLRenderer`, una escena, 4 viewports con *scissor* en la tira. El **suelo
sólo se dibuja en el 70 % superior de su panel** (`--floor-cover`, el proyector de
suelo del U-Box no cubre todo el panel); el resto queda negro. La sombra del
`SpotLight` se calcula **una vez por frame** (`shadowMap.autoUpdate=false` +
`needsUpdate=true`) y los 4 viewports la reutilizan → coste de sombra ×1, no ×4.

### Modos de despliegue
- **Tira única** (embebido como UbiApp en un iframe): modo por defecto. **Es el
  target de entrega.**
- **`?surface=left|front|right|floor`**: un proyector = una superficie a pantalla
  completa. `EventBus` sincroniza estado entre ventanas por `BroadcastChannel`
  (patrón heredado de `realsociedad`) para setups de una máquina → varios proyectores.

---

## 2. Hallazgo técnico clave: SpotLight + render target

Durante la integración detecté que, **en el WebGL del entorno de preview
(probablemente SwiftShader/ANGLE)**, un `SpotLight` ilumina correctamente al
renderizar **directo a pantalla**, pero **no aporta nada al renderizar la escena a
un render target** (un `PointLight` sí). Verificado con lecturas de píxel:
cámara frontal → pantalla = `[223,207,183]`; misma cámara → FBO = `[0,0,0]`.

**Decisión de arquitectura (mejor, además de robusta):** la escena se renderiza
**siempre directo a pantalla** (donde el SpotLight es fiable en cualquier driver) y
el post-proceso se hace sobre una **copia del framebuffer**
(`copyFramebufferToTexture`), no re-renderizando la escena a un RT. Ningún
geometría iluminada toca nunca un RT; sólo pasadas pantalla-completa
textura→textura (bloom, composición). Portable y más barato.

(Bug relacionado: el emisivo de `MeshStandardMaterial` también salía negro en este
pipeline; los ojos de los enemigos usan `MeshBasicMaterial` con `toneMapped:false`
→ brillan siempre y alimentan el bloom.)

---

## 3. Mapa de módulos (desacoplado, ampliable)

```
src/
  config.js            Fuente única de verdad: sala, pantalla, render, atmósfera,
                       linterna, gameplay, audio. Nada de números mágicos sueltos.
  core/
    util.js            clamp/lerp/damp, PRNG determinista (mulberry32)
    events.js          EventBus síncrono + espejo BroadcastChannel
  engine/
    caveRig.js         4 cámaras off-axis + render multi-viewport (la sección 1)
    postFX.js          Post sobre el framebuffer: bloom (umbral+blur separable) →
                       viñeta → aberración cromática → grano → tinte de susto
  world/
    textures.js        PBR procedural: hormigón/metal/óxido por fBm de ruido de
                       valor; normal map derivado por gradiente Sobel del heightfield
    room.js            Sala de mantenimiento: paredes/suelo/techo, PUERTA (izq),
                       VENTANA (dcha), REJILLA (frente), props instanciados
                       (tubos, cajas), mesa+monitor, lámpara rota. Expone
                       `spawnAnchors` (dónde salen los enemigos + su pan de audio)
    flashlight.js      SpotLight (sombras dinámicas, penumbra, falloff físico) +
                       cono volumétrico (shader aditivo, ruido 3D, occluido por
                       geometría) + motas de polvo GPU que sólo brillan en el haz +
                       parpadeo por batería
  input/
    input.js           Ratón (pointer lock → yaw/pitch, barrido continuo pared↔suelo)
                       y táctil (absoluto: tocas un panel, iluminas ese punto)
  audio/
    audioBus.js        Web Audio 100% sintético. Bus maestro→compresor. Dron
                       ambiente + capa de tensión. Cues: pasos, golpes, respiración,
                       susurros, arrastre metálico, grito/screamer, sub-boom,
                       latido por tensión. Paneo estéreo = dirección en la tira.
  ai/
    enemyTypes.js      Roster data-driven (añade un bicho = añade una entrada) +
                       curva de dificultad por noche
    enemy.js           Modelo procedural (silueta casi negra + ojos que brillan) +
                       máquina de estados LURK→(observado)→BANISHED / →ATTACK
    enemyManager.js    Spawns con PRNG por noche, ocupación de anchors, dificultad,
                       "tensión" = amenaza más cercana
  ui/
    ui.js              Menú cinematográfico (SÓLO panel frontal), HUD diegético,
                       screamer a pantalla completa (flash + cara SVG + shake),
                       pantallas de fin (sobrevives / te atrapan)
  systems/
    game.js            Game Manager: MENU→PLAYING→(SCARE→END)|(sobrevives→END).
                       Enruta eventos de IA a audio (IA nunca importa audio)
  main.js              Bootstrap + bucle: input→linterna→game→render directo→post
```

### Bucle por frame
```
input.update()                        → dirección de la linterna
flashlight.update(dt,t)               → suaviza aim, batería, cono, polvo
game.update(dt)                       → timer, IA, tensión→audio, susto, fin
shadowMap.needsUpdate = true
rig.render(renderer, scene, null)     → 4 viewports directo a pantalla
postFX.process(t, scareFX)            → bloom/viñeta/grano sobre la copia
```

---

## 4. IA de enemigos (modular)

Cada tipo (`enemyTypes.js`) define: modelo, velocidad, tiempo de luz para
desterrarlo, cadencia y set de sonidos, paleta de ojos, anchors que usa, peso de
aparición y noche mínima. Máquina de estados por enemigo:

- **LURK**: emite cues direccionales; avanza en pasos discretos *mientras no lo
  iluminas*. Si el haz se mantiene sobre él el tiempo de su `banishTime` → **BANISHED**
  (retrocede). Si su temporizador de avance vence sin luz → se acerca un paso.
- **ATTACK**: llega al jugador → **screamer** (grito sintetizado + cara + flash + shake).

Roster inicial: `watcher` (El Vigía, puerta/esquinas), `crawler` (conducto),
`peeker` (tras el cristal), `runner` (rápido, noche 3+). Dificultad por noche:
más enemigos simultáneos, spawns más frecuentes, avance más rápido.

---

## 5. Decisiones justificadas

- **Off-axis CAVE** en vez de 4 escenas planas → costuras y salto al suelo gratis
  y físicamente correctos. Es el único enfoque que hace sentir "una sala", no
  "cuatro pantallas".
- **Post sobre framebuffer** en vez de sobre un RT de escena → robusto ante el bug
  SpotLight+FBO y más barato (una sola pasada de escena).
- **Se omiten SSAO y DoF a propósito.** En una escena casi negra iluminada por un
  cono, su coste no compra inmersión visible. Prioridad: sombras dinámicas nítidas,
  cono volumétrico, bloom sutil, grano y viñeta — cada efecto se gana su coste
  (requisito del brief: "cada efecto debe aumentar la inmersión").
- **Todo procedural** → sin dependencias de assets ni de CDN en la instalación;
  cero riesgo de IP; el tamaño del repo es mínimo.

## 6. Limitaciones honestas / trabajo futuro
- Los enemigos son primitivas procedurales: leen muy bien como **silueta + ojos +
  glimpse** (el uso real) y en el screamer se usa una **cara SVG** dedicada; a
  bocajarro y plenamente iluminados se ven simples. Un `.glb` esculpido por bicho
  sería el siguiente salto de calidad (el pipeline ya carga modelos por tipo).
- Calibración de aspecto: los cálculos son exactos para una tira 4.8:1 (4 paneles
  1.2:1). Si las pantallas físicas tienen otro ratio, ajustar en `config.js` y/o
  dejar que el warp/blend del player (autowarp) haga la geometría final.
- Sincronía multi-máquina (un PC por proyector) requeriría un líder que emita
  estado por red; el patrón `BroadcastChannel` ya cubre el caso de una máquina.
