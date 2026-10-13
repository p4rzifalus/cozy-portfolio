import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import Room from "./Room";
import { GRADE, PAINT } from "./painterly";
import Overlay from "./Overlay";
import { view } from "./Interact";

// Colour management like Blender: AgX view + exposure (stops). "Punchy" look is approximated in the shader.
// Values fitted against the Blender "site look" render of camera 1 (screenshots/111_baked_cam1.png), 2026-10-13:
// three.js AgX takes a different input scale than Blender's, so the exposure is not Blender's 1.15.
const EXPOSURE_STOPS = -0.2;

export default function App() {
  return (
    <>
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: import.meta.env.DEV }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.AgXToneMapping;
        view.exposure = Math.pow(2, EXPOSURE_STOPS);   // applied every frame by Interact (meditation dims it)
        gl.outputColorSpace = THREE.SRGBColorSpace;
        if (import.meta.env.DEV)
          (window as unknown as Record<string, unknown>).__grade = (exposure: number, contrast: number, saturation: number) => {
            view.exposure = Math.pow(2, exposure);
            GRADE.contrast.value = contrast;
            GRADE.saturation.value = saturation;
          };
        if (import.meta.env.DEV)
          (window as unknown as Record<string, unknown>).__paint = (p: Partial<Record<keyof typeof PAINT, number>>) => {
            for (const [k, v] of Object.entries(p)) PAINT[k as keyof typeof PAINT].value = v as number;
          };
      }}
    >
      <Suspense fallback={null}>
        <Room />
      </Suspense>
    </Canvas>
    <Overlay />
    </>
  );
}
