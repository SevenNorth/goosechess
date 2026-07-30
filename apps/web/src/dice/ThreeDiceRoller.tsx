import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { PresentationStage } from '../game-client/machine/presentation-machine'

type DiceFaces = readonly [number, number]
type DiceMode = 'hidden' | 'docked' | 'pending' | 'rolling' | 'settled'

export interface ThreeDiceRollerHandle {
  roll(faces: DiceFaces, speed: number): Promise<void>
  cancel(): void
}

interface ThreeDiceRollerProps {
  readonly canRoll: boolean
  readonly stage: PresentationStage
  readonly onRoll: () => void
}

interface DieVisual {
  readonly root: THREE.Group
  readonly pips: readonly THREE.Mesh[]
}

interface DiceVisuals {
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly renderer: THREE.WebGLRenderer
  readonly root: THREE.Group
  readonly dice: readonly [DieVisual, DieVisual]
  width: number
  height: number
}

interface RollAnimation {
  readonly startedAt: number
  readonly duration: number
  readonly faces: DiceFaces
  readonly resolve: () => void
  revealed: boolean
}

const FACE_NORMALS: Readonly<Record<number, THREE.Vector3>> = {
  1: new THREE.Vector3(0, 0, 1),
  2: new THREE.Vector3(0, 0, -1),
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  5: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
}

const PIP_LAYOUTS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
  6: [[-1, 1], [-1, 0], [-1, -1], [1, 1], [1, 0], [1, -1]],
}

function faceBasis(normal: THREE.Vector3) {
  if (Math.abs(normal.z) > 0.5) {
    return {
      u: new THREE.Vector3(normal.z, 0, 0),
      v: new THREE.Vector3(0, 1, 0),
    }
  }
  if (Math.abs(normal.x) > 0.5) {
    return {
      u: new THREE.Vector3(0, 0, -normal.x),
      v: new THREE.Vector3(0, 1, 0),
    }
  }
  return {
    u: new THREE.Vector3(1, 0, 0),
    v: new THREE.Vector3(0, 0, -normal.y),
  }
}

function createDie(bodyColor: number, pipColor: number) {
  const root = new THREE.Group()
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(1, 1, 1, 6, 0.14),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.32, metalness: 0.04 }),
  )
  body.castShadow = true
  body.receiveShadow = true
  root.add(body)

  const pipGeometry = new THREE.CircleGeometry(0.072, 20)
  const pipMaterial = new THREE.MeshStandardMaterial({
    color: pipColor,
    roughness: 0.45,
    transparent: true,
  })
  const pips: THREE.Mesh[] = []
  for (let face = 1; face <= 6; face += 1) {
    const normal = FACE_NORMALS[face]
    const { u, v } = faceBasis(normal)
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    for (const [column, row] of PIP_LAYOUTS[face]) {
      const pip = new THREE.Mesh(pipGeometry, pipMaterial)
      pip.position.copy(normal).multiplyScalar(0.507)
      pip.position.addScaledVector(u, column * 0.205)
      pip.position.addScaledVector(v, row * 0.205)
      pip.quaternion.copy(rotation)
      pip.receiveShadow = true
      root.add(pip)
      pips.push(pip)
    }
  }
  return { root, pips }
}

function dockY(visuals: DiceVisuals) {
  return -visuals.height / 200 + 0.72
}

function setPipOpacity(die: DieVisual, opacity: number) {
  for (const pip of die.pips) {
    const material = pip.material as THREE.MeshStandardMaterial
    material.opacity = opacity
    material.depthWrite = opacity > 0.5
  }
}

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3
}

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2
}

function targetQuaternion(face: number) {
  return new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[face], new THREE.Vector3(0, 0, 1))
}

function disposeVisuals(visuals: DiceVisuals) {
  visuals.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
  visuals.renderer.dispose()
}

