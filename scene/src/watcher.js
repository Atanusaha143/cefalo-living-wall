import * as THREE from '../vendor/three.module.js';
import { LOGO_GLSL, OVERCAST_GLSL } from './photo-layer.js';

// HR's eyes, drawn over the photo's own: the whites, then each iris (copied from where the
// photo has it) moved to where gaze.js says he is looking, then the lids when he blinks or
// squints. The leaves are drawn over them, as over the rest of him.
export const EYE = {
  iris: 6.8,                         // iris radius, units
  rest: [[756.4, 257.0], [836.6, 255.6]],   // the photo's irises
  opening: [[756.0, 255.8, 18.0, 5.0], [835.0, 255.0, 19.0, 5.0]],   // centre x, y, half width, half height
  travel: { x: 8, y: 1.2 },          // units an iris moves at gaze ±1
  // The whites as the photo has them (sRGB 112, 102, 76: he is in the hedge's shade), linear.
  white: [0.162, 0.133, 0.072],
};
export const EYE_BOX = { x0: 726, y0: 240, x1: 866, y1: 272 };

export function createWatcher(photo, gaze) {
  const uniforms = {
    uPhoto: { value: photo }, uOvercast: { value: 0 }, uChill: { value: 0 }, uLid: { value: 0 },
    uIris: { value: EYE.rest.map(([x, y]) => new THREE.Vector2(x, y)) },
    uOpening: { value: EYE.opening.map(([x, y, a, b]) => new THREE.Vector4(x, y, a, b)) },
  };
  const box = EYE_BOX, width = box.x1 - box.x0, height = box.y1 - box.y0;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vWall;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWall = vec2(w.x, -w.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${LOGO_GLSL}
      ${OVERCAST_GLSL}
      uniform vec2 uIris[2];
      uniform vec4 uOpening[2];
      uniform float uLid;
      varying vec2 vWall;
      const vec2 REST0 = vec2(${EYE.rest[0].map((v) => v.toFixed(1)).join(', ')});
      const vec2 REST1 = vec2(${EYE.rest[1].map((v) => v.toFixed(1)).join(', ')});
      const vec3 WHITE = vec3(${EYE.white.map((v) => v.toFixed(3)).join(', ')});
      void main() {
        vec2 p = vWall;
        int i = p.x < ${((EYE_BOX.x0 + EYE_BOX.x1) / 2).toFixed(1)} ? 0 : 1;
        vec4 o = i == 0 ? uOpening[0] : uOpening[1];
        vec2 iris = i == 0 ? uIris[0] : uIris[1], rest = i == 0 ? REST0 : REST1;
        vec2 q = (p - o.xy) / o.zw;
        if (abs(q.x) >= 1.0) discard;
        float h = pow(1.0 - q.x * q.x, 0.75);   // the opening's half height here, almond-shaped
        if (abs(q.y) >= h) discard;
        // The whites, darker towards the lids and the corners.
        // The upper lid shades the top of the eye.
        float shade = mix(0.5, 1.0, smoothstep(1.0, 0.3, abs(q.y) / h)) * mix(0.6, 1.0, smoothstep(1.0, 0.4, abs(q.x)));
        shade *= mix(0.6, 1.0, smoothstep(-1.0, 0.2, q.y / h));
        vec3 c = WHITE * shade;
        // The iris, taken from the photo's and moved.
        float d = distance(p, iris);
        vec3 photoIris = texture2D(uPhoto, uvOf(rest + (p - iris))).rgb;
        c = mix(c, photoIris, 1.0 - smoothstep(${(EYE.iris - 1).toFixed(1)}, ${EYE.iris.toFixed(1)}, d));
        // The upper lid comes down, curved as it is: skin from just above the eye, lashes at its edge.
        float lidEdge = -h + 2.0 * uLid;
        vec3 skin = 0.92 * texture2D(uPhoto, uvOf(vec2(p.x, o.y - o.w * 2.4 + (q.y + h) * o.w * 0.5))).rgb;
        if (uLid > 0.02) c *= mix(0.3, 1.0, smoothstep(0.0, 0.45, q.y - lidEdge));
        c = mix(skin, c, smoothstep(lidEdge - 0.08, lidEdge + 0.08, q.y));
        float alpha = smoothstep(0.0, 0.35, h - abs(q.y)) * smoothstep(1.0, 0.75, abs(q.x));
        gl_FragColor = vec4(overcast(c), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  mesh.position.set(box.x0 + width / 2, -(box.y0 + height / 2), 0);
  mesh.renderOrder = 0.5;   // over the photo, under every leaf
  return {
    mesh,
    gaze,
    /** dt, t: seconds; pointer: {x, y} in wall units or null; the sky as the photo layer has it. */
    update(dt, t, pointer, { overcast = 0, chill = 0 } = {}) {
      gaze.step(dt, t, pointer);
      gaze.eyes.forEach((g, i) => uniforms.uIris.value[i].set(EYE.rest[i][0] + g.x * EYE.travel.x, EYE.rest[i][1] + g.y * EYE.travel.y));
      uniforms.uLid.value = gaze.lid;
      uniforms.uOvercast.value = overcast;
      uniforms.uChill.value = chill;
    },
  };
}
