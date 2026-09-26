import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Reflector } from "three/addons/objects/Reflector.js";

const asset = (name: string): string =>
  new URL(`home/assets/${name}`, document.baseURI).href;

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(128, 128, 6, 128, 128, 125);
  gradient.addColorStop(0, "rgba(100,185,255,0.65)");
  gradient.addColorStop(0.22, "rgba(40,125,255,0.32)");
  gradient.addColorStop(1, "rgba(25,90,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function contactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 126);
  gradient.addColorStop(0, "rgba(0,0,0,0.72)");
  gradient.addColorStop(0.35, "rgba(0,0,0,0.56)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function wallSign(lines: string[], color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 384;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 512, 384);
  context.font = "600 43px system-ui";
  context.textAlign = "left";
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = color === "#f5e3d1" ? 0 : 18;
  lines.forEach((line, index) => context.fillText(line, 30, 92 + index * 66));
  context.fillRect(30, 92 + lines.length * 66, 58, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function HomeScene3D() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      host.dataset.webgl = "unavailable";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15191f");
    scene.fog = new THREE.Fog("#15191f", 17, 35);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 65);
    camera.position.set(0, 3.05, 10.2);
    camera.lookAt(0, 1.55, -2.1);
    let previousFrame = performance.now();
    let elapsed = 0;
    const generatedTextures: THREE.Texture[] = [];
    const loadedTextures: THREE.Texture[] = [];
    let environment: THREE.WebGLRenderTarget | undefined;
    let sculptureEnvironment: THREE.WebGLRenderTarget | undefined;
    let pmrem: THREE.PMREMGenerator | undefined;
    let tableReflector: Reflector | undefined;
    let bakedK: THREE.Mesh | undefined;
    let bakedVideo: HTMLVideoElement | undefined;
    let disposed = false;
    let raf = 0;
    let onPointerMove = (_event: PointerEvent): void => {};
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    host.dataset.motion = reducedMotion ? "reduced" : "full";

    const resize = (): void => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.render(scene, camera);
    };
    window.addEventListener("resize", resize);
    resize();

    const loader = new THREE.TextureLoader();
    void Promise.all([
      loader.loadAsync(asset("coast-reference-v3.png")),
      loader.loadAsync(asset("nero-marquina.png")),
      loader.loadAsync(asset("carrara-white.png")),
      loader.loadAsync(asset("smoked-walnut.png")),
      loader.loadAsync(asset("monstera-cutout.png")),
      loader.loadAsync(asset("limestone-floor.png")),
      loader.loadAsync(asset("charcoal-plaster.png")),
      loader.loadAsync(asset("drafting-sheet.png")),
      loader.loadAsync(asset("rough-charcoal-stone.png")),
      loader.loadAsync(asset("sculpture-carrara.png")),
      loader.loadAsync(asset("left-foliage-cutout.png")),
      loader.loadAsync(asset("floor-rose-marble.png")),
      loader.loadAsync(asset("table-nero-marquina.png")),
    ]).then(([coast, dark, white, wood, leaves, limestone, wallTexture, drafting, rockTexture, sculptureTexture, leftLeaves, floorMarble, tableMarble]) => {
      loadedTextures.push(coast, dark, white, wood, leaves, limestone, wallTexture, drafting, rockTexture, sculptureTexture, leftLeaves, floorMarble, tableMarble);
      if (disposed) return;
      for (const texture of loadedTextures) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      for (const texture of [dark, white, wood, limestone, wallTexture, rockTexture, sculptureTexture, floorMarble, tableMarble]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
      dark.repeat.set(1.2, 1.2);
      wood.repeat.set(4, 4);
      limestone.repeat.set(4, 4);
      floorMarble.repeat.set(2, 2);
      tableMarble.repeat.set(1.15, 1.15);
      wallTexture.repeat.set(2, 2);
      rockTexture.repeat.set(1.5, 0.8);
      sculptureTexture.repeat.set(0.45, 0.45);

      pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.43;
      room.dispose();

      const stone = new THREE.MeshPhysicalMaterial({
        map: floorMarble, color: "#98908d", roughness: 0.25, metalness: 0.04,
        clearcoat: 0.38, clearcoatRoughness: 0.22,
      });
      const plaster = new THREE.MeshStandardMaterial({
        map: wallTexture, color: "#b0a59b", roughness: 0.94,
      });
      const ceilingMat = new THREE.MeshStandardMaterial({
        map: wood, color: "#b7a18b", roughness: 0.82,
        emissive: "#654027", emissiveIntensity: 0.5,
      });
      const ceilingBeamMat = new THREE.MeshStandardMaterial({
        map: wood, color: "#695544", roughness: 0.84,
      });
      const darkMarble = new THREE.MeshPhysicalMaterial({
        map: dark, bumpMap: dark, bumpScale: 0.065, color: "#111013",
        roughness: 0.16, metalness: 0.025, clearcoat: 0.86, clearcoatRoughness: 0.12,
      });
      const roughStone = new THREE.MeshStandardMaterial({
        map: rockTexture, bumpMap: rockTexture, bumpScale: 0.06,
        color: "#d4d0d2", roughness: 0.98, flatShading: true,
      });
      const whiteMarble = new THREE.MeshPhysicalMaterial({
        map: white, bumpMap: white, bumpScale: 0.012,
        color: "#d5d4dc", roughness: 0.24, metalness: 0.025,
        clearcoat: 0.62, clearcoatRoughness: 0.17,
      });
      const sculptureMarble = new THREE.MeshPhysicalMaterial({
        map: sculptureTexture, bumpMap: sculptureTexture, bumpScale: 0.014,
        color: "#f1eff0", roughness: 0.32, metalness: 0.015,
        clearcoat: 0.36, clearcoatRoughness: 0.3,
      });
      const upperStemMarble = sculptureMarble.clone();
      upperStemMarble.color.set("#aaa7b0");
      const lowerStemMarble = sculptureMarble.clone();
      lowerStemMarble.color.set("#b6bbc6");
      const upperArmMarble = sculptureMarble.clone();
      upperArmMarble.color.set("#f4f0ee");
      const lowerArmMarble = sculptureMarble.clone();
      lowerArmMarble.color.set("#d7d4dc");
      const charcoal = new THREE.MeshStandardMaterial({ color: "#151518", roughness: 0.56, metalness: 0.18 });
      const blackMetal = new THREE.MeshStandardMaterial({ color: "#16191c", roughness: 0.32, metalness: 0.82 });
      const brass = new THREE.MeshStandardMaterial({ color: "#ae8054", roughness: 0.28, metalness: 0.72 });
      const blue = new THREE.MeshBasicMaterial({
        color: "#58abff", transparent: true, opacity: 0.7, toneMapped: false,
      });
      const warmStrip = new THREE.MeshBasicMaterial({ color: "#ffd4a0", toneMapped: false });

      const box = (
        width: number, height: number, depth: number,
        material: THREE.Material | THREE.Material[], x: number, y: number, z: number,
        radius = 0.02,
      ): THREE.Mesh => {
        const mesh = new THREE.Mesh(
          new RoundedBoxGeometry(width, height, depth, 2, radius),
          material,
        );
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        return mesh;
      };

      // Architectural shell: geometry, not the reference photograph.
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(38, 36), stone);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const shadowTexture = contactShadowTexture();
      generatedTextures.push(shadowTexture);
      const rockShadow = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3.5),
        new THREE.MeshBasicMaterial({
          map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.8,
        }));
      rockShadow.rotation.x = -Math.PI / 2;
      rockShadow.position.set(0.8, 0.008, -3);
      scene.add(rockShadow);
      const roofOutline = new THREE.Shape();
      roofOutline.moveTo(-20, 12);
      roofOutline.lineTo(20, 12);
      roofOutline.lineTo(20, -3);
      roofOutline.lineTo(7.1, -3);
      roofOutline.lineTo(-3, -14);
      roofOutline.lineTo(-20, -14);
      roofOutline.closePath();
      const roofGeometry = new THREE.ShapeGeometry(roofOutline);
      const roofPositions = roofGeometry.getAttribute("position") as THREE.BufferAttribute;
      const roofUvs = roofGeometry.getAttribute("uv") as THREE.BufferAttribute;
      for (let index = 0; index < roofPositions.count; index++) {
        roofUvs.setXY(index, (roofPositions.getX(index) + 20) / 40,
          (roofPositions.getY(index) + 14) / 26);
      }
      roofGeometry.rotateX(Math.PI / 2);
      const ceiling = new THREE.Mesh(roofGeometry, ceilingMat);
      ceiling.position.set(0, 7.05, 0);
      scene.add(ceiling);
      box(3.5, 7.1, 0.42, plaster, -11.5, 3.55, -5.3);
      box(6.2, 9.5, 0.42, plaster, 12, 4.75, -6.3);
      box(8.1, 0.22, 0.35, ceilingBeamMat, -7.05, 6.85, -6.3);
      box(0.4, 7.1, 0.75, plaster, -10.2, 3.55, -5.8);
      box(1.2, 7.1, 0.65, ceilingBeamMat, -4.6, 3.55, -3.3);
      box(0.8, 7.1, 0.8, plaster, 8.75, 3.55, -5.8);

      box(12, 7.1, 0.3, plaster, -9, 3.55, -11.3);
      for (let index = 0; index < 12; index++) {
        box(0.06, 5.5, 0.12, ceilingBeamMat,
          -5.7 + index * 0.23, 3.6, -11.05, 0.01);
      }
      box(2.9, 0.06, 0.24, brass, -3.7, 3.1, -10.8);
      const pendantGlass = new THREE.MeshBasicMaterial({ color: "#ffdfb8", toneMapped: false });
      for (const [x, y] of [[-4.27, 4.2], [-3.42, 3.77], [-2.63, 4.45]]) {
        box(0.016, 6.8 - y, 0.016, blackMetal, x, (6.8 + y) / 2, -7);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), pendantGlass);
        bulb.position.set(x, y, -7);
        scene.add(bulb);
        const light = new THREE.PointLight("#ffd0a0", 15, 8, 2);
        light.position.copy(bulb.position);
        scene.add(light);
      }

      // Distant photographic landscape appears only beyond real glass mullions.
      const landscape = new THREE.Mesh(
        new THREE.PlaneGeometry(43, 16),
        new THREE.MeshBasicMaterial({ map: coast, color: "#cfe2e8", toneMapped: false, fog: false }),
      );
      landscape.position.set(7.2, 4.3, -19);
      scene.add(landscape);
      const windowLength = Math.hypot(10.1, 11);
      const windowAngle = -Math.atan2(11, 10.1);
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(windowLength, 6.65),
        new THREE.MeshPhysicalMaterial({
          color: "#a6b8d2", roughness: 0.06, metalness: 0.3,
          transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      glass.position.set(2.05, 3.65, -8.5);
      glass.rotation.y = windowAngle;
      scene.add(glass);
      for (const x of [-3, 3.3, 5.3, 7.1]) {
        const z = -14 + (x + 3) * 11 / 10.1;
        box(0.075, 6.7, 0.14, blackMetal, x, 3.65, z, 0.01);
      }
      box(windowLength, 0.09, 0.16, blackMetal, 2.05, 6.98, -8.5).rotation.y = windowAngle;
      box(windowLength, 0.13, 0.18, blackMetal, 2.05, 0.32, -8.5).rotation.y = windowAngle;

      const roofBack = (x: number): number =>
        x <= -3 ? -14 : x >= 7.1 ? -3 : -14 + (x + 3) * 11 / 10.1;
      for (const x of [-12.2, -8.7, -5.2, -1.7, 1.8, 5.3, 8.8, 12.2]) {
        const back = roofBack(x);
        box(0.09, 0.075, 8.5 - back, ceilingBeamMat,
          x, 6.85, (8.5 + back) / 2, 0.012);
      }
      for (const [[x1, z1], [x2, z2]] of [
        [[-9.25, -5.18], [-9.16, -7.63]],
        [[-7.28, -6.42], [-7.36, -8.86]],
        [[-4.31, -9.34], [-1.89, -3.52]],
        [[1.77, -4.49], [2.61, -2.98]],
      ]) {
        const strip = box(Math.hypot(x2 - x1, z2 - z1), 0.018, 0.045,
          warmStrip, (x1 + x2) / 2, 6.76, (z1 + z2) / 2, 0.004);
        strip.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        strip.castShadow = false;
      }
      for (const z of [-4.5, -1.8, 1.1]) {
        box(z === -4.5 ? 21.7 : 32, 0.065, 0.09, ceilingBeamMat,
          z === -4.5 ? -5.15 : 0, 6.86, z, 0.008);
      }
      const ceilingJoint = new THREE.MeshBasicMaterial({
        color: "#241b17", transparent: true, opacity: 0.68,
      });
      for (const z of [-13, -12, -11, -10, -9, -8, -7, -6, -5, -4]) {
        const right = -3 + (z + 14) * 10.1 / 11;
        box(right + 16, 0.006, 0.06, ceilingJoint,
          (right - 16) / 2, 6.995, z, 0.002).castShadow = false;
      }

      scene.add(new THREE.HemisphereLight("#cbb0bd", "#302016", 1.4));
      const sun = new THREE.DirectionalLight("#ffce9c", 2.25);
      sun.position.set(7, 7, -4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -12;
      sun.shadow.camera.right = 12;
      sun.shadow.camera.top = 10;
      sun.shadow.camera.bottom = -10;
      sun.shadow.bias = -0.0002;
      scene.add(sun);
      const key = new THREE.SpotLight("#f5e6d4", 5.5, 20, Math.PI / 4.5, 0.72);
      key.position.set(3.2, 5.5, 0.5);
      key.target.position.set(0, 2, -1.5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      scene.add(key, key.target);
      for (const x of [-6.5, 6.5]) {
        const accent = new THREE.PointLight("#ffba72", 8, 7, 2);
        accent.position.set(x, 2.8, -4.2);
        scene.add(accent);
      }
      const deskLight = new THREE.PointLight("#ffc18c", 7, 5, 2);
      deskLight.position.set(-4.2, 2.7, 3.3);
      scene.add(deskLight);
      for (const x of [-7.8, 8.5]) {
        const pool = new THREE.SpotLight("#ffc38b", 5, 14, Math.PI / 3, 1);
        pool.position.set(x, 5.1, -5.1);
        pool.target.position.set(x, 0, -3.5);
        scene.add(pool, pool.target);
      }

      // The plinth is broken stone; the K is assembled from carved marble facets.
      const rockShape = () => {
        const geometry = new THREE.CylinderGeometry(2.05, 2.55, 0.94, 72, 12);
        const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let index = 0; index < positions.count; index++) {
          const x = positions.getX(index);
          const z = positions.getZ(index);
          const y = positions.getY(index);
          const angle = Math.atan2(z, x);
          const variation = 1 + 0.07 * Math.sin(angle * 9 + y * 4)
            + 0.045 * Math.sin(angle * 17 - y * 7)
            + 0.018 * Math.sin(angle * 37 + y * 13);
          positions.setX(index, x * variation);
          positions.setZ(index, z * variation);
          if (x * x + z * z > 0.2) {
            positions.setY(index, y + 0.055 * Math.sin(angle * 11)
              + 0.035 * Math.sin(angle * 23 + y * 5)
              + 0.016 * Math.sin(angle * 47 + y * 17));
          }
        }
        const facets = geometry.toNonIndexed();
        facets.computeVertexNormals();
        geometry.dispose();
        return facets;
      };
      const rock = new THREE.Mesh(
        rockShape(),
        roughStone,
      );
      rock.position.set(-0.15, 1.53, -1.55);
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
      const k = new THREE.Group();
      const blueEdge = new THREE.MeshStandardMaterial({
        color: "#aab4ca", emissive: "#3979d3", emissiveIntensity: 0.32,
        metalness: 0.18, roughness: 0.38,
      });
      const marbleFacet = (outline: Array<[number, number]>, z: number,
        material: THREE.Material): void => {
        const shape = new THREE.Shape();
        outline.forEach(([x, y], index) => {
          if (index === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        });
        shape.closePath();
        const mesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(shape, {
            depth: 0.64, bevelEnabled: true, bevelSegments: 4,
            bevelSize: 0.065, bevelThickness: 0.075,
          }),
          [material, blueEdge],
        );
        mesh.position.z = z;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        k.add(mesh);
      };
      marbleFacet([[-0.84, 1.05], [-0.43, 1.18], [-0.43, 2.22], [-0.84, 2.22]],
        0.02, upperStemMarble);
      marbleFacet([[-0.84, 0], [-0.43, 0], [-0.43, 1.18], [-0.84, 1.05]],
        0, lowerStemMarble);
      marbleFacet([[-0.31, 1.12], [0.37, 1.32], [1.34, 2.34], [0.54, 2.34]],
        0.12, upperArmMarble);
      marbleFacet([[-0.31, 1.22], [0.34, 1.05], [1.3, 0], [0.5, 0]],
        0.18, lowerArmMarble);
      const jointShape = new THREE.Shape();
      jointShape.moveTo(-0.31, 1.2);
      jointShape.lineTo(0.17, 1.06);
      jointShape.lineTo(-0.28, 0.8);
      jointShape.closePath();
      const joint = new THREE.Mesh(new THREE.ShapeGeometry(jointShape),
        new THREE.MeshPhysicalMaterial({
          map: sculptureTexture, color: "#a5b4e8", roughness: 0.23,
          metalness: 0.03, clearcoat: 0.5,
        }));
      joint.position.z = 0.93;
      k.add(joint);
      const kSeam = new THREE.MeshBasicMaterial({
        color: "#75baff", transparent: true, opacity: 0.82, toneMapped: false,
      });
      for (const points of [
        [[-0.84, 0], [-0.43, 0]],
        [[-0.84, 1.05], [-0.43, 1.18]],
        [[-0.31, 1.13], [0.54, 2.34]],
        [[-0.25, 1.18], [0.5, 0]],
      ]) {
        const curve = new THREE.LineCurve3(
          new THREE.Vector3(points[0][0], points[0][1], 0.84),
          new THREE.Vector3(points[1][0], points[1][1], 0.84),
        );
        k.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.014, 5, false), kSeam));
      }
      k.position.set(-0.1, 2.1, -1.55);
      k.rotation.y = -0.16;
      scene.add(k);

      const haloTexture = glowTexture();
      generatedTextures.push(haloTexture);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTexture, color: "#67b5ff", transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      }));
      halo.position.set(0, 2.8, -2.45);
      halo.scale.set(3.8, 3.2, 1);
      scene.add(halo);
      const glowDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 3.2),
        new THREE.MeshBasicMaterial({
          map: haloTexture, color: "#4d9fff", transparent: true, opacity: 0.48,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      glowDisc.rotation.x = -Math.PI / 2;
      glowDisc.position.set(-0.15, 0.97, -1.55);
      scene.add(glowDisc);
      const windowReflection = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3),
        new THREE.MeshBasicMaterial({
          map: haloTexture, color: "#3282e8", transparent: true, opacity: 0.8,
          depthWrite: false,
        }));
      windowReflection.rotation.x = -Math.PI / 2;
      windowReflection.position.set(3.2, 0.014, -3.8);
      scene.add(windowReflection);
      const crownRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.1, 0.014, 6, 80), blue,
      );
      crownRing.rotation.x = -Math.PI / 2;
      crownRing.scale.x = 1.18;
      crownRing.position.set(-0.15, 2.018, -1.55);
      scene.add(crownRing);
      const hologram = new THREE.MeshBasicMaterial({
        color: "#61b7ff", transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const hologramBeams: THREE.Mesh[] = [];
      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8;
        const height = 0.3 + (index % 5) * 0.13;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, height, 4), hologram);
        beam.position.set(
          -0.15 + Math.cos(angle) * 1.2,
          2.03 + height / 2,
          -1.55 + Math.sin(angle) * 0.7,
        );
        scene.add(beam);
        hologramBeams.push(beam);
      }
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.66, 0.018, 8, 96),
        blue,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.scale.x = 1.18;
      ring.position.set(-0.15, 0.98, -1.55);
      scene.add(ring);
      const glowLight = new THREE.PointLight("#5ba8ff", 6, 3, 2);
      glowLight.position.set(-0.1, 2.12, -0.75);
      scene.add(glowLight);
      const sculptureLight = new THREE.PointLight("#d8dbe7", 3.2, 4, 2);
      sculptureLight.position.set(1.2, 4, 0.1);
      scene.add(sculptureLight);

      // The foreground is a real marble worktable, with physical studio objects.
      const tableAngle = -Math.PI / 36;
      box(24, 0.24, 7.2, darkMarble, -0.3, 0.6, 5.9, 0.06).rotation.y = tableAngle;
      tableReflector = new Reflector(new THREE.PlaneGeometry(24, 7.2), {
        color: "#18181b", textureWidth: 512, textureHeight: 256,
      });
      tableReflector.rotation.order = "YXZ";
      tableReflector.rotation.x = -Math.PI / 2;
      tableReflector.rotation.y = tableAngle;
      tableReflector.position.set(-0.3, 0.724, 5.9);
      const reflector = tableReflector;
      const renderReflection = reflector.onBeforeRender;
      reflector.onBeforeRender = (...args) => {
        const kWasVisible = k.visible;
        const bakedWasVisible = bakedK?.visible;
        k.visible = false;
        if (bakedK) bakedK.visible = false;
        try {
          renderReflection.apply(reflector, args);
        } finally {
          k.visible = kWasVisible;
          if (bakedK) bakedK.visible = bakedWasVisible ?? true;
        }
      };
      scene.add(tableReflector);
      const tabletop = new THREE.Mesh(new THREE.PlaneGeometry(24, 7.2),
        new THREE.MeshPhysicalMaterial({
          map: tableMarble, bumpMap: tableMarble, bumpScale: 0.045, color: "#aaa2a8",
          roughness: 0.65, metalness: 0.02, clearcoat: 0,
          clearcoatRoughness: 0.2, envMapIntensity: 0,
          transparent: true, opacity: 0.9, depthWrite: false,
        }));
      tabletop.rotation.order = "YXZ";
      tabletop.rotation.x = -Math.PI / 2;
      tabletop.rotation.y = tableAngle;
      tabletop.position.set(-0.3, 0.728, 5.9);
      tabletop.receiveShadow = true;
      scene.add(tabletop);
      const tableGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.7),
        new THREE.MeshBasicMaterial({
          map: haloTexture, color: "#1d55d0", transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
      tableGlow.rotation.order = "YXZ";
      tableGlow.rotation.x = -Math.PI / 2;
      tableGlow.rotation.y = tableAngle;
      tableGlow.position.set(0, 0.735, 5.5);
      tableGlow.renderOrder = 5;
      scene.add(tableGlow);
      for (const x of [-8.2, 8.2]) {
        box(0.5, 0.72, 3.7, blackMetal, x, 0.36, 5.9);
      }
      const bookTitles = ["INTERIOR DESIGN", "ARCHITECTURE", "STONE"];
      for (let index = 0; index < 3; index++) {
        const book = box(1.1, 0.15, 0.98, charcoal,
          -3.95, 0.8 + index * 0.16, 4.0 - index * 0.06, 0.018);
        book.rotation.y = -0.12 + index * 0.07;
        box(1.07, 0.022, 0.95,
          new THREE.MeshStandardMaterial({ color: "#79664f", roughness: 0.72 }),
          -3.95, 0.89 + index * 0.16, 4.0 - index * 0.06, 0.005);
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 96;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#191719";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#d5bd94";
        context.font = "600 38px Georgia";
        context.fillText(bookTitles[index], 24, 64);
        const label = new THREE.CanvasTexture(canvas);
        label.colorSpace = THREE.SRGBColorSpace;
        generatedTextures.push(label);
        const spine = new THREE.Mesh(new THREE.PlaneGeometry(1.01, 0.11),
          new THREE.MeshBasicMaterial({ map: label }));
        spine.position.set(-3.95, 0.8 + index * 0.16, 4.0 - index * 0.06 + 0.50);
        scene.add(spine);
      }
      const mugCanvas = document.createElement("canvas");
      mugCanvas.width = 512;
      mugCanvas.height = 256;
      const mugContext = mugCanvas.getContext("2d")!;
      mugContext.fillStyle = "#101114";
      mugContext.fillRect(0, 0, 512, 256);
      mugContext.fillStyle = "#d8d3d1";
      mugContext.textAlign = "center";
      mugContext.font = "800 118px system-ui";
      mugContext.fillText("K", 256, 142);
      mugContext.font = "600 24px system-ui";
      mugContext.letterSpacing = "6px";
      mugContext.fillText("KREODA", 256, 194);
      const mugTexture = new THREE.CanvasTexture(mugCanvas);
      mugTexture.colorSpace = THREE.SRGBColorSpace;
      generatedTextures.push(mugTexture);
      const mug = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.21, 0.43, 32),
        [new THREE.MeshPhysicalMaterial({ map: mugTexture, roughness: 0.3, clearcoat: 0.5 }), charcoal, charcoal],
      );
      mug.scale.set(1.05, 1.22, 1.05);
      mug.position.set(-2.45, 1.0, 4.0);
      mug.rotation.y = Math.PI;
      mug.castShadow = true;
      scene.add(mug);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.04, 8, 24), charcoal);
      handle.position.set(-2.14, 1.0, 4.0);
      handle.rotation.y = Math.PI / 2;
      scene.add(handle);
      const coffee = new THREE.Mesh(
        new THREE.CircleGeometry(0.19, 32),
        new THREE.MeshStandardMaterial({ color: "#1d100a", roughness: 0.2 }),
      );
      coffee.rotation.x = -Math.PI / 2;
      coffee.position.set(-2.45, 1.27, 4.0);
      scene.add(coffee);
      const drawing = new THREE.Mesh(
        new THREE.PlaneGeometry(2.3, 1.8),
        new THREE.MeshStandardMaterial({ map: drafting, color: "#e2ded7", roughness: 0.92 }),
      );
      drawing.rotation.x = -Math.PI / 2;
      drawing.rotation.z = -0.15;
      drawing.position.set(-3, 0.735, 5.25);
      scene.add(drawing);
      const penStart = new THREE.Vector3(-1.89, 0.78, 4.92);
      const penEnd = new THREE.Vector3(-1.29, 0.78, 6.11);
      const penVector = penEnd.clone().sub(penStart);
      const pen = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.018, penVector.length(), 12),
        blackMetal,
      );
      pen.position.copy(penStart).add(penEnd).multiplyScalar(0.5);
      pen.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), penVector.normalize());
      scene.add(pen);
      const nib = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.006, 0.12, 12), brass);
      nib.position.copy(penEnd).addScaledVector(penVector, -0.06);
      nib.quaternion.copy(pen.quaternion);
      scene.add(nib);
      const warmSampleMarble = whiteMarble.clone();
      warmSampleMarble.color.set("#c6b9b2");
      const sampleSides = whiteMarble.clone();
      sampleSides.color.set("#8c8384");
      const sampleMaterials = (top: THREE.Material): THREE.Material[] =>
        [sampleSides, sampleSides, top, sampleSides, sampleSides, sampleSides];
      box(0.58, 0.11, 0.36, sampleMaterials(warmSampleMarble), 2.43, 0.783, 3.45);
      box(0.6, 0.11, 0.36, sampleMaterials(whiteMarble), 3.16, 0.783, 4.44);
      box(0.34, 0.1, 0.25, sampleMaterials(whiteMarble), 3.63, 0.778, 3.75);
      const sample = new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 24),
        new THREE.MeshPhysicalMaterial({
          map: dark, color: "#b7a7a5", roughness: 0.27,
          metalness: 0.08, clearcoat: 0.6, clearcoatRoughness: 0.16,
        }));
      sample.position.set(2.8, 1.01, 4.25);
      sample.castShadow = true;
      scene.add(sample);

      // Lounge and bar keep left side open beyond the recent-project panel.
      box(0.16, 5.6, 0.28, blackMetal, -7.8, 2.8, -3.55, 0.02);
      box(0.16, 5.6, 0.28, blackMetal, -5.1, 2.8, -3.55, 0.02);
      box(3.2, 0.48, 0.88, charcoal, -5.8, 0.62, -3.3, 0.16);
      box(3.2, 0.72, 0.26, charcoal, -5.8, 1.1, -3.67, 0.12);
      for (const x of [-6.7, -5.8, -4.9]) {
        box(0.52, 0.48, 0.28, new THREE.MeshStandardMaterial({ color: "#605449", roughness: 0.88 }), x, 1.12, -3.38, 0.09);
      }
      box(3.2, 0.86, 0.92, charcoal, 3.85, 0.55, -4.6, 0.15);
      box(3.2, 0.8, 0.35, charcoal, 3.85, 1.1, -4.98, 0.12);
      box(3.4, 0.9, 0.83, darkMarble, -5.1, 0.46, -4.9, 0.04);
      const islandMarble = darkMarble.clone();
      islandMarble.color.set("#aaa1a3");
      islandMarble.roughness = 0.3;
      box(2.5, 1, 0.9, islandMarble, -3, 2.25, -4.9, 0.04);
      box(2.7, 0.14, 1.12, islandMarble, -3, 2.81, -4.9, 0.02);
      const loungeUpholstery = new THREE.MeshStandardMaterial({ color: "#b6aca3", roughness: 0.92 });
      box(2.4, 0.14, 2.1, charcoal, -3.25, 2.74, -6.75, 0.03);
      box(1.85, 0.2, 0.7, loungeUpholstery, -3.25, 3.02, -6.55, 0.1);
      box(1.85, 0.38, 0.18, loungeUpholstery, -3.25, 3.29, -6.92, 0.1);
      for (const x of [-4.22, -2.28]) {
        box(0.16, 0.34, 0.73, loungeUpholstery, x, 3.12, -6.55, 0.07);
      }
      for (const x of [-3.9, -2.1]) {
        box(0.12, 1.8, 0.12, blackMetal, x, 0.9, -4.7);
      }
      box(3.1, 0.055, 0.38, brass, -5.1, 1.95, -5.3, 0.015);
      for (let index = 0; index < 6; index++) {
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.075, 0.29 + (index % 3) * 0.06, 12),
          new THREE.MeshStandardMaterial({
            color: ["#58623d", "#7f5130", "#393a42"][index % 3],
            roughness: 0.34, metalness: 0.1,
          }),
        );
        bottle.position.set(-6.25 + index * 0.43, 2.14, -5.3);
        scene.add(bottle);
      }
      const slab = box(1.7, 3.7, 0.16, whiteMarble, 11.75, 2.72, -4.78, 0.02);
      slab.rotation.y = -0.18;
      slab.rotation.z = 0.055;
      box(1.8, 0.8, 0.48, charcoal, 11.75, 0.4, -4.72);

      const signLeft = wallSign(["BETTER", "SPACES", "A BRIGHTER", "TOMORROW"], "#87bdff");
      const signRight = wallSign(["MATERIALS", "SHAPES", "IDEAS", "PEOPLE"], "#f5e3d1");
      generatedTextures.push(signLeft, signRight);
      for (const [texture, x, y, z, width, height] of [
        [signLeft, -10.5, 5.45, -4.95, 1.6, 1.7],
        [signRight, 10.35, 5.95, -5.78, 1.65, 2.05],
      ] as const) {
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(width, height),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
        );
        sign.position.set(x, y, z);
        scene.add(sign);
      }

      const leafMaterial = new THREE.MeshStandardMaterial({
        map: leaves, transparent: true, alphaTest: 0.16, depthWrite: false,
        side: THREE.DoubleSide, roughness: 0.75,
      });
      const leftLeafMaterial = leafMaterial.clone();
      leftLeafMaterial.map = leftLeaves;
      const planterStone = new THREE.MeshStandardMaterial({
        map: limestone, color: "#cdbeb9", roughness: 0.84,
      });
      const potMaterial = new THREE.MeshStandardMaterial({ color: "#817471", roughness: 0.69 });
      const plants: THREE.Group[] = [];
      const plant = (x: number, z: number, scale: number,
        slim = x < 0, baseY = 0): void => {
        if (x > 0) {
          box(0.78 * scale, 0.72 * scale, 0.78 * scale, x < 6 ? stone : plaster,
            x, baseY + 0.36 * scale, z, 0.025);
        } else {
          const pot = new THREE.Mesh(
            new THREE.CylinderGeometry(0.42 * scale, 0.32 * scale, 0.72 * scale, 24),
            potMaterial,
          );
          pot.position.set(x, baseY + 0.36 * scale, z);
          pot.castShadow = true;
          scene.add(pot);
        }
        const crown = new THREE.Group();
        for (const rotation of slim ? [0, Math.PI / 2] : [0, Math.PI / 3, (2 * Math.PI) / 3]) {
          const foliage = new THREE.Mesh(
            new THREE.PlaneGeometry((slim ? 1.8 : 2.05) * scale, (slim ? 2.7 : 2.45) * scale),
            slim ? leftLeafMaterial : leafMaterial,
          );
          foliage.position.y = (x > 0 ? 1.7 : 1.38) * scale;
          foliage.rotation.y = rotation;
          crown.add(foliage);
        }
        crown.position.set(x, baseY + (x > 6 ? 1.3 : x > 0 ? 0.93 : 0.66) * scale, z);
        scene.add(crown);
        plants.push(crown);
      };
      plant(-7.35, 0.3, 1.05);
      plant(-3.7, -4.8, 0.4, true, 2.88);
      box(0.72, 1.85, 0.72, planterStone, 2.65, 0.925, -5.4);
      box(0.8, 1.3, 0.8, planterStone, 4.1, 0.65, -5.35);
      plant(2.65, -5.4, 0.8, true);
      plant(9.2, -4.0, 1.08);

      let targetGlow = 1;
      let currentGlow = targetGlow;
      onPointerMove = (event: PointerEvent): void => {
        if (reducedMotion) return;
        const bounds = host.getBoundingClientRect();
        const center = ring.position.clone().project(camera);
        const centerX = bounds.left + (center.x + 1) * bounds.width / 2;
        const centerY = bounds.top + (1 - center.y) * bounds.height / 2;
        const distance = Math.hypot((event.clientX - centerX) / 190, (event.clientY - centerY) / 115);
        targetGlow = 0.35 + Math.max(0, 1 - distance * 0.7) * 2.1;
      };
      window.addEventListener("pointermove", onPointerMove);

      // Bake the room around the sculpture once so marble reflects its actual windows and lights.
      try {
        const capture = new THREE.WebGLCubeRenderTarget(256);
        const probe = new THREE.CubeCamera(0.1, 60, capture);
        probe.position.set(0, 2.9, -1.55);
        scene.add(probe);
        const blueEffects = [halo, glowDisc, windowReflection, crownRing, ring, tableGlow];
        const originalGlow = glowLight.intensity;
        k.visible = false;
        tableReflector!.visible = false;
        blueEffects.forEach((effect) => { effect.visible = false; });
        glowLight.intensity = 0;
        try {
          probe.update(renderer, scene);
        } finally {
          k.visible = true;
          tableReflector!.visible = true;
          blueEffects.forEach((effect) => { effect.visible = true; });
          glowLight.intensity = originalGlow;
          scene.remove(probe);
        }
        sculptureEnvironment = pmrem!.fromCubemap(capture.texture);
        for (const material of [upperStemMarble, lowerStemMarble, upperArmMarble,
          lowerArmMarble, blueEdge, joint.material as THREE.MeshPhysicalMaterial]) {
          material.envMap = sculptureEnvironment.texture;
          material.envMapIntensity = 1.4;
          material.needsUpdate = true;
        }
        upperArmMarble.envMapIntensity = 2.1;
        lowerArmMarble.envMapIntensity = 1.35;
        capture.dispose();
      } catch (error) {
        k.visible = true;
        tableReflector!.visible = true;
        console.warn("[home] room light probe unavailable", error);
      }

      if (new URLSearchParams(window.location.search).has("room-baked-probe")) {
        const animated = new Set<THREE.Object3D>([rockShadow, halo, glowDisc,
          windowReflection, crownRing, ring, tableGlow, ...hologramBeams]);
        plants.forEach((plant) => plant.traverse((object) => animated.add(object)));
        scene.traverse((object) => {
          if ((object instanceof THREE.Mesh || object instanceof THREE.Sprite) && !animated.has(object)) {
            object.visible = false;
          }
        });
        scene.background = null;
        scene.fog = null;
        host.style.backgroundImage = `url("${asset("room-cycles-probe.png")}")`;
        host.style.backgroundSize = "cover";
        host.style.backgroundPosition = "center";
        host.dataset.roomBaked = "ready";
      }

      if (new URLSearchParams(window.location.search).has("export-room")) {
        const hidden = [k, rock, tableReflector!, halo, glowDisc, windowReflection,
          crownRing, ring, tableGlow, ...plants];
        const previous = hidden.map((object) => object.visible);
        hidden.forEach((object) => { object.visible = false; });
        void import("three/addons/exporters/GLTFExporter.js").then(async ({ GLTFExporter }) => {
          const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
          const bytes = new Uint8Array(glb as ArrayBuffer);
          let binary = "";
          for (let index = 0; index < bytes.length; index += 32768) {
            binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
          }
          (window as unknown as { __homeGlb?: string }).__homeGlb = btoa(binary);
          host.dataset.exportReady = "true";
        }).catch((error) => {
          console.error("[home] room export failed", error);
          host.dataset.exportError = String(error);
        }).finally(() => hidden.forEach((object, index) => { object.visible = previous[index]; }));
      } else void loader.loadAsync(asset("k-cycles-still.png")).then((texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        loadedTextures.push(texture);
        const poster = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 4.56),
          new THREE.MeshBasicMaterial({
            map: texture, transparent: true, alphaTest: 0.02,
            depthWrite: false, toneMapped: false,
          }));
        poster.position.set(-0.15, 2.57, -1.15);
        poster.quaternion.copy(camera.quaternion);
        scene.add(poster);
        bakedK = poster;
        k.visible = false;
        rock.visible = false;
        host.dataset.bakedK = "ready";
        if (reducedMotion) renderer.render(scene, camera);
        if (!reducedMotion) {
          const video = document.createElement("video");
          video.src = asset("k-loop.webm");
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.playbackRate = 0.5;
          bakedVideo = video;
          void video.play().then(() => {
            if (disposed) return;
            const moving = new THREE.VideoTexture(video);
            moving.colorSpace = THREE.SRGBColorSpace;
            loadedTextures.push(moving);
            const material = poster.material as THREE.MeshBasicMaterial;
            material.map = moving;
            material.needsUpdate = true;
            host.dataset.bakedK = "video";
          }).catch((error) => {
            if (disposed) return;
            poster.visible = false;
            k.visible = true;
            rock.visible = true;
            host.dataset.bakedK = "fallback";
            console.warn("[home] baked K video unavailable", error);
          });
        }
      }).catch((error) => console.warn("[home] baked K unavailable", error));

      const tick = (): void => {
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        const delta = Math.min((now - previousFrame) / 1000, 0.05);
        previousFrame = now;
        if (document.hidden) return;
        if (!reducedMotion) {
          elapsed += delta;
          const time = elapsed;
          if (k.visible) k.rotation.y += delta * 0.03;
          plants.forEach((crown, index) => {
            crown.rotation.z = Math.sin(time * 0.75 + index * 1.6) * 0.025;
            crown.rotation.y = Math.sin(time * 0.53 + index) * 0.018;
          });
          currentGlow += (targetGlow - currentGlow) * Math.min(1, delta * 4);
          (halo.material as THREE.SpriteMaterial).opacity = Math.min(0.8, 0.2 + currentGlow * 0.25);
          (glowDisc.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.18 + currentGlow * 0.39);
          hologram.opacity = Math.min(0.38, 0.11 + currentGlow * 0.075);
          blue.opacity = Math.min(1, 0.38 + currentGlow * 0.3);
          const pulse = 1 + (currentGlow - 0.7) * 0.025;
          ring.scale.set(1.18 * pulse, pulse, pulse);
        }
        renderer.render(scene, camera);
      };

      resize();
      host.dataset.sceneReady = "true";
      if (!reducedMotion) tick();
    }).catch((error) => {
      console.error("[home] 3D assets failed to load", error);
      host.dataset.webgl = "unavailable";
      renderer.domElement.style.display = "none";
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
          if (object instanceof THREE.Mesh) geometries.add(object.geometry);
          const entries = Array.isArray(object.material) ? object.material : [object.material];
          entries.forEach((material) => materials.add(material));
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      [...loadedTextures, ...generatedTextures].forEach((texture) => texture.dispose());
      environment?.dispose();
      sculptureEnvironment?.dispose();
      pmrem?.dispose();
      tableReflector?.dispose();
      bakedVideo?.pause();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={ref} data-testid="home-scene" aria-hidden className="home-scene" />;
}
