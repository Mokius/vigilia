# VIGILIA — Diseño sonoro, música y pipeline de assets

## Filosofía: el sonido ES el juego

El terror aquí no se ve, se oye. La linterna sólo ilumina un cono; el resto es
negro. La única forma de saber dónde está la amenaza es **escucharla y orientar la
luz hacia ese sonido**. Por eso el audio es espacial y direccional, y por eso todo
está **sintetizado en tiempo real con la Web Audio API** (`audio/audioBus.js`):
cero archivos, cero licencias, control total de la mezcla y del paneo.

### Paneo = dirección en la tira física
La tira es, físicamente, `IZQUIERDA | FRENTE | DERECHA`. Un `StereoPannerNode` por
evento mapea la dirección al altavoz correcto:

| Origen | pan | Se oye en |
|---|---|---|
| Puerta (pared izquierda) | −0.95 | altavoz/pantalla izquierda |
| Rejilla / frente | ~0 | frente |
| Ventana (pared derecha) | +0.95 | derecha |
| Esquinas | ±0.6 | flanco correspondiente |

Los sonidos "lejanos / a tu espalda" se ensanchan y se filtran con paso-bajo
(`muffle`) para sentirse fuera de cámara. La mezcla se comprime (compresor máster)
y el screamer **agacha (ducking)** todo lo demás 1,3 s.

### Paleta sonora sintetizada (qué es cada sonido y cómo se construye)
- **Dron ambiente**: 3 osciladores graves desafinados (55 / 55.2 / 82.4 Hz) +
  sub-seno (36.7 Hz) a través de un paso-bajo con LFO lento (0.06 Hz) → colchón
  industrial que respira. Wash de ruido marrón por encima.
- **Capa de tensión**: cúmulo disonante (220/233/466/590 Hz) por banda-pasa; su
  ganancia sube con la cercanía de la amenaza (`setTension`).
- **Latido**: doble golpe seno 60→34 Hz; el BPM sube con la tensión (55→125).
- **Pasos**: ruido por banda-pasa 190 Hz (impacto) + seno 70→45 Hz (peso).
- **Golpes**: seno 120→55 Hz + click de ruido banda-pasa 900 Hz.
- **Respiración**: ruido banda-pasa 480 Hz con envolvente inhala/exhala.
- **Susurros**: ruido banda-pasa Q alto barriendo 900→2600 Hz + trémolo (sílabas).
- **Arrastre metálico**: diente de sierra deslizando + resonancia banda-pasa 2400 Hz.
- **Screamer**: cúmulo de sierras desafinadas cayendo en tono + sub 130→38 Hz +
  ráfaga de ruido, todo por un `WaveShaper` (distorsión tanh). Breve y fortísimo.
- **Sub-boom**: seno 90→30 Hz para "puntuar" un destierro o el amanecer.

---

## Propuesta musical / prompts para herramientas IA (opcional)

El motor **no necesita** estos archivos (todo es sintético), pero si se quiere una
capa musical más rica y con derechos propios, aquí van prompts listos. Colócalos en
`assets/audio/` y engánchalos como `AudioBufferSourceNode` en el bus.

### Suno (música/atmósfera — pedir instrumental, loopable)
1. **Colchón ambiente (loop 2–3 min)**
   > *dark ambient horror drone, sub-bass rumble, detuned metallic resonances,
   > distant industrial groans, no melody, no drums, slow evolving, tense,
   > claustrophobic, cinematic, seamless loop, instrumental*
2. **Riser de tensión (15–20 s)**
   > *rising horror tension riser, dissonant string cluster crescendo, swelling
   > sub-bass, metallic scrapes, builds to a sudden cut, no beat, cinematic*
3. **Amanecer / superviviente (30 s)**
   > *fragile relief ambient, single sustained warm pad emerging from silence,
   > distant dawn tone, hopeful but exhausted, cinematic, instrumental*

### ElevenLabs (voz / SFX — Sound Effects o Voice Design)
- **Respiración húmeda (SFX)**: *"wet ragged breathing in the dark, close-mic,
  irregular, inhuman, unsettling"*
- **Susurro sin palabras (Voice Design, luego pitch/formant)**: *"a dry whispering
  voice with no words, sibilant, layered, coming from behind you"*
- **Arañazo metálico (SFX)**: *"long metal claw dragging slowly across a steel
  pipe, reverberant industrial room"*
- **Grito del screamer (SFX)**: *"sudden distorted inhuman shriek, layered scream
  with sub-bass drop, very short, terrifying"* (mézclalo por debajo del screamer
  sintético para reforzarlo, no para sustituirlo).

> Reglas: instrumental, loopable donde aplique, sin música con derechos de
> terceros. Normalizar a −16 LUFS aprox. y dejar picos con headroom para el ducking.

---

## Pipeline de assets

**Estado actual: 100 % procedural, cero archivos.** Justificación: es una
instalación física; no debe depender de un CDN ni de descargas en el momento del
evento, y evita cualquier problema de IP.

- **Texturas (PBR)**: `world/textures.js` genera hormigón, metal y óxido por fBm de
  ruido de valor sobre un canvas; el *normal map* se deriva por gradiente Sobel del
  heightfield → la luz rasante revela relieve real. Albedo + roughness + normal.
- **Geometría**: primitivas Three.js + `InstancedMesh` para props repetidos (tubos,
  cajas). La sala, la puerta, la ventana y la rejilla se construyen en `room.js`.
- **Enemigos**: modelos procedurales por primitivas con ojos emisivos (`enemy.js`).
- **Partículas**: polvo por GPU (`THREE.Points` con shader) que sólo brilla dentro
  del cono de la linterna.
- **Audio**: sintetizado (arriba).

### Ruta de mejora (si se quiere subir el techo visual)
1. **Modelos de enemigo esculpidos** (Blender / IA 3D → `.glb`, `< 2 MB`, con
   materiales oscuros y ojos emisivos). `enemy.js` ya crea el modelo por *tipo*:
   basta cambiar `buildModel()` para cargar un `.glb` por `type.model`.
2. **Texturas 4K** generadas por IA (p. ej. difusión → albedo/normal/roughness) para
   paredes y props hero, manteniendo el resto procedural.
3. **Música** de Suno/ElevenLabs (prompts arriba) como capa opcional sobre el dron.

Todo asset añadido va a `assets/` y se vendoriza en el repo (nada de CDN en runtime).
