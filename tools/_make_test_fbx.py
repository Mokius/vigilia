# Generates synthetic Mixamo-like FBX files so the conversion pipeline can be
# validated without needing any licensed asset. Produces:
#   <out>/char.fbx              a skinned mesh + armature with an action
#   <out>/anims/Walk_Test.fbx   armature-only action ("without skin")
#   <out>/anims/Scream_Test.fbx idem
import bpy, sys, os, math

out = (sys.argv[sys.argv.index('--') + 1:] or ['.'])[0]
anims = os.path.join(out, 'anims')
os.makedirs(anims, exist_ok=True)


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_rig(with_mesh):
    bpy.ops.object.armature_add(enter_editmode=False, location=(0, 0, 0))
    arm = bpy.context.object
    arm.name = 'Armature'
    # give it a second bone so skinning is meaningful
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    root = eb[0]; root.name = 'Hips'; root.tail = (0, 0, 0.9)
    spine = eb.new('Spine'); spine.head = (0, 0, 0.9); spine.tail = (0, 0, 1.8); spine.parent = root
    bpy.ops.object.mode_set(mode='OBJECT')
    if with_mesh:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.9))
        m = bpy.context.object; m.name = 'Body'
        m.scale = (0.25, 0.18, 0.9)
        bpy.ops.object.transform_apply(scale=True)
        m.select_set(True); arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    return arm


def bake_action(arm, name, axis, amp, frames):
    arm.animation_data_create()
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    pb = arm.pose.bones['Spine']
    pb.rotation_mode = 'XYZ'
    for f in range(frames + 1):
        t = f / float(frames)
        pb.rotation_euler[axis] = math.radians(amp * math.sin(t * math.pi * 2))
        pb.keyframe_insert('rotation_euler', frame=1 + f * 2)
    act.use_fake_user = True
    return act


# --- character (with skin) ---
fresh(); arm = build_rig(True); bake_action(arm, 'TPose_src', 0, 3, 6)
# emulate Mixamo's centimetre scale so the height-normalize path is exercised
arm.scale = (100, 100, 100)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.fbx(filepath=os.path.join(out, 'char.fbx'), use_selection=True,
                         add_leaf_bones=False, bake_anim=True)
print('wrote char.fbx')

# --- animation-only files ---
for nm, axis, amp in (('Walk_Test', 0, 25), ('Scream_Test', 1, 40)):
    fresh(); a = build_rig(False); bake_action(a, nm + '_src', axis, amp, 10)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.fbx(filepath=os.path.join(anims, nm + '.fbx'), use_selection=True,
                             add_leaf_bones=False, bake_anim=True)
    print('wrote', nm + '.fbx')
