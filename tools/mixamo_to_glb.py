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
#       --char assets/mixamo/raw/Romero.fbx \
#       --anims assets/mixamo/raw/anims \
#       --out assets/models/romero.glb \
#       --height 1.78 --max-tex 1024 --max-tris 15000
#
# --anims may be omitted (exports the character with whatever clip it carries).
# Clip names come from the animation FBX filenames (sanitized).
#
# THREE THINGS THIS HAS TO SOLVE, all measured from the actual drop:
#
#  1. RIG PREFIX MISMATCH. The animation pack and Romero are both prefixed
#     `mixamorig5:`; Romera is `mixamorig:`. An action drives a rig by the bone
#     name embedded in each fcurve data path, so the pack cannot touch Romera
#     until those paths are rewritten. We rewrite the ACTION rather than rename
#     the character's bones: bone renames have to stay in sync with the mesh's
#     vertex groups, and getting that wrong silently destroys the skinning.
#
#  2. EVERY CLIP HAS THE SAME NAME. Mixamo exports all of them as
#     `Armature|mixamo.com|Layer0`, and the runtime binds behaviours to clips by
#     name — so without renaming from the filename, one clip would be selected
#     for everything.
#
#  3. WEIGHT. Romero arrives at 105 MB: 49.6k triangles and eight 4096x4096
#     maps, which is ~536 MB of texture memory before mipmaps, in a renderer
#     that already rasterizes the scene four times per frame. Decimation and
#     texture downscaling are part of the conversion, not an afterthought.
# =============================================================================
import bpy, sys, os, re, glob

from mathutils import Vector

BONE_PREFIX = re.compile(r'mixamorig\d*:')


def argv_after_dashes():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def parse_args():
    a = argv_after_dashes()
    out = {'char': None, 'anims': None, 'out': None, 'height': 1.8,
           'max_tex': 0, 'max_tris': 0}
    i = 0
    while i < len(a):
        k = a[i]
        if k in ('--char', '--anims', '--out'):
            out[k[2:]] = a[i + 1]; i += 2
        elif k == '--height':
            out['height'] = float(a[i + 1]); i += 2
        elif k == '--max-tex':
            out['max_tex'] = int(a[i + 1]); i += 2
        elif k == '--max-tris':
            out['max_tris'] = int(a[i + 1]); i += 2
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


def rig_prefix(arm):
    """The `mixamorigN:` prefix this armature actually uses, or '' if none."""
    for b in arm.data.bones:
        m = BONE_PREFIX.match(b.name)
        if m:
            return m.group(0)
    return ''


def retarget_action(act, want_prefix):
    """Rewrite every fcurve data path so the action drives `want_prefix` bones.

    Returns (rewritten, orphaned) — orphaned counts curves whose bone does not
    exist on the target rig at all; those are reported, not hidden, because they
    are exactly where an animation silently does nothing.
    """
    n = 0
    for fc in act.fcurves:
        dp = fc.data_path
        new = BONE_PREFIX.sub(want_prefix, dp)
        if new != dp:
            fc.data_path = new
            n += 1
    return n


def orphan_bones(act, arm):
    have = {b.name for b in arm.data.bones}
    missing = set()
    for fc in act.fcurves:
        m = re.search(r'pose\.bones\["([^"]+)"\]', fc.data_path)
        if m and m.group(1) not in have:
            missing.add(m.group(1))
    return sorted(missing)


def shrink_textures(limit):
    """Downscale every image in place. glTF bakes the pixels, so this is what
    actually lands in the GLB.

    `has_data` is False for FBX-embedded maps until something touches them, so
    filtering on it silently skipped six of Romero's eight 4K textures and they
    went into the GLB at full size. We force the load instead.
    """
    if not limit:
        return
    for img in bpy.data.images:
        if img.name == 'Render Result':
            continue
        w, h = img.size
        if w == 0 or h == 0:                     # not resident yet: pull it in
            try:
                img.reload()
                w, h = img.size
            except Exception:
                pass
        if w == 0 or h == 0:
            print('   tex %-14s UNREADABLE, left as-is' % img.name)
            continue
        if max(w, h) <= limit:
            continue
        k = limit / float(max(w, h))
        nw, nh = max(1, int(w * k)), max(1, int(h * k))
        img.scale(nw, nh)
        print('   tex %-14s %dx%d -> %dx%d' % (img.name, w, h, nw, nh))


