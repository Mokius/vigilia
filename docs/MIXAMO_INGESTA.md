# Ingesta de assets Mixamo → VIGILIA

Pipeline **ya construido y validado** (Blender 4.5.8 + `tools/mixamo_to_glb.py`).
Prueba de funcionamiento: 3 FBX sintéticos → 1 GLB con 3 clips nombrados,
cargado y reproducido por three.js con `AnimationMixer`. Solo faltan los FBX reales.

## Por qué los descargas tú
Mixamo exige sesión de Adobe (su API devuelve **403** sin autenticar) y yo no
puedo introducir tus credenciales. Además, descargándolos con tu cuenta la
licencia de Mixamo queda **a tu nombre**, que es lo correcto para un proyecto
de cliente (Ubicuity). Son ~5 minutos.

## Paso 1 — Personajes (3 descargas)
En https://www.mixamo.com → pestaña **Characters**, busca y descarga:

| Personaje | Rol en el juego | Guardar como |
|---|---|---|
| **Romero** | Animatrónico/zombi principal | `romero.fbx` |
| **Parasite L Starkie** | La criatura del conducto (crawler) | `parasite.fbx` |
| **Drake** | Variante corpulenta / segundo acechador | `drake.fbx` |

Ajustes del diálogo **Download**:
- **Format:** `FBX Binary (.fbx)`
- **Pose:** `T-pose`

## Paso 2 — Animaciones (1 descarga)
Pestaña **Animations** → busca **`Scary Zombie Pack`** → selecciónalo → **Download**:
- **Format:** `FBX Binary (.fbx)`
- **Skin:** `Without Skin`  ← **importante**
- **Frames per Second:** `30`
- **Keyframe Reduction:** `none`

Da un **ZIP** con un FBX por animación. Descomprímelo.

> Las animaciones "Without Skin" usan el rig estándar de Mixamo, así que **el
> mismo pack sirve para los tres personajes** — no hace falta repetir la descarga.

## Paso 3 — Colocar los ficheros
```
cube-horror/assets/mixamo/raw/
├── romero.fbx
├── parasite.fbx
├── drake.fbx
└── anims/                  ← todos los .fbx del Scary Zombie Pack aquí
    ├── Zombie Idle.fbx
    ├── Zombie Scream.fbx
    └── ...
```

## Paso 4 — Un comando
```bash
bash tools/build_models.sh
```
Genera `assets/models/{romero,parasite,drake}.glb`, cada uno con **todas** las
animaciones del pack incrustadas. Los nombres de clip salen del nombre de
fichero (`Zombie Scream.fbx` → clip `Zombie_Scream`), que es como los busca el
juego.

## Notas técnicas
- El script normaliza la altura (Mixamo exporta en cm) y apoya los pies en `y=0`.
  Alturas por defecto: Romero 1.85 m, Drake 1.9 m, Parasite 1.5 m (ajustables).
- Cada acción se aparca en su propia pista NLA y se exporta con
  `export_animation_mode='ACTIONS'` → un `gltf.animations[]` por clip.
- Sin Draco (evita depender de un decoder externo en el navegador).
- Reutilización para el **screamer**: el mismo personaje sirve para el susto
  (clip de grito/ataque a bocajarro), así no hay incoherencia visual.

## Licencia (importante para cliente)
Mixamo permite uso de personajes y animaciones en proyectos, pero **no**
redistribuirlos como assets sueltos. El repo `Mokius/vigilia` es **público**:
los `.glb` quedarían descargables. Opciones:
1. Pasar el repo a **privado** y servir por Vercel (recomendado para cliente), o
2. Servir los modelos desde almacenamiento privado del player/instalación.

Decisión tuya; lo dejo señalado antes de subir nada.
