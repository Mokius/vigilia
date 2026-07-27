# =============================================================================
# mixamo_to_glb.py — Blender pipeline: Mixamo FBX -> single .glb with all clips.
#
# Takes ONE character FBX (with skin) plus a folder of animation FBX files
# (downloaded "Without Skin"), transplants every animation onto the character's
# armature as a named NLA action, normalizes height, and exports one GLB that
# three.js can load with all animations available on gltf.animations.
#
# Usage:
#   blender -b -P tools/mixamo_to_glb.py -- \
#       --char assets/mixamo/raw/romero.fbx \
#       --anims assets/mixamo/raw/romero_anims \
#       --out assets/models/romero.glb \
#       --height 1.85
#
# --anims may be omitted (exports the character with whatever clip it carries).
# Clip names come from the animation FBX filenames (sanitized).
# =============================================================================
import bpy, sys, os, re, glob, math
from mathutils import Vector


def argv_after_dashes():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def parse_args():
    a = argv_after_dashes()
    out = {'char': None, 'anims': None, 'out': None, 'height': 1.8}
    i = 0
    while i < len(a):
        k = a[i]
        if k in ('--char', '--anims', '--out'):
            out[k[2:]] = a[i + 1]; i += 2
        elif k == '--height':
            out['height'] = float(a[i + 1]); i += 2
        else:
            i += 1
    return out


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    """Import an FBX and return the objects it added."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    return [o for o in bpy.context.scene.objects if o not in before]


def find_armature(objs):
    for o in objs:
        if o.type == 'ARMATURE':
            return o
    return None


def sanitize(name):
    n = os.path.splitext(os.path.basename(name))[0]
    n = re.sub(r'[^A-Za-z0-9]+', '_', n).strip('_')
    # Mixamo exports often prefix files; keep it readable for three.js lookups
    return n or 'clip'


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    found = False
    for o in objs:
        if o.type != 'MESH':
            continue
        found = True
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo.x, lo.y, lo.z = min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)
            hi.x, hi.y, hi.z = max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)
    return (lo, hi) if found else (None, None)


def main():
    args = parse_args()
    if not args['char'] or not args['out']:
        print('!! need --char and --out'); return 1

    reset()
    char_objs = import_fbx(args['char'])
    arm = find_armature(char_objs)
    if arm is None:
        print('!! no armature found in character FBX'); return 1
    print('== character armature:', arm.name)

    # --- normalize height (Mixamo FBX is usually in centimetres) -------------
    lo, hi = world_bbox(char_objs)
    if lo is not None:
        h = hi.z - lo.z
        if h > 1e-6:
            s = args['height'] / h
            arm.scale = (arm.scale.x * s, arm.scale.y * s, arm.scale.z * s)
            print('== source height %.3f -> scale %.5f (target %.2f)' % (h, s, args['height']))
        # drop it so the feet sit on z=0
        bpy.context.view_layer.update()
        lo2, hi2 = world_bbox(char_objs)
        if lo2 is not None:
            arm.location.z -= lo2.z

    if arm.animation_data is None:
        arm.animation_data_create()

    # keep the character's own action (if any) as the first clip
    actions = []
    if arm.animation_data and arm.animation_data.action:
        a0 = arm.animation_data.action
        a0.name = sanitize(args['char'])
        a0.use_fake_user = True
        actions.append(a0)

    # --- transplant each animation FBX --------------------------------------
    if args['anims'] and os.path.isdir(args['anims']):
        files = sorted(glob.glob(os.path.join(args['anims'], '*.fbx')))
        print('== animation files:', len(files))
        for f in files:
            added = import_fbx(f)
            src = find_armature(added)
            act = None
            if src and src.animation_data and src.animation_data.action:
                act = src.animation_data.action
            if act is not None:
                act.name = sanitize(f)
                act.use_fake_user = True
                actions.append(act)
                print('   + clip', act.name, 'frames', tuple(round(x) for x in act.frame_range))
            else:
                print('   ! no action in', os.path.basename(f))
            # remove the temp rig/mesh, keep the action
            for o in added:
                bpy.data.objects.remove(o, do_unlink=True)

    # --- park every action on its own NLA track so glTF exports them all ----
    arm.animation_data.action = None
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    for act in actions:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = act.name
        start = int(act.frame_range[0])
        try:
            tr.strips.new(act.name, start, act)
        except RuntimeError as e:
            print('   ! strip failed for', act.name, e)

    os.makedirs(os.path.dirname(os.path.abspath(args['out'])), exist_ok=True)
    kw = dict(filepath=args['out'], export_format='GLB', export_animations=True,
              export_apply=False, export_yup=True)
    # Blender 3.6+/4.x: export every action as its own glTF animation
    try:
        bpy.ops.export_scene.gltf(export_animation_mode='ACTIONS', **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)

    sz = os.path.getsize(args['out'])
    print('== WROTE %s  (%.2f MB, %d clips)' % (args['out'], sz / 1048576.0, len(actions)))
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
