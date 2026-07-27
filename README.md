# VIGILIA — El Turno de Noche

Experiencia de **terror inmersivo** para el Cubo de Ubicuity (U-Box: 3 paredes +
suelo). Inspirada en la tensión de *Five Nights at Freddy's* pero **100 % original
y procedural** — sin assets ni IP de terceros.

Estás inmóvil en una sala de mantenimiento abandonada. Tu única arma es una
**linterna** (el cursor). Todo está a oscuras salvo donde apuntas. Algo se mueve
en la negrura: lo **oyes** antes de verlo. Ilumínalo a tiempo y desaparece; tarda
demasiado y **salta**.

![hero](docs/cube_hero.jpg)

## Cómo funciona
- **Un canvas, 4 pantallas**: una sala 3D vista por **4 cámaras off-axis** (CAVE de
  Kooima) → costuras invisibles y la linterna cae al suelo sola. Ver
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Linterna real**: `SpotLight` con sombras dinámicas, penumbra, falloff físico,
  cono volumétrico, polvo GPU, parpadeo por batería.
- **Audio espacial 100 % sintético** (Web Audio): el sonido viene de la pantalla
  donde ocurre. Ver [docs/AUDIO_AND_ASSETS.md](docs/AUDIO_AND_ASSETS.md).
- **IA modular** de enemigos: detectar → avanzar en la oscuridad → desterrar con la
  luz o **screamer** al llegar.
- **Post**: bloom, viñeta, grano de película, aberración cromática, ACES.

## Controles
- **Ratón**: mueve la linterna (clic para capturar el puntero). El haz barre
  paredes ↔ suelo sin cortes.
- **Táctil**: toca cualquier panel para iluminar ese punto.

## Ejecutar en local
```bash
node serve.mjs   # → http://localhost:8770
```
Sin build. Three.js r160 va vendido en `vendor/`.

## Embeber como UbiApp (iframe)
```html
<iframe src="https://<tu-deploy>.vercel.app/"
        allow="fullscreen; autoplay; pointer-lock"
        style="width:100%;height:100%;border:0"></iframe>
```
Modo por defecto = tira de 4 paneles. Un proyector por superficie:
`?surface=left|front|right|floor`.

## Estructura
```
index.html · serve.mjs · vendor/three.module.js
src/{config,main}.js · src/core · src/engine · src/world · src/input
    · src/audio · src/ai · src/ui · src/systems
docs/{ARCHITECTURE,AUDIO_AND_ASSETS}.md
```
