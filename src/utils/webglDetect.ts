import type * as THREE from 'three';

let cachedSoftwareGl: boolean | null = null;

/**
 * Detects software WebGL renderers (SwiftShader, llvmpipe, WARP) using the GPU renderer string
 * and frees the probe context immediately. Used exclusively to tune rendering cost
 * (pixel ratio, AA, shadows, and afterDraw pacing) without changing scene content or logic.
 */
export function detectSoftwareWebGL(): boolean {
  if (cachedSoftwareGl !== null) return cachedSoftwareGl;
  if (typeof document === 'undefined') return false;

  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) {
      cachedSoftwareGl = true;
      return true;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    cachedSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return cachedSoftwareGl;
  } catch {
    cachedSoftwareGl = true;
    return true;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Software-WebGL frame pacer: waits for GPU command completion fence before waiting 80ms
 * so headless/CPU WebGL never starves DOM rendering or input responsiveness.
 */
export function scheduleAfterDraw(
  renderer: THREE.WebGLRenderer,
  cb: () => void,
  registerTimer: (id: number) => void
): void {
  try {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      const id = window.setTimeout(cb, 80);
      registerTimer(id);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        const id = window.setTimeout(poll, 5);
        registerTimer(id);
      } else {
        if (sync) gl.deleteSync(sync);
        const id = window.setTimeout(cb, 80);
        registerTimer(id);
      }
    };
    const id = window.setTimeout(poll, 5);
    registerTimer(id);
  } catch {
    const id = window.setTimeout(cb, 80);
    registerTimer(id);
  }
}