export const ThreeDiceRoller = forwardRef<ThreeDiceRollerHandle, ThreeDiceRollerProps>(function ThreeDiceRoller(
  { canRoll, stage, onRoll },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const visualsRef = useRef<DiceVisuals | null>(null)
  const animationRef = useRef<RollAnimation | null>(null)
  const frameRef = useRef(0)
  const reducedMotionRef = useRef(false)
  const modeRef = useRef<DiceMode>('hidden')
  const [mode, setModeState] = useState<DiceMode>('hidden')
  const [result, setResult] = useState<DiceFaces | null>(null)
  const [resultTravelMs, setResultTravelMs] = useState(780)

  const setMode = (next: DiceMode) => {
    modeRef.current = next
    setModeState(next)
  }

  const applyDock = () => {
    const visuals = visualsRef.current
    if (!visuals) return
    visuals.root.visible = true
    visuals.root.position.set(0, dockY(visuals), 0)
    visuals.root.scale.setScalar(0.7)
    visuals.dice[0].root.position.set(-0.62, 0, 0)
    visuals.dice[1].root.position.set(0.62, 0, 0)
    visuals.dice[0].root.rotation.set(-0.18, 0.36, -0.08)
    visuals.dice[1].root.rotation.set(0.24, -0.42, 0.12)
    setPipOpacity(visuals.dice[0], 0.12)
    setPipOpacity(visuals.dice[1], 0.12)
  }

  const cancel = () => {
    const animation = animationRef.current
    if (!animation) return
    animationRef.current = null
    animation.resolve()
  }

  useImperativeHandle(ref, () => ({
    roll(faces, speed) {
      cancel()
      setResult(null)
      setResultTravelMs(Math.max(180, 780 / speed))
      setMode('rolling')
      const visuals = visualsRef.current
      if (!visuals || import.meta.env.MODE === 'test') {
        setResult(faces)
        setMode('settled')
        return Promise.resolve()
      }
      visuals.root.visible = true
      setPipOpacity(visuals.dice[0], 1)
      setPipOpacity(visuals.dice[1], 1)
      const reduceMotion = reducedMotionRef.current
      return new Promise<void>((resolve) => {
        animationRef.current = {
          startedAt: performance.now(),
          duration: reduceMotion ? Math.max(80, 220 / speed) : Math.max(140, 2_000 / speed),
          faces,
          resolve,
          revealed: false,
        }
      })
    },
    cancel,
  }))

  useEffect(() => {
    if (stage !== 'ready' || animationRef.current) return
    if (canRoll) {
      setResult(null)
      setMode('docked')
      applyDock()
      return
    }
    if (modeRef.current === 'pending') return
    setMode('hidden')
    if (visualsRef.current) {
      visualsRef.current.root.visible = false
      visualsRef.current.renderer.clear()
    }
  }, [canRoll, stage])

  useEffect(() => {
    if (stage === 'ready' || stage === 'rolling' || !visualsRef.current) return
    visualsRef.current.root.visible = false
    visualsRef.current.renderer.clear()
  }, [stage])

  useEffect(() => {
    const host = hostRef.current
    if (!host || import.meta.env.MODE === 'test') return
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 30)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.className = 'three-dice-canvas'
    renderer.domElement.dataset.testid = 'three-dice-canvas'
    host.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xfff8e8, 0x262b24, 2.4))
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.2)
    keyLight.position.set(-3, 5, 8)
    keyLight.castShadow = true
    scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0xe1c86f, 1.6)
    rimLight.position.set(5, -2, 5)
    scene.add(rimLight)

    const root = new THREE.Group()
    const lightDie = createDie(0xeee9d9, 0x282b26)
    const darkDie = createDie(0x353932, 0xf5f1e4)
    root.add(lightDie.root, darkDie.root)
    scene.add(root)
    const visuals: DiceVisuals = { scene, camera, renderer, root, dice: [lightDie, darkDie], width: 0, height: 0 }
    visualsRef.current = visuals

    const resize = () => {
      const rect = host.getBoundingClientRect()
      visuals.width = Math.max(1, rect.width)
      visuals.height = Math.max(1, rect.height)
      camera.left = -visuals.width / 200
      camera.right = visuals.width / 200
      camera.top = visuals.height / 200
      camera.bottom = -visuals.height / 200
      camera.updateProjectionMatrix()
      renderer.setSize(visuals.width, visuals.height, false)
      if (modeRef.current === 'docked' || modeRef.current === 'pending') applyDock()
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotionPreference = () => { reducedMotionRef.current = media.matches }
    updateMotionPreference()
    media.addEventListener('change', updateMotionPreference)
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    if (modeRef.current === 'docked' || modeRef.current === 'pending') {
      applyDock()
    } else {
      root.visible = false
    }

    const render = (now: number) => {
      const animation = animationRef.current
      if (animation) {
        const progress = Math.min(1, (now - animation.startedAt) / animation.duration)
        const rollProgress = Math.min(1, progress / 0.72)
        const travel = easeInOutCubic(Math.min(1, rollProgress / 0.68))
        root.position.y = THREE.MathUtils.lerp(dockY(visuals), -0.18, travel)
        root.scale.setScalar(THREE.MathUtils.lerp(0.7, 1.08, easeOutCubic(travel)))
        visuals.dice.forEach((die, index) => {
          die.root.position.x = index === 0 ? -0.62 : 0.62
          die.root.position.y = Math.abs(Math.sin(rollProgress * Math.PI * 3.2 + index * 0.7)) * (1 - rollProgress) * 0.48
          const target = targetQuaternion(animation.faces[index])
          if (rollProgress < 0.55) {
            const direction = index === 0 ? 1 : -1
            die.root.rotation.set(
              direction * rollProgress * Math.PI * 7 + index * 0.4,
              rollProgress * Math.PI * 9 + index,
              direction * rollProgress * Math.PI * 5,
            )
          } else {
            const settle = easeOutCubic((rollProgress - 0.55) / 0.45)
            die.root.quaternion.slerp(target, settle)
          }
          if (rollProgress === 1) die.root.quaternion.copy(target)
        })
        if (progress >= 0.72 && !animation.revealed) {
          animation.revealed = true
          setResult(animation.faces)
          setMode('settled')
        }
        if (progress === 1) {
          animationRef.current = null
          animation.resolve()
        }
      } else if ((modeRef.current === 'docked' || modeRef.current === 'pending') && !reducedMotionRef.current) {
        root.position.y = dockY(visuals) + Math.sin(now / 420) * 0.018
      }
      if (modeRef.current !== 'hidden' && root.visible) renderer.render(scene, camera)
      frameRef.current = window.requestAnimationFrame(render)
    }
    frameRef.current = window.requestAnimationFrame(render)

    return () => {
      cancel()
      window.cancelAnimationFrame(frameRef.current)
      observer.disconnect()
      media.removeEventListener('change', updateMotionPreference)
      visualsRef.current = null
      disposeVisuals(visuals)
      renderer.domElement.remove()
    }
  }, [])

  const handleClick = () => {
    if (!canRoll) return
    setMode('pending')
    onRoll()
  }

  return (
    <section className={`three-dice-layer is-${mode}`} aria-label="双骰操作">
      <div className="three-dice-host" ref={hostRef} aria-hidden="true" />
      <button
        className="three-dice-trigger"
        type="button"
        aria-label="投掷双骰"
        title="投掷双骰"
        disabled={!canRoll}
        onClick={handleClick}
      />
      {result && mode === 'settled' && (
        <div
          className={`dice-readout dice-result ${stage === 'rolling' ? 'is-centered' : 'is-corner'}`}
          role="status"
          aria-label={`骰子结果 ${result[0] + result[1]}`}
          style={{ '--dice-result-travel-ms': `${resultTravelMs}ms` } as CSSProperties}
        >
          <strong>{result[0] + result[1]}</strong>
        </div>
      )}
    </section>
  )
})
