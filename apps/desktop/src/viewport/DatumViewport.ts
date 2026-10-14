import * as THREE from "three";
import type { DatumDescriptor, DatumPlaneGeometry, DatumAxisGeometry, DatumPointGeometry } from "@kreoda/protocol";

/** Display guides use native resolved records and never produce CAD shapes. */
export class DatumViewport {
  readonly group = new THREE.Group();
  private pickables: THREE.Object3D[] = [];
  private selected = new Set<string>();
  private sharedTargets = new Set<string>();
  private hovered: string | null = null;
  private vector(value: readonly number[]): THREE.Vector3 { return new THREE.Vector3(value[0],value[1],value[2]); }

  sync(datums: readonly DatumDescriptor[]): void {
    this.clear();
    for(const datum of datums) {
      const holder = new THREE.Group();holder.userData.persistentId = datum.featureId;
      const lineMaterial = new THREE.LineBasicMaterial({ color: 0x69cdd8, transparent: true, opacity: .8 });
      if(datum.kind === "DatumPlane") {
        const plane = datum.resolved as DatumPlaneGeometry;
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshBasicMaterial({ color: 0x69cdd8, transparent: true, opacity: .08, side: THREE.DoubleSide, depthWrite: false }));
        holder.add(fill);
        const corners = [-40,-40,0, 40,-40,0, 40,40,0, -40,40,0, -40,-40,0];
        const border = new THREE.Line(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(corners,3)),lineMaterial);
        holder.add(border);this.pickables.push(border);
        holder.matrixAutoUpdate = false;
        holder.matrix.makeBasis(this.vector(plane.xAxis),this.vector(plane.yAxis),this.vector(plane.normal));holder.matrix.setPosition(this.vector(plane.originMm));
      } else if(datum.kind === "DatumAxis") {
        const axis = datum.resolved as DatumAxisGeometry;
        const origin=this.vector(axis.originMm),direction=this.vector(axis.direction);
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin.clone().addScaledVector(direction,-40),origin.clone().addScaledVector(direction,40)]),lineMaterial);
        holder.add(line);this.pickables.push(line);
      } else {
        lineMaterial.dispose();
        const point=datum.resolved as DatumPointGeometry;
        const sphere=new THREE.Mesh(new THREE.SphereGeometry(1.5,12,8),new THREE.MeshBasicMaterial({ color: 0x69cdd8 }));
        sphere.position.copy(this.vector(point.positionMm));holder.add(sphere);this.pickables.push(sphere);
      }
      holder.traverse(object => { object.userData.persistentId=datum.featureId;object.userData.datumStatus=datum.status; });
      this.group.add(holder);
    }
    this.group.updateMatrixWorld(true);this.highlight();
  }
  setSelection(ids: readonly string[],hovered: string | null): void { this.selected=new Set(ids);this.hovered=hovered;this.highlight(); }
  setSharedTargets(ids: readonly string[]): void { this.sharedTargets=new Set(ids);this.highlight(); }
  private highlight(): void {
    this.group.traverse(object => {
      const candidate=object as THREE.Mesh|THREE.Line;
      if(!candidate.material)return;
      const materials=Array.isArray(candidate.material)?candidate.material:[candidate.material];
      for(const material of materials) {
        const colored=material as THREE.MeshBasicMaterial|THREE.LineBasicMaterial;
        const id = object.userData.persistentId as string;
        const color = object.userData.datumStatus !== "ok" ? 0xff7070
          : this.selected.has(id) || this.hovered === id ? 0xffcf65
          : this.sharedTargets.has(id) ? 0x4bcab0
          : 0x69cdd8;
        colored.color?.setHex(color);
      }
    });
  }
  pick(ray: THREE.Raycaster): { id: string; distance: number } | null {
    const hit=ray.intersectObjects(this.pickables,false)[0];
    return hit ? { id: hit.object.userData.persistentId as string,distance: hit.distance } : null;
  }
  private clear(): void {
    this.group.traverse(object => {
      const candidate=object as THREE.Mesh|THREE.Line;
      candidate.geometry?.dispose();
      if(candidate.material)for(const material of Array.isArray(candidate.material)?candidate.material:[candidate.material])material.dispose();
    });
    this.group.clear();this.pickables=[];
  }
  dispose(): void { this.clear(); }
}