def decimate(objs, budget):
    """Collapse-decimate skinned meshes down to a triangle budget.

    Collapse interpolates vertex weights, so the skinning survives; it is the
    only mode that is safe on a rigged character.

    The modifier is APPLIED here rather than left for the exporter. glTF export
    runs with export_apply=False — it has to, because applying modifiers would
    also apply the armature modifier and flatten the skinning — so a decimate
    modifier left in the stack is simply ignored, which is why Romero came out
    at 82 MB with all 49.6k triangles still in it.
    """
    if not budget:
        return
    meshes = [o for o in objs if o.type == 'MESH']
    total = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        total += len(o.data.loop_triangles)
    if total <= budget:
        print('== tris %d, under budget %d — no decimation' % (total, budget))
        return
    ratio = budget / float(total)
    print('== tris %d -> budget %d (ratio %.3f)' % (total, budget, ratio))
    for o in meshes:
        mod = o.modifiers.new('vig_decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        for s in bpy.context.selected_objects:
            s.select_set(False)
        o.select_set(True)
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError as e:
            print('   ! decimate apply failed on %s: %s' % (o.name, e))
            continue
        o.data.calc_loop_triangles()
        print('   mesh %-22s -> %d tris' % (o.name, len(o.data.loop_triangles)))


def main():
    args = parse_args()
    if not args['char'] or not args['out']:
        print('!! need --char and --out'); return 1

    reset()
    char_objs = import_fbx(args['char'])
    arm = find_armature(char_objs)
    if arm is None:
        print('!! no armature found in character FBX'); return 1
    target_prefix = rig_prefix(arm)
    print('== character armature: %s  (%d bones, prefix %r)'
          % (arm.name, len(arm.data.bones), target_prefix))

    # --- normalize height (Mixamo FBX is usually in centimetres) -------------
    lo, hi = world_bbox(char_objs)
    if lo is not None:
        h = hi.z - lo.z
        if h > 1e-6:
            s = args['height'] / h
            arm.scale = (arm.scale.x * s, arm.scale.y * s, arm.scale.z * s)
            print('== source height %.3f -> scale %.5f (target %.2f)' % (h, s, args['height']))
        bpy.context.view_layer.update()
        lo2, hi2 = world_bbox(char_objs)
        if lo2 is not None:
            arm.location.z -= lo2.z

    if arm.animation_data is None:
        arm.animation_data_create()

    # The character FBX carries a 2-frame T-pose stub. It is not a clip and must
    # not be exported as one, or the runtime can bind a behaviour to a still.
    if arm.animation_data and arm.animation_data.action:
        stub = arm.animation_data.action
        arm.animation_data.action = None
        print('== dropped T-pose stub action %r' % stub.name)

    actions = []
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
                moved = retarget_action(act, target_prefix)
                miss = orphan_bones(act, arm)
                actions.append(act)
                note = ''
                if moved:
                    note += ' retargeted(%d curves)' % moved
                if miss:
                    note += ' NO-TARGET:%s' % ','.join(b.split(':')[-1] for b in miss)
                print('   + %-22s %6.2fs%s' % (act.name, (act.frame_range[1] - act.frame_range[0]) / 30.0, note))
            else:
                print('   ! no action in', os.path.basename(f))
            for o in added:
                bpy.data.objects.remove(o, do_unlink=True)

    # --- park every action on its own NLA track so glTF exports them all ----
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

    decimate(char_objs, args['max_tris'])
    shrink_textures(args['max_tex'])

    os.makedirs(os.path.dirname(os.path.abspath(args['out'])), exist_ok=True)
    kw = dict(filepath=args['out'], export_format='GLB', export_animations=True,
              export_apply=False, export_yup=True)
    try:
        bpy.ops.export_scene.gltf(export_animation_mode='ACTIONS', **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)

    sz = os.path.getsize(args['out'])
    print('== WROTE %s  (%.2f MB, %d clips)' % (args['out'], sz / 1048576.0, len(actions)))
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
