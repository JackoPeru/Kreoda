"""Render the modeled home sculpture with Blender Cycles.

blender --background --factory-startup --python scripts/render-home-k.py -- --output k.png
"""

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


args = argparse.ArgumentParser()
args.add_argument("--output", required=True)
args.add_argument("--angle", type=float, default=-0.16)
args.add_argument("--samples", type=int, default=32)
args.add_argument("--width", type=int, default=640)
args.add_argument("--height", type=int, default=540)
options = args.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
assets = Path(__file__).resolve().parents[1] / "public" / "home" / "assets"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = options.samples
scene.cycles.use_denoising = True
scene.render.resolution_x = options.width
scene.render.resolution_y = options.height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.render.filepath = str(Path(options.output).resolve())
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"

world = bpy.data.worlds.new("Dim studio bounce")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.21, 0.20, 0.22, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45


def image_material(name, filename, tint, roughness, bump_distance):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*tint, 1)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.02
    coat = bsdf.inputs.get("Coat Weight")
    if coat:
        coat.default_value = 0.3
    coat_roughness = bsdf.inputs.get("Coat Roughness")
    if coat_roughness:
        coat_roughness.default_value = 0.16
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(str(assets / filename), check_existing=True)
    image.extension = "REPEAT"
    tint_mix = nodes.new("ShaderNodeMixRGB")
    tint_mix.blend_type = "MULTIPLY"
    tint_mix.inputs[0].default_value = 1
    tint_mix.inputs[2].default_value = (*tint, 1)
    links.new(image.outputs["Color"], tint_mix.inputs[1])
    links.new(tint_mix.outputs["Color"], bsdf.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = bump_distance
    links.new(image.outputs["Color"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


stone = image_material("Veined white Carrara", "sculpture-carrara.png", (0.9, 0.89, 0.92), 0.29, 0.009)
stone_dark = image_material("Shadowed Carrara", "sculpture-carrara.png", (0.70, 0.75, 0.86), 0.32, 0.009)
stone_light = image_material("Lit Carrara", "sculpture-carrara.png", (1, 0.98, 0.98), 0.28, 0.009)
rock_material = image_material("Chiseled dark stone", "rough-charcoal-stone.png", (0.65, 0.63, 0.65), 0.84, 0.035)
rock_material.node_tree.nodes["Principled BSDF"].inputs["Coat Weight"].default_value = 0

side = bpy.data.materials.new("Blue lit marble edge")
side.use_nodes = True
side_bsdf = side.node_tree.nodes["Principled BSDF"]
side_bsdf.inputs["Base Color"].default_value = (0.53, 0.62, 0.76, 1)
side_bsdf.inputs["Roughness"].default_value = 0.3
side_bsdf.inputs["Metallic"].default_value = 0.06
side_bsdf.inputs["Coat Weight"].default_value = 0.4

blue = bpy.data.materials.new("Blue seam light")
blue.use_nodes = True
blue_bsdf = blue.node_tree.nodes["Principled BSDF"]
blue_bsdf.inputs["Base Color"].default_value = (0.22, 0.47, 0.9, 1)
blue_bsdf.inputs["Emission Color"].default_value = (0.06, 0.31, 0.85, 1)
blue_bsdf.inputs["Emission Strength"].default_value = 2.2

k_root = bpy.data.objects.new("K sculpture rotation", None)
bpy.context.collection.objects.link(k_root)
k_root.location = (-0.1, 0, 2.1)
k_root.rotation_euler[2] = options.angle


def facet(name, outline, front_material, depth=0.62, offset=(0, 0)):
    count = len(outline)
    vertices = [(x, -depth / 2, z) for x, z in outline] + [(x, depth / 2, z) for x, z in outline]
    faces = [tuple(range(count)), tuple(range(2 * count - 1, count - 1, -1))]
    faces.extend((i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(front_material)
    mesh.materials.append(side)
    for polygon in mesh.polygons[2:]:
        polygon.material_index = 1
    uv = mesh.uv_layers.new(name="Marble veins")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (vertex.x * 0.45 + offset[0], vertex.z * 0.45 + offset[1])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = k_root
    bevel = obj.modifiers.new("Polished carved edge", "BEVEL")
    bevel.width = 0.045
    bevel.segments = 3
    bevel.affect = "EDGES"
    weighted = obj.modifiers.new("Weighted face normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    return obj


facet("Upper stem", [(-0.84, 1.05), (-0.43, 1.18), (-0.43, 2.22), (-0.84, 2.22)], stone_dark)
facet("Lower stem", [(-0.84, 0), (-0.43, 0), (-0.43, 1.18), (-0.84, 1.05)], stone_dark)
facet("Upper rising arm", [(-0.31, 1.12), (0.37, 1.32), (1.34, 2.34), (0.54, 2.34)], stone_light)
facet("Lower falling arm", [(-0.31, 1.22), (0.34, 1.05), (1.3, 0), (0.5, 0)], stone, offset=(0.12, 0.38))
facet("Carved central joint", [(-0.32, 1.19), (0.16, 1.08), (-0.28, 0.8)], stone_dark, depth=0.68)


def seam(name, start, end):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.007
    curve.bevel_resolution = 3
    path = curve.splines.new("POLY")
    path.points.add(1)
    path.points[0].co = (*start, 1)
    path.points[1].co = (*end, 1)
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(blue)
    bpy.context.collection.objects.link(obj)
    obj.parent = k_root


for name, start, end in [
    ("Stem join", (-0.84, -0.34, 1.05), (-0.43, -0.34, 1.18)),
    ("Upper arm light", (-0.31, -0.34, 1.12), (0.54, -0.34, 2.34)),
    ("Lower arm light", (-0.31, -0.34, 1.22), (0.5, -0.34, 0)),
]:
    seam(name, start, end)

segments = 72
rings = 13
vertices = []
for level in range(rings):
    t = level / (rings - 1)
    z = 0.9 + t * 1.2
    base_radius = 2.25 - t * 0.42
    for index in range(segments):
        a = 2 * math.pi * index / segments
        variation = 1 + 0.055 * math.sin(9 * a + 3 * t) + 0.035 * math.sin(17 * a - 4 * t) + 0.015 * math.sin(37 * a + 11 * t)
        radius = base_radius * variation
        vertices.append((radius * math.cos(a), radius * math.sin(a) * 0.72, z + 0.04 * math.sin(11 * a + t * 5)))
faces = []
for level in range(rings - 1):
    for index in range(segments):
        nxt = (index + 1) % segments
        faces.append((level * segments + index, level * segments + nxt,
                      (level + 1) * segments + nxt, (level + 1) * segments + index))
faces.append(tuple(range((rings - 1) * segments, rings * segments)))
faces.append(tuple(range(segments - 1, -1, -1)))
mesh = bpy.data.meshes.new("Irregular carved plinth")
mesh.from_pydata(vertices, [], faces)
mesh.update()
mesh.materials.append(rock_material)
uv = mesh.uv_layers.new(name="Stone grain")
for polygon in mesh.polygons:
    for loop_index in polygon.loop_indices:
        vertex_index = mesh.loops[loop_index].vertex_index
        v = mesh.vertices[vertex_index].co
        uv.data[loop_index].uv = (math.atan2(v.y, v.x) / (2 * math.pi) + 0.5, (v.z - 0.9) / 1.2)
rock = bpy.data.objects.new("Dark chiseled stone plinth", mesh)
bpy.context.collection.objects.link(rock)


def area(name, location, color, energy, size, target=(0, 0, 2.7)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


area("Warm window key", (3.4, -2.6, 6), (1, 0.79, 0.65), 520, 4.0)
area("Cool front fill", (-3.1, -4.2, 4.5), (0.62, 0.76, 1), 290, 4.5)
area("White marble highlight", (0.2, -3.8, 5.8), (1, 0.98, 0.94), 280, 2.2)
area("Blue base bounce", (0, -1.4, 1.9), (0.13, 0.42, 1), 95, 1.4, target=(0, 0, 1.7))

camera_data = bpy.data.cameras.new("Reference camera")
camera = bpy.data.objects.new("Reference camera", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (0, -8, 3.5)
direction = Vector((0, 0, 2.48)) - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 4.55
scene.camera = camera

print("Rendering", options.output, options.width, options.height, options.samples, flush=True)
bpy.ops.render.render(write_still=True)
print("Saved", scene.render.filepath, flush=True)
