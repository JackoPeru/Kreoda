"""Render the exported Three.js home room with Blender Cycles."""

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--samples", type=int, default=32)
parser.add_argument("--width", type=int, default=960)
parser.add_argument("--height", type=int, default=540)
options = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path(options.input).resolve()))
scene = bpy.context.scene
print("Imported", len(scene.objects), "objects,", len(bpy.data.materials), "materials,",
      len([obj for obj in scene.objects if obj.type == "LIGHT"]), "lights", flush=True)

scene.render.engine = "CYCLES"
scene.cycles.samples = options.samples
scene.cycles.use_denoising = True
scene.render.resolution_x = options.width
scene.render.resolution_y = options.height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = str(Path(options.output).resolve())
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"

world = bpy.data.worlds.new("Dusk ambient")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.24, 0.22, 0.24, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.2


def area(name, location, target, color, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


area("Dusk through glazing", (6, 10, 6), (0, 0, 1), (1, 0.78, 0.65), 2400, 8)
area("Warm lounge bounce", (-6, 0, 6), (-6, 0, 1), (1, 0.72, 0.53), 1300, 6)
area("Soft camera fill", (0, -7, 5), (0, 0, 1), (0.85, 0.85, 1), 250, 7)
area("Warm desk glint", (-6, -3, 4), (-5, -3, 0.5), (1, 0.68, 0.44), 450, 2)
area("Right plaster bounce", (8, -3, 6), (11, 0, 3), (1, 0.83, 0.7), 500, 5)

camera_data = bpy.data.cameras.new("Home view")
camera = bpy.data.objects.new("Home view", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (0, -10.2, 3.05)
direction = Vector((0, 2.1, 1.55)) - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
camera_data.sensor_fit = "VERTICAL"
camera_data.lens = camera_data.sensor_height / (2 * math.tan(math.radians(55) / 2))
camera_data.clip_end = 100
scene.camera = camera

print("Rendering room", options.output, flush=True)
bpy.ops.render.render(write_still=True)
print("Saved", scene.render.filepath, flush=True)
