<script setup lang="ts">
/**
 * Rotatable 3D preview of the cube.
 *
 * The faces are textured with the very same canvases the pipeline encodes and
 * sends, so the preview cannot drift from what the panels actually show.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';

import type { CubeFace } from '@shared/types';

import { useStudio } from '@/stores/studio';
import { useI18n } from '@/i18n/useI18n';

const studio = useStudio();
const { t } = useI18n();
const host = ref<HTMLDivElement | null>(null);

/** BoxGeometry material order. */
const FACE_ORDER: CubeFace[] = ['right', 'left', 'top', 'bottom', 'front', 'back'];

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let cube: THREE.Mesh;
/** Face texture plus the slot it mirrors, so uploads can be skipped. */
let faceTextures: { texture: THREE.CanvasTexture; slot: number; seenVersion: number }[] = [];
let raf = 0;
let observer: ResizeObserver | null = null;
/** Set whenever something changed; cleared after a render. */
let dirty = true;

// orbit state
const rotation = { x: -0.35, y: 0.6 };
let dragging = false;
let last = { x: 0, y: 0 };
let distance = 4.4;

/** Back and bottom carry no display -- plain chassis. */
function blankMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x11182a });
}

function buildMaterials(): THREE.Material[] {
  for (const entry of faceTextures) entry.texture.dispose();
  faceTextures = [];

  const materials = FACE_ORDER.map((face) => {
    const slotIndex = studio.slots.findIndex((s) => s.face === face);
    if (slotIndex < 0) return blankMaterial();
    const canvas = studio.pipeline.slots[slotIndex]?.canvas.canvas;
    if (!canvas) return blankMaterial();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // The panels are mounted with the image upright; no extra flip here.
    texture.flipY = true;
    faceTextures.push({ texture, slot: slotIndex, seenVersion: -1 });
    return new THREE.MeshBasicMaterial({ map: texture });
  });

  dirty = true;
  return materials;
}

function resize(): void {
  if (!renderer || !host.value) return;
  const { clientWidth: w, clientHeight: h } = host.value;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}

/**
 * Render on demand.
 *
 * Uploading four 720x720 textures every animation frame would cost ~480 MB/s of
 * GPU traffic for a picture that never changes, so a texture is re-uploaded only
 * when its slot repainted, and the scene is redrawn only when something moved.
 */
function animate(): void {
  raf = requestAnimationFrame(animate);
  if (!renderer) return;

  for (const entry of faceTextures) {
    const version = studio.pipeline.slots[entry.slot]?.version ?? 0;
    if (version === entry.seenVersion) continue;
    entry.seenVersion = version;
    entry.texture.needsUpdate = true;
    dirty = true;
  }

  // Ease towards the target orientation; stop once it has effectively arrived.
  const dx = rotation.x - cube.rotation.x;
  const dy = rotation.y - cube.rotation.y;
  const dd = distance - camera.position.length();
  if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4 || Math.abs(dd) > 1e-4) {
    cube.rotation.x += dx * 0.15;
    cube.rotation.y += dy * 0.15;
    camera.position.setLength(camera.position.length() + dd * 0.2);
    dirty = true;
  }

  if (!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
}

function onPointerDown(e: PointerEvent): void {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return;
  rotation.y += (e.clientX - last.x) * 0.008;
  rotation.x += (e.clientY - last.y) * 0.008;
  rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.x));
  last = { x: e.clientX, y: e.clientY };
}

function onPointerUp(e: PointerEvent): void {
  dragging = false;
  (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  distance = Math.max(2.8, Math.min(9, distance + e.deltaY * 0.002));
}

function resetView(): void {
  rotation.x = -0.35;
  rotation.y = 0.6;
  distance = 4.4;
}

onMounted(() => {
  if (!host.value) return;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(2.4, 1.8, 3.2);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.value.appendChild(renderer.domElement);

  cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), buildMaterials());
  scene.add(cube);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.005, 2.005, 2.005)),
    new THREE.LineBasicMaterial({ color: 0x7c5cff }),
  );
  cube.add(edges);

  observer = new ResizeObserver(resize);
  observer.observe(host.value);
  resize();
  animate();
});

// Re-texture when the slot-to-face mapping changes.
watch(
  () => studio.slots.map((s) => s.face).join(','),
  () => {
    if (cube) cube.material = buildMaterials();
  },
);

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  observer?.disconnect();
  for (const entry of faceTextures) entry.texture.dispose();
  renderer?.dispose();
  renderer?.domElement.remove();
  renderer = null;
});

defineExpose({ resetView });
</script>

<template>
  <div class="relative h-full w-full">
    <div
      ref="host"
      class="h-full w-full cursor-grab active:cursor-grabbing"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
    />
    <div class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-slate-500">
      {{ t('ui.dragToRotate') }}
    </div>
    <button
      class="absolute right-3 top-3 rounded-md border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
      @click="resetView"
    >
      {{ t('cube.resetView') }}
    </button>
  </div>
</template>
