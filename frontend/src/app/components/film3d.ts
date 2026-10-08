/**
 * Peyto Checker hero film, rebuilt in real 3D (three.js / WebGL).
 * Nothing is a bitmap photo: every element is geometry rendered at the screen's
 * native resolution, so the film is sharp at 4K.
 *
 * Story (16 s): Airtel data-centre corridor -> logo dissolves into light ->
 * light streams down the corridor -> ceiling lights become fibre -> network forms ->
 * primary / secondary path, fault, automatic reroute -> LSI / CKT / NETWORK / PEYTO ->
 * everything collapses into one fibre line -> PEYTO CHECKER.
 *
 * render(t) is deterministic: same t, same frame. That lets us skip, replay and
 * export a 4K MP4 frame by frame.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export const FILM_LENGTH = 16;

// ---------------------------------------------------------------- helpers
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const smooth = (k: number) => k * k * (3 - 2 * k);
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const RED = new THREE.Color('#ff0a12');
const WHITE = new THREE.Color('#ffffff');
const ORANGE = new THREE.Color('#ff8a1f');

// corridor dimensions (world units ~ metres)
const HALF_W = 3.7;       // inner face of the racks
const RACK_H = 3.2;
const CEIL = 4.5;
const Z_NEAR = 16, Z_FAR = -150;

// network, floating inside the corridor
const NET_Z = -31;
const N: Record<string, THREE.Vector3> = {
  A: V(-3.05, 1.65, NET_Z + 0.4),   // LSI
  J: V(-1.95, 1.65, NET_Z),         // CKT
  P1: V(-0.75, 2.95, NET_Z - 0.5), P2: V(0.75, 2.95, NET_Z - 0.5),
  S1: V(-0.75, 0.95, NET_Z + 0.5), S2: V(0.75, 0.95, NET_Z + 0.5),
  R1: V(0, 0.42, NET_Z + 1.3),      // reroute hop, low over the glossy floor
  Z: V(1.95, 1.65, NET_Z),          // PEYTO
  O: V(3.05, 1.65, NET_Z - 0.4),
};
const LINE_Y = 0.85;   // final fibre line height

// camera keyframes: [time, position, target]
const CAM: [number, THREE.Vector3, THREE.Vector3][] = [
  [0, V(0, 2.05, 12.5), V(0, 2.0, -40)],
  [3, V(0, 2.05, 9.6), V(0, 2.0, -40)],
  [5.5, V(0, 2.1, 1.5), V(0, 2.0, -40)],
  [7.5, V(0, 2.2, -12), V(0, 2.0, -35)],
  [9.2, V(0.2, 2.25, -23.5), V(0, 1.8, -31)],
  [11.2, V(1.5, 2.45, -24.8), V(0, 1.75, -31)],
  [13.4, V(-1.0, 2.75, -21.0), V(0, 1.75, -31)],
  [16, V(0, 2.0, -21.0), V(0, 2.25, -31)],
];

// ---------------------------------------------------------------- textures
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function glowTex() {
  return canvasTex(256, 256, c => {
    const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  });
}
function ringTex() {
  return canvasTex(256, 256, c => {
    c.strokeStyle = 'rgba(255,255,255,1)'; c.lineWidth = 6;
    c.shadowColor = 'white'; c.shadowBlur = 16;
    c.beginPath(); c.arc(128, 128, 100, 0, Math.PI * 2); c.stroke();
  });
}
/** rack front: base detail map + LED emissive map */
function rackTextures(seed: number) {
  const r = rng(seed);
  const W = 512, H = 2048;
  const units: { y: number; h: number }[] = [];
  for (let y = 40; y < H - 40;) { const h = r() < 0.7 ? 44 : 88; units.push({ y, h }); y += h + 4; }
  const base = canvasTex(W, H, c => {
    c.fillStyle = '#07080b'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#121419'; c.fillRect(14, 0, 16, H); c.fillRect(W - 30, 0, 16, H);  // rails
    for (const u of units) {
      c.fillStyle = r() < 0.5 ? '#0e1015' : '#0b0c10';
      c.fillRect(36, u.y, W - 72, u.h);
      c.fillStyle = '#1b1e25'; c.fillRect(36, u.y, W - 72, 2);
      // vent slots
      c.fillStyle = '#050608';
      for (let x = 60; x < W - 140; x += 9) c.fillRect(x, u.y + 10, 5, u.h - 20);
    }
  });
  const led = canvasTex(W, H, c => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    for (const u of units) {
      // a row of status LEDs on the right of each unit
      const n = 2 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) {
        const k = r();
        c.fillStyle = k < 0.62 ? '#9cc4ff' : k < 0.85 ? '#ffffff' : '#ff2a2a';
        c.globalAlpha = 0.45 + r() * 0.55;
        c.fillRect(W - 128 + i * 15, u.y + u.h / 2 - 3, 9, 6);
      }
      // occasional display strip
      if (r() < 0.18) { c.fillStyle = '#7fa8ff'; c.globalAlpha = 0.5; c.fillRect(60, u.y + u.h / 2 - 5, 70 + r() * 90, 10); }
      c.globalAlpha = 1;
    }
  });
  return { base, led };
}

// ---------------------------------------------------------------- streak shader
/** thick, soft, additive line segments drawn as screen-space quads (sharp at any resolution) */
class Streaks {
  readonly mesh: THREE.Mesh;
  private head: Float32Array; private tail: Float32Array; private col: Float32Array; private wid: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  count = 0;
  constructor(private max: number, private uniforms: { uRes: { value: THREE.Vector2 } }) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.head = new Float32Array(max * 3); this.tail = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.wid = new Float32Array(max);
    g.setAttribute('aHead', new THREE.InstancedBufferAttribute(this.head, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTail', new THREE.InstancedBufferAttribute(this.tail, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWidth', new THREE.InstancedBufferAttribute(this.wid, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms as any,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 aHead; attribute vec3 aTail; attribute vec4 aColor; attribute float aWidth;
        uniform vec2 uRes;
        varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 ch = projectionMatrix * viewMatrix * vec4(aHead, 1.0);
          vec4 ct = projectionMatrix * viewMatrix * vec4(aTail, 1.0);
          vec2 sh = ch.xy / ch.w, st = ct.xy / ct.w;
          vec2 d = (sh - st) * uRes;
          float len = length(d);
          vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
          vec2 n = vec2(-dir.y, dir.x);
          vec4 c = mix(ct, ch, position.x);
          float w = aWidth;
          vec2 off = n * position.y * w + dir * (position.x * 2.0 - 1.0) * w;
          c.xy += off / uRes * 2.0 * c.w;
          vUv = position.xy; vColor = aColor;
          gl_Position = c;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying vec4 vColor;
        void main() {
          float a = smoothstep(1.0, 0.0, abs(vUv.y));
          a *= a;
          a *= mix(0.15, 1.0, vUv.x);
          gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
  }
  begin() { this.count = 0; }
  add(h: THREE.Vector3, t: THREE.Vector3, c: THREE.Color, a: number, widthPx: number) {
    if (this.count >= this.max || a <= 0.002) return;
    const i = this.count++;
    this.head.set([h.x, h.y, h.z], i * 3); this.tail.set([t.x, t.y, t.z], i * 3);
    this.col.set([c.r, c.g, c.b, a], i * 4); this.wid[i] = widthPx;
  }
  end() {
    this.geo.instanceCount = this.count;
    for (const k of ['aHead', 'aTail', 'aColor', 'aWidth']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------- fibre tube
class Fibre {
  readonly mesh: THREE.Mesh;
  readonly curve: THREE.CatmullRomCurve3;
  private mat: THREE.MeshBasicMaterial;
  private total: number;
  constructor(points: THREE.Vector3[], radius: number, color: THREE.Color, segs = 160) {
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const g = new THREE.TubeGeometry(this.curve, segs, radius, 12, false);
    this.total = g.index!.count;
    this.mat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.layers.set(1);
  }
  set(progress: number, color: THREE.Color, intensity: number) {
    const n = Math.floor(clamp(progress) * this.total / 6) * 6;
    this.mesh.geometry.setDrawRange(0, n);
    this.mesh.visible = n > 0 && intensity > 0.002;
    this.mat.color.copy(color).multiplyScalar(intensity);
  }
}

// ---------------------------------------------------------------- the film
export interface Label { el: HTMLDivElement; }

export class Film3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.05, 400);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private uni = { uRes: { value: new THREE.Vector2(1, 1) } };

  private camPos: THREE.CatmullRomCurve3;
  private camTgt: THREE.CatmullRomCurve3;

  // corridor parts we animate
  private rackMats: THREE.MeshStandardMaterial[] = [];
  private ceilPanels!: THREE.InstancedMesh;
  private ceilData: { x: number; z: number; w: number; l: number }[] = [];
  private ceilMat!: THREE.MeshBasicMaterial;
  private stripMat!: THREE.MeshBasicMaterial;
  private redLights: THREE.PointLight[] = [];
  private hazeSprites: THREE.Sprite[] = [];

  // logo
  private logo!: THREE.Mesh;
  private logoUni = { uCut: { value: -0.1 }, uAlpha: { value: 1 }, map: { value: null as THREE.Texture | null } };
  private logoPts: { x: number; y: number; rel: number; sp: number; lane: number; up: number; w: number }[] = [];
  private logoW = 6.2; private logoCenter = V(-0.55, 2.05, 5.6);

  // fx
  private streaks: Streaks;
  private glow: THREE.Texture;
  private ring: THREE.Texture;
  private sprites: THREE.Sprite[] = [];
  private spriteN = 0;

  // network
  private fib: Record<string, Fibre> = {};
  private bgNodes: THREE.Vector3[] = [];
  private bgLinks: [number, number][] = [];
  private finalLine!: Fibre;
  private floorGlow!: THREE.Mesh;

  private labels: Record<string, HTMLDivElement> = {};
  /** label box sizes (css px), measured on resize since the font scales with the viewport */
  private labelSize: Record<string, { w: number; h: number }> = {};
  /** label positions of the last frame (css px), used when exporting the MP4 */
  labelState: { text: string; cls: string; x: number; y: number; a: number }[] = [];
  private cssW = 1; private cssH = 1;
  private w = 1; private h = 1;

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLElement, logoImage: HTMLImageElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#050102');
    this.scene.fog = new THREE.FogExp2('#0b0104', 0.022);

    this.glow = glowTex(); this.ring = ringTex();
    this.streaks = new Streaks(9000, this.uni);
    this.scene.add(this.streaks.mesh);

    this.camPos = new THREE.CatmullRomCurve3(CAM.map(k => k[1]), false, 'centripetal');
    this.camTgt = new THREE.CatmullRomCurve3(CAM.map(k => k[2]), false, 'centripetal');

    this.buildCorridor();
    this.buildLogo(logoImage);
    this.buildNetwork();
    this.buildLabels();

    // post: bloom + cinematic grade (vignette, grain, slight chromatic fringe)
    this.camera.layers.enable(1);   // layer 1 = hero light elements, kept out of the floor reflection
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.5, 0.86);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.13) * 43758.5453); }
        void main(){
          vec2 c = vUv - 0.5;
          float r2 = dot(c, c);
          vec2 off = c * 0.0018 * (1.0 + r2 * 4.0);
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + off).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - off).b;
          col *= 1.0 - smoothstep(0.18, 0.75, r2) * 0.62;          // vignette
          col = mix(col, col * vec3(1.06, 0.97, 0.97), 0.6);        // warm red grade
          col += (hash(vUv * uRes) - 0.5) * 0.012;                  // fine film grain
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  // ------------------------------------------------------------ build
  private buildCorridor() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#2a0a10', '#000000', 0.6));
    const blue = new THREE.DirectionalLight('#6f8cff', 0.18); blue.position.set(0, 3, 10); s.add(blue);

    // racks: dark bodies + detailed fronts with emissive LEDs (3 texture variants)
    const variants = [rackTextures(3), rackTextures(7), rackTextures(13)];
    const body = new THREE.MeshStandardMaterial({ color: '#08090c', roughness: 0.45, metalness: 0.7 });
    const pitch = 0.95, count = Math.ceil((Z_NEAR - Z_FAR) / pitch);
    const bodyGeo = new THREE.BoxGeometry(1.1, RACK_H, 0.9);
    const bodies = new THREE.InstancedMesh(bodyGeo, body, count * 2);
    const m4 = new THREE.Matrix4();
    let bi = 0;
    const fronts: THREE.Matrix4[][] = [[], [], []];
    const r = rng(42);
    for (let i = 0; i < count; i++) {
      const z = Z_NEAR - i * pitch;
      for (const side of [-1, 1]) {
        m4.makeTranslation(side * (HALF_W + 0.55), RACK_H / 2, z);
        bodies.setMatrixAt(bi++, m4);
        const f = new THREE.Matrix4().makeRotationY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
        f.setPosition(side * (HALF_W - 0.001), RACK_H / 2, z);
        fronts[Math.floor(r() * 3)].push(f);
      }
    }
    s.add(bodies);
    const frontGeo = new THREE.PlaneGeometry(0.88, RACK_H - 0.04);
    variants.forEach((v, k) => {
      const mat = new THREE.MeshStandardMaterial({
        map: v.base, emissiveMap: v.led, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 2.2,
        roughness: 0.35, metalness: 0.6,
      });
      this.rackMats.push(mat);
      const im = new THREE.InstancedMesh(frontGeo, mat, fronts[k].length);
      fronts[k].forEach((mm, i) => im.setMatrixAt(i, mm));
      s.add(im);
    });

    // ceiling: dark slab + grid of red light panels (3 columns), red strips over the racks
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 2.5, Z_NEAR - Z_FAR),
      new THREE.MeshStandardMaterial({ color: '#0a0507', roughness: 0.8 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, CEIL + 0.01, (Z_NEAR + Z_FAR) / 2); s.add(ceil);
    // walls above racks
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(Z_NEAR - Z_FAR, CEIL - RACK_H),
        new THREE.MeshStandardMaterial({ color: '#0c0608', roughness: 0.7 }));
      wall.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      wall.position.set(side * (HALF_W + 0.2), RACK_H + (CEIL - RACK_H) / 2, (Z_NEAR + Z_FAR) / 2); s.add(wall);
    }
    this.ceilMat = new THREE.MeshBasicMaterial({ color: RED.clone(), toneMapped: false });
    const cols = [-1.55, 0, 1.55];
    for (let z = Z_NEAR - 1; z > Z_FAR; z -= 2.1) for (const x of cols) this.ceilData.push({ x, z, w: x === 0 ? 1.35 : 1.25, l: 1.55 });
    this.ceilPanels = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.ceilMat, this.ceilData.length);
    this.ceilPanels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    s.add(this.ceilPanels);
    this.stripMat = new THREE.MeshBasicMaterial({ color: RED.clone().multiplyScalar(0.55), toneMapped: false });
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, Z_NEAR - Z_FAR), this.stripMat);
      strip.position.set(side * (HALF_W - 0.05), RACK_H + 0.04, (Z_NEAR + Z_FAR) / 2); s.add(strip);
      const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, Z_NEAR - Z_FAR), this.stripMat);
      strip2.position.set(side * (HALF_W + 0.15), CEIL - 0.05, (Z_NEAR + Z_FAR) / 2); s.add(strip2);
    }

    // red light pools from the ceiling
    for (let z = 12; z > -70; z -= 9) {
      const l = new THREE.PointLight('#ff1a1a', 18, 16, 1.6);
      l.position.set(0, CEIL - 0.4, z); s.add(l); this.redLights.push(l);
    }

    // glossy floor: real reflection under a dark tinted sheen
    const floorGeo = new THREE.PlaneGeometry(HALF_W * 2 + 2.2, Z_NEAR - Z_FAR);
    const refl = new Reflector(floorGeo, {
      clipBias: 0.003, textureWidth: 1920, textureHeight: 1080, color: 0x5a5a5a,
    });
    refl.rotation.x = -Math.PI / 2; refl.position.set(0, 0, (Z_NEAR + Z_FAR) / 2); s.add(refl);
    const sheen = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
      color: '#070203', roughness: 0.25, metalness: 0.4, transparent: true, opacity: 0.72,
    }));
    sheen.rotation.x = -Math.PI / 2; sheen.position.set(0, 0.002, (Z_NEAR + Z_FAR) / 2); s.add(sheen);
    // floor tile seams
    const seams = new THREE.GridHelper(Z_NEAR - Z_FAR, Math.round((Z_NEAR - Z_FAR) / 1.2), '#1a0a0d', '#1a0a0d');
    seams.scale.x = (HALF_W * 2 + 2.2) / (Z_NEAR - Z_FAR);
    seams.position.set(0, 0.004, (Z_NEAR + Z_FAR) / 2); (seams.material as THREE.Material).transparent = true; (seams.material as THREE.Material).opacity = 0.5;
    s.add(seams);

    // soft volumetric haze cards under the lights (additive)
    for (let z = 10; z > -80; z -= 6) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#ff2020', transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(0, CEIL - 1.0, z); sp.scale.set(8, 3.2, 1); s.add(sp); this.hazeSprites.push(sp);
    }
  }

  private buildLogo(img: HTMLImageElement) {
    // rasterise the vector logo at 4096 px so it stays crisp at 4K
    const W = 4096, H = Math.round(4096 * img.naturalHeight / img.naturalWidth) || 1860;
    const tex = canvasTex(W, H, c => c.drawImage(img, 0, 0, W, H));
    this.logoUni.map.value = tex;
    const aspect = H / W;
    const geo = new THREE.PlaneGeometry(this.logoW, this.logoW * aspect);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.logoUni as any, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float uCut; uniform float uAlpha; varying vec2 vUv;
        void main(){
          vec4 t = texture2D(map, vUv);
          float edge = smoothstep(uCut - 0.012, uCut + 0.012, vUv.x);
          float rim = (1.0 - abs(vUv.x - uCut) / 0.03);
          rim = clamp(rim, 0.0, 1.0);
          vec3 col = vec3(0.82) + vec3(1.2, 0.12, 0.12) * rim * 1.4;   // hot red edge where it dissolves
          gl_FragColor = vec4(col, t.a * edge * uAlpha);
        }`,
    });
    this.logo = new THREE.Mesh(geo, mat);
    this.logo.position.copy(this.logoCenter);
    this.logo.layers.set(1);
    this.scene.add(this.logo);

    // particles sampled from the logo's pixels
    const sw = 900, sh = Math.round(900 * aspect);
    const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
    const c = cv.getContext('2d')!; c.drawImage(img, 0, 0, sw, sh);
    const data = c.getImageData(0, 0, sw, sh).data;
    const r = rng(9);
    const pts: { x: number; y: number }[] = [];
    for (let y = 0; y < sh; y += 2) for (let x = 0; x < sw; x += 2) if (data[(y * sw + x) * 4 + 3] > 128) pts.push({ x, y });
    for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
    for (const p of pts.slice(0, 5200)) {
      const u = p.x / sw, v = p.y / sh;
      this.logoPts.push({
        x: (u - 0.5) * this.logoW, y: (0.5 - v) * this.logoW * aspect,
        rel: 3.0 + u * 1.5 + r() * 0.35, sp: 0.7 + r() * 0.8,
        lane: (r() - 0.5) * 2, up: r(), w: 1.2 + r() * 2.2,
      });
    }
  }

  private buildNetwork() {
    const c = (...k: string[]) => k.map(n => N[n]);
    const mid = (a: THREE.Vector3, b: THREE.Vector3, dy = 0, dz = 0) => a.clone().add(b).multiplyScalar(0.5).add(V(0, dy, dz));
    const R = 0.034;
    this.fib['in'] = new Fibre(c('A', 'J'), R, WHITE);
    this.fib['p'] = new Fibre([N['J'], mid(N['J'], N['P1'], 0.12), N['P1'], N['P2'], mid(N['P2'], N['Z'], 0.12), N['Z']], R, WHITE);
    this.fib['s1'] = new Fibre([N['J'], mid(N['J'], N['S1'], -0.12), N['S1']], R, RED);
    this.fib['sf'] = new Fibre(c('S1', 'S2'), R, RED, 60);
    this.fib['s2'] = new Fibre([N['S2'], mid(N['S2'], N['Z'], -0.12), N['Z']], R, RED);
    this.fib['rr'] = new Fibre([N['S1'], mid(N['S1'], N['R1'], -0.1, 0.3), N['R1'], mid(N['R1'], N['S2'], -0.1, 0.3), N['S2']], R, RED);
    this.fib['out'] = new Fibre(c('Z', 'O'), R, WHITE);
    Object.values(this.fib).forEach(f => this.scene.add(f.mesh));
    this.floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(12, 7), new THREE.MeshBasicMaterial({
      map: this.glow, color: RED.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }));
    this.floorGlow.rotation.x = -Math.PI / 2; this.floorGlow.position.set(0, 0.01, NET_Z + 0.5);
    this.scene.add(this.floorGlow);
    this.finalLine = new Fibre([V(-30, LINE_Y, NET_Z), V(0, LINE_Y, NET_Z), V(30, LINE_Y, NET_Z)], 0.03, WHITE, 400);
    this.scene.add(this.finalLine.mesh);

    // background mesh of network elements around the main ring
    const r = rng(77);
    for (let i = 0; i < 90; i++) {
      this.bgNodes.push(V((r() - 0.5) * 7.0, 0.35 + r() * 3.9, NET_Z - 2 - r() * 26 + (r() < 0.25 ? 10 : 0)));
    }
    this.bgNodes.forEach((n, i) => {
      const near = this.bgNodes.map((m, j) => ({ j, d: m.distanceTo(n) })).filter(o => o.j > i).sort((a, b) => a.d - b.d).slice(0, 2);
      near.filter(o => o.d < 4.5).forEach(o => this.bgLinks.push([i, o.j]));
    });
  }

  private buildLabels() {
    const mk = (key: string, text: string, cls = '') => {
      const el = document.createElement('div');
      el.className = 'f3-label ' + cls; el.textContent = text;
      this.overlay.appendChild(el); this.labels[key] = el;
    };
    mk('prim', 'PRIMARY PATH'); mk('sec', 'SECONDARY PATH'); mk('rr', 'AUTO-REROUTED', 'warm');
    mk('lsi', 'LSI'); mk('ckt', 'CKT ID'); mk('net', 'NPT RING'); mk('peyto', 'PEYTO');
    mk('ok', 'PROTECTED ✓', 'ok');
  }

  // ------------------------------------------------------------ sprites pool
  private sprite(pos: THREE.Vector3, size: number, color: THREE.Color, a: number, tex = this.glow) {
    if (a <= 0.003) return;
    let sp = this.sprites[this.spriteN];
    if (!sp) {
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sp.layers.set(1);
      this.scene.add(sp); this.sprites.push(sp);
    }
    this.spriteN++;
    const m = sp.material as THREE.SpriteMaterial;
    m.map = tex; m.color.copy(color).multiplyScalar(a); m.opacity = 1;
    sp.visible = true; sp.position.copy(pos); sp.scale.set(size, size, 1);
  }

  // ------------------------------------------------------------ resize
  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW; this.cssH = cssH;
    this.w = Math.max(1, Math.round(cssW * dpr)); this.h = Math.max(1, Math.round(cssH * dpr));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(cssW, cssH);
    this.bloom.resolution.set(this.w / 2, this.h / 2);
    this.camera.aspect = cssW / cssH;
    // keep the corridor framing on tall/narrow screens
    this.camera.fov = cssW / cssH < 1.3 ? 62 : 48;
    this.camera.updateProjectionMatrix();
    this.uni.uRes.value.set(this.w, this.h);
    (this.grade.uniforms as any).uRes.value.set(this.w, this.h);
    this.dpr = dpr;
    for (const [k, el] of Object.entries(this.labels)) this.labelSize[k] = { w: el.offsetWidth, h: el.offsetHeight };
  }
  private dpr = 1;

  // ------------------------------------------------------------ render
  render(time: number) {
    const t = Math.min(time, FILM_LENGTH);
    const d = this.dpr;

    // ---- camera ----
    const kt = CAM.map(k => k[0]);
    let i = 0; while (i < kt.length - 2 && t > kt[i + 1]) i++;
    const local = smooth(seg(t, kt[i], kt[i + 1]));
    // blend linear-in-key mapping with an overall ease for gentle starts/stops
    const s = (i + local) / (kt.length - 1);
    const eased = lerp(s, ease(t / FILM_LENGTH), 0.25);
    const pos = this.camPos.getPoint(clamp(eased));
    const tgt = this.camTgt.getPoint(clamp(eased));
    // a breath of handheld-free drift
    pos.y += Math.sin(time * 0.6) * 0.015;
    this.camera.position.copy(pos);
    this.camera.lookAt(tgt);

    // ---- corridor life ----
    const corridorDim = lerp(1, 0.55, ease(seg(t, 6.5, 9))) * lerp(1, 0.9, ease(seg(t, 14, 16)));
    const flick = 0.92 + 0.08 * Math.sin(time * 3.1) * Math.sin(time * 1.7);
    this.rackMats.forEach((m, k) => m.emissiveIntensity = 2.2 * corridorDim * (k === 1 ? flick : 1));
    const pulse = 1 + 0.08 * Math.sin(time * 1.3);
    this.redLights.forEach(l => l.intensity = 18 * pulse * corridorDim);
    // ceiling panels stretch into continuous light lines -> fibre
    const stretch = ease(seg(t, 5.2, 8.2));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    this.ceilData.forEach((p, k) => {
      const w = lerp(p.w, p.x === 0 ? 0.08 : 0.05, stretch);
      const l = lerp(p.l, 2.15, stretch);
      m4.compose(V(p.x * lerp(1, 0.75, stretch), CEIL, p.z), q, V(w, l, 1));
      this.ceilPanels.setMatrixAt(k, m4);
    });
    this.ceilPanels.instanceMatrix.needsUpdate = true;
    this.ceilMat.color.copy(RED).multiplyScalar(0.95 * pulse * lerp(1, 1.25, stretch) * corridorDim);
    this.hazeSprites.forEach(h => (h.material as THREE.SpriteMaterial).opacity = 0.09 * pulse * corridorDim);

    // ---- logo dissolve ----
    this.logoUni.uCut.value = lerp(-0.05, 1.08, seg(t, 3.0, 4.75));
    this.logoUni.uAlpha.value = 1;
    this.logo.visible = t < 5;

    // ---- per-frame fx ----
    this.streaks.begin();
    this.spriteN = 0;

    // logo particles -> light streams flowing down the corridor
    if (t > 2.95 && t < 10) {
      const fade = 1 - seg(t, 8.2, 9.6);
      const lc = this.logoCenter;
      const h = new THREE.Vector3(), tl = new THREE.Vector3();
      const at = (p: typeof this.logoPts[0], age: number, out: THREE.Vector3) => {
        // accelerate away from camera, drifting into lanes along the ceiling and the floor
        const z = lc.z - (age * age * 6.0 + age * 3.5) * p.sp;
        const k = clamp(age / 2.2);
        const laneY = p.up > 0.5 ? CEIL - 0.25 - p.up * 0.4 : 0.3 + p.up * 0.6;
        out.set(lerp(lc.x + p.x, p.lane * 1.6, smooth(k)), lerp(lc.y + p.y, laneY, smooth(k)), z);
        return out;
      };
      for (const p of this.logoPts) {
        if (t < p.rel) continue;
        const age = t - p.rel;
        at(p, age, h); at(p, Math.max(0, age - 0.09 - age * 0.05), tl);
        const hot = clamp(1 - age * 0.9);
        const col = new THREE.Color().copy(RED).lerp(WHITE, hot);
        this.streaks.add(h, tl, col, clamp(age * 4) * fade * (0.55 + 0.45 * hot), p.w * d);
      }
    }

    // light pulses racing along the ceiling lines toward camera (the "fibre" moment)
    const railA = ease(seg(t, 5.6, 7.0)) * (1 - ease(seg(t, 8.4, 9.6)));
    if (railA > 0) {
      const r = rng(5);
      for (let k = 0; k < 70; k++) {
        const x = [-1.55, 0, 1.55][k % 3] * lerp(1, 0.75, stretch);
        const y = CEIL - 0.02;
        const sp = 14 + r() * 16, off = r() * 80;
        const z = Z_FAR + ((time * sp + off * 3) % 140);
        const zz = z > this.camera.position.z + 2 ? z - 140 : z;
        const hh = V(x, y, zz), tt = V(x, y, zz - 2.5 - r() * 2);
        this.streaks.add(hh, tt, WHITE, 0.55 * railA, 1.8 * d);
        // and mirrored low, along the floor edge
        if (k % 2 === 0) this.streaks.add(V(x * 1.9, 0.03, zz - 7), V(x * 1.9, 0.03, zz - 10), RED, 0.4 * railA, 1.6 * d);
      }
    }

    // ---- network ----
    const netA = ease(seg(t, 7.6, 9.2));
    const col = ease(seg(t, 14.0, 15.0));       // collapse into one line
    const netFade = 1 - ease(seg(t, 14.2, 14.9));
    const draw = (k: number) => clamp(k);
    const split = seg(t, 8.6, 10.0);
    const fault = seg(t, 10.3, 10.6);
    const dim = ease(seg(t, 10.7, 11.2));
    const rr = ease(seg(t, 11.0, 11.9));
    const verdict = ease(seg(t, 13.0, 13.6));
    const flickF = fault > 0 && dim < 1 ? 0.55 + 0.45 * Math.sin(time * 26) : 1;

    this.fib['in'].set(draw(seg(t, 7.8, 8.7)), WHITE, 0.95 * netA * netFade);
    this.fib['p'].set(split, WHITE, lerp(0.95, 1.25, verdict) * netA * netFade);
    this.fib['s1'].set(seg(t, 8.8, 9.5), RED, 1.35 * netA * netFade);
    this.fib['sf'].set(seg(t, 9.4, 9.8), fault > 0 ? ORANGE : RED, (fault > 0 ? lerp(1.6, 0.18, dim) * flickF : 1.35) * netA * netFade);
    this.fib['s2'].set(seg(t, 9.7, 10.2), RED, 1.35 * netA * netFade);
    this.fib['rr'].set(rr, RED, 1.6 * netA * netFade);
    this.fib['out'].set(seg(t, 9.9, 10.4), WHITE, 0.95 * netA * netFade);

    // background mesh: faint links + twinkling nodes (keeps the frame alive, never empty)
    const bgA = netA * (0.5 + 0.5 * ease(seg(t, 11.8, 13.4))) * netFade;
    if (bgA > 0.01) {
      for (const [a, b] of this.bgLinks) {
        this.streaks.add(this.bgNodes[a], this.bgNodes[b], RED, 0.22 * bgA, 1.3 * d);
      }
      this.bgNodes.forEach((n, k) => {
        const tw = 0.55 + 0.45 * Math.sin(time * 1.5 + k * 1.7);
        this.sprite(n, 0.16, k % 5 === 0 ? WHITE : RED, 0.75 * tw * bgA);
      });
      // packets on background links
      this.bgLinks.forEach(([a, b], k) => {
        if (k % 3) return;
        const u = (time * 0.35 + k * 0.137) % 1;
        const p = this.bgNodes[a].clone().lerp(this.bgNodes[b], u);
        this.sprite(p, 0.12, WHITE, 0.55 * bgA);
      });
    }

    // nodes on the main ring (slide onto the final line during the collapse)
    const nodePos = (n: string) => {
      const p = N[n].clone();
      if (col > 0) { p.y = lerp(p.y, LINE_Y, col); p.z = lerp(p.z, NET_Z, col); p.x = lerp(p.x, p.x * 1.8, col); }
      return p;
    };
    const nodeA = netA * (1 - ease(seg(t, 14.8, 15.4)));
    const mainNodes: [string, number][] = [['A', seg(t, 7.8, 8.2)], ['J', seg(t, 8.4, 8.8)], ['P1', split], ['P2', split],
      ['S1', seg(t, 9.2, 9.5)], ['S2', seg(t, 9.7, 10)], ['Z', seg(t, 10, 10.3)], ['O', seg(t, 10.3, 10.5)], ['R1', rr]];
    for (const [n, k] of mainNodes) {
      if (k <= 0) continue;
      const p = nodePos(n);
      const big = n === 'Z' ? 1.6 + 0.25 * Math.sin(time * 2.4) : 1;
      this.sprite(p, 0.32 * big, n === 'R1' ? new THREE.Color('#ff6a6a') : WHITE, 1.1 * k * nodeA);
      this.sprite(p, 1.0 * big, RED, 0.35 * k * nodeA);
      if (n === 'Z') this.sprite(p, 0.62 * big, WHITE, 0.3 * k * nodeA, this.ring);
    }

    // data pulses travelling on the fibres
    const pulses = (f: Fibre, n: number, speed: number, c: THREE.Color, a: number, prog = 1) => {
      if (a <= 0.01) return;
      for (let k = 0; k < n; k++) {
        const u = ((time * speed + k / n) % 1) * prog;
        const p = f.curve.getPointAt(u);
        this.sprite(p, 0.26, c, a * 0.9);
        // short motion trail
        const p2 = f.curve.getPointAt(Math.max(0, u - 0.04));
        this.streaks.add(p, p2, c, a * 0.6, 3 * d);
      }
    };
    const pa = netA * netFade;
    pulses(this.fib['in'], 2, 0.5, WHITE, pa * seg(t, 8.7, 9));
    pulses(this.fib['p'], 4, 0.32, WHITE, pa * seg(t, 10, 10.4));
    pulses(this.fib['out'], 2, 0.5, WHITE, pa * seg(t, 10.4, 10.7));
    if (dim < 0.4) { pulses(this.fib['s1'], 2, 0.45, new THREE.Color('#ffb0b0'), pa * seg(t, 10, 10.3)); pulses(this.fib['sf'], 1, 0.6, new THREE.Color('#ffb0b0'), pa * seg(t, 10, 10.3)); }
    if (rr > 0.95) { pulses(this.fib['s1'], 2, 0.45, new THREE.Color('#ffb0b0'), pa); pulses(this.fib['rr'], 3, 0.4, new THREE.Color('#ffb0b0'), pa); pulses(this.fib['s2'], 2, 0.45, new THREE.Color('#ffb0b0'), pa); }

    // fault: orange shockwave rings on the broken span
    const fm = N['S1'].clone().lerp(N['S2'], 0.5);
    if (fault > 0 && t < 13.9) {
      for (let k = 0; k < 2; k++) {
        const ph = (time * 1.1 + k * 0.5) % 1;
        this.sprite(fm, 0.25 + ph * 1.1, ORANGE, (1 - ph) * 0.9 * netFade, this.ring);
      }
      this.sprite(fm, 0.8, ORANGE, 0.45 * (1 - dim * 0.6) * netFade);
    }

    (this.floorGlow.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.max(netA * netFade, ease(seg(t, 14.3, 15.3)));

    // final fibre line: grows from the centre out, carries light left -> right
    const lineA = ease(seg(t, 14.3, 15.3));
    this.finalLine.set(1, WHITE, 1.0 * lineA);
    if (lineA > 0) {
      // reveal from centre using a stretch on x
      this.finalLine.mesh.scale.x = lerp(0.02, 1, ease(seg(t, 14.3, 15.4)));
      for (let k = 0; k < 6; k++) {
        const u = (time * 0.07 + k / 6) % 1;
        const p = V(lerp(-14, 14, u), LINE_Y, NET_Z);
        this.sprite(p, 0.4, WHITE, 0.9 * lineA);
        this.sprite(p, 1.4, RED, 0.4 * lineA);
        this.streaks.add(p, V(p.x - 1.6, LINE_Y, NET_Z), WHITE, 0.6 * lineA, 3 * d);
      }
      // the line's red glow on the floor
      this.sprite(V(0, 0.05, NET_Z + 0.6), 14, RED, 0.1 * lineA);
    }
    // collapsing nodes streak into the line
    if (col > 0 && col < 1) {
      for (const n of ['P1', 'P2', 'S1', 'S2', 'R1']) {
        const p = nodePos(n), q2 = N[n].clone().lerp(p, Math.max(0, col - 0.25));
        this.streaks.add(p, q2, WHITE, 0.9 * (1 - col), 5 * d);
      }
    }

    // hide unused sprites
    for (let k = this.spriteN; k < this.sprites.length; k++) this.sprites[k].visible = false;
    this.streaks.end();

    // ---- labels (crisp HTML, positioned from 3D) ----
    const labA = netA * netFade;
    this.labelState = [];
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const M = 8;   // keep labels this far inside the screen edge
    const place = (key: string, p: THREE.Vector3, dy: number, a: number) => {
      const el = this.labels[key];
      if (a <= 0.01) { el.style.opacity = '0'; return; }
      const v = p.clone().project(this.camera);
      const { w, h } = this.labelSize[key];
      let x = (v.x + 1) / 2 * this.cssW, y = (1 - v.y) / 2 * this.cssH + dy;
      // narrow screens: clamp inside the viewport, then step down past any label already placed
      x = clamp(x, w / 2 + M, Math.max(w / 2 + M, this.cssW - w / 2 - M));
      for (const o of placed) {
        if (Math.abs(x - o.x) < (w + o.w) / 2 && Math.abs(y - o.y) < (h + o.h) / 2) y = o.y + (h + o.h) / 2 + 4;
      }
      placed.push({ x, y, w, h });
      el.style.opacity = a.toFixed(3);
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      this.labelState.push({ text: el.textContent || '', cls: el.className, x, y, a });
    };
    const lab = (k0: number) => ease(seg(t, k0, k0 + 0.5)) * labA;
    place('prim', N['P1'].clone().lerp(N['P2'], 0.5), -34, lab(9.7));
    place('sec', fm, 34, lab(9.9) * (1 - 0.5 * dim));
    place('rr', N['R1'], 32, lab(11.6));
    place('lsi', N['A'], -34, lab(12.1));
    place('ckt', N['J'], -34, lab(12.4));
    place('net', N['P1'].clone().lerp(N['S1'], 0.5).add(V(-0.25, 0, 0)), 0, lab(12.7));
    place('peyto', N['Z'], -40, lab(12.9));
    place('ok', N['Z'], 42, ease(seg(t, 13.2, 13.7)) * labA);

    // ---- post ----
    this.bloom.strength = 0.7 + 0.15 * ease(seg(t, 7.5, 9)) - 0.15 * ease(seg(t, 14.5, 16));
    (this.grade.uniforms as any).uTime.value = Math.floor(time * 24) / 24;
    this.composer.render();
  }

  get glCanvas() { return this.canvas; }

  dispose() {
    // free every GPU resource, then drop the context so revisiting / does not stack contexts
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach(mat => {
        Object.values(mat).forEach(v => { if (v instanceof THREE.Texture) v.dispose(); });
        mat.dispose();
      });
    });
    this.glow.dispose(); this.ring.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    Object.values(this.labels).forEach(l => l.remove());
  }
}
