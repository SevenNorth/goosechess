import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { PresentationCue } from '@goose-chess/game-protocol'
import type { PresentationStage } from '../game-client/machine/presentation-machine'

type DiceFaces = readonly [number, number]
type DiceMode = 'hidden' | 'docked' | 'pending' | 'rolling' | 'adjusting' | 'settled'
type DiceRollCue = Extract<PresentationCue, { type: 'dice-roll' }>

interface DiceReadout {
  readonly faces: DiceFaces
  readonly movementTotal: number | null
  readonly movementModifier: number
}

export interface ThreeDiceRollerHandle {
  roll(cue: DiceRollCue, speed: number): Promise<void>
  cancel(): void
}

interface ThreeDiceRollerProps {
  readonly canRoll: boolean
  readonly stage: PresentationStage
  readonly onRoll: () => void
}

interface DieVisual {
  readonly root: THREE.Group
  readonly body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
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

interface DieRollProfile {
  readonly direction: number
  readonly index: number
  readonly spinEnd: number
  readonly tumbleAmount: number
  readonly spinTurns: readonly [number, number, number]
  readonly startQuaternion: THREE.Quaternion
  readonly settleQuaternion: THREE.Quaternion
  readonly targetQuaternion: THREE.Quaternion
  readonly wobbleAxis: THREE.Vector3
}

interface RollAnimation {
  readonly kind: 'roll'
  readonly startedAt: number
  readonly duration: number
  readonly faces: DiceFaces
  readonly reduceMotion: boolean
  readonly profiles: readonly [DieRollProfile, DieRollProfile]
  readonly resolve: () => void
  revealed: boolean
}

interface FaceAdjustmentAnimation {
  readonly kind: 'adjustment'
  readonly startedAt: number
  readonly duration: number
  readonly die: DieVisual
  readonly startQuaternion: THREE.Quaternion
  readonly targetQuaternion: THREE.Quaternion
  readonly resolve: () => void
}

interface PauseAnimation {
  readonly kind: 'pause'
  readonly startedAt: number
  readonly duration: number
  readonly resolve: () => void
}

type DiceAnimation = RollAnimation | FaceAdjustmentAnimation | PauseAnimation

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
  return { root, body, pips }
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

function tumbleEuler(profile: Pick<DieRollProfile, 'direction' | 'index' | 'spinTurns'>, progress: number) {
  return new THREE.Euler(
    profile.direction * progress * Math.PI * profile.spinTurns[0],
    progress * Math.PI * profile.spinTurns[1],
    profile.direction * progress * Math.PI * profile.spinTurns[2],
  )
}

function tumbleProgress(profile: Pick<DieRollProfile, 'spinEnd' | 'tumbleAmount'>, progress: number) {
  const normalized = THREE.MathUtils.clamp(progress / profile.spinEnd, 0, 1)
  if (profile.tumbleAmount < 1) return Math.sin(normalized * Math.PI / 2) * profile.tumbleAmount

  const flightEnd = 0.28
  const cruiseEnd = 0.67
  const minimumSpeed = 0.3
  const maximumSpeed = 2.4
  const acceleratedDistance = flightEnd * (minimumSpeed + maximumSpeed) / 2
  if (progress <= flightEnd) {
    const phase = progress / flightEnd
    const smoothstepIntegral = phase ** 3 - 0.5 * phase ** 4
    return flightEnd * (minimumSpeed * phase + (maximumSpeed - minimumSpeed) * smoothstepIntegral)
  }

  const cruiseDistance = (cruiseEnd - flightEnd) * maximumSpeed
  if (progress <= cruiseEnd) return acceleratedDistance + (progress - flightEnd) * maximumSpeed

  const decelerationDuration = profile.spinEnd - cruiseEnd
  const phase = THREE.MathUtils.clamp((progress - cruiseEnd) / decelerationDuration, 0, 1)
  const decelerationIntegral = phase - phase ** 3 + 0.5 * phase ** 4
  return acceleratedDistance + cruiseDistance + decelerationDuration * maximumSpeed * decelerationIntegral
}

function createRollProfile(die: DieVisual, index: number, face: number, reduceMotion: boolean): DieRollProfile {
  const direction = index === 0 ? 1 : -1
  const spinEnd = reduceMotion ? 0.76 : 0.8
  const tumbleAmount = reduceMotion ? 0.65 : 1
  const spinTurns: readonly [number, number, number] = reduceMotion ? [1.4, 1.8, 1.1] : [4.2, 5.2, 3.2]
  const profileBase = { direction, index, spinEnd, spinTurns, tumbleAmount }
  const startQuaternion = die.root.quaternion.clone()
  const settleQuaternion = startQuaternion.clone().multiply(
    new THREE.Quaternion().setFromEuler(tumbleEuler(profileBase, tumbleProgress(profileBase, spinEnd))),
  )
  const faceQuaternion = targetQuaternion(face)
  const finalTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), direction * 0.07)
  return {
    ...profileBase,
    startQuaternion,
    settleQuaternion,
    targetQuaternion: finalTilt.multiply(faceQuaternion),
    wobbleAxis: new THREE.Vector3(direction, 0.35, 0).normalize(),
  }
}

function bounceHeight(progress: number, index: number, reduceMotion: boolean) {
  const delayedProgress = THREE.MathUtils.clamp((progress - index * 0.025) / (1 - index * 0.025), 0, 1)
  const arcs = reduceMotion
    ? [[0, 0.55, 0.18], [0.55, 0.78, 0.05]] as const
    : [[0, 0.5, 0.62], [0.5, 0.7, 0.22], [0.7, 0.84, 0.075]] as const
  for (const [start, end, height] of arcs) {
    if (delayedProgress >= start && delayedProgress < end) {
      return Math.sin(((delayedProgress - start) / (end - start)) * Math.PI) * height
    }
  }
  return 0
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
  const animationRef = useRef<DiceAnimation | null>(null)
  const sequenceRef = useRef(0)
  const frameRef = useRef(0)
  const reducedMotionRef = useRef(false)
  const modeRef = useRef<DiceMode>('hidden')
  const [mode, setModeState] = useState<DiceMode>('hidden')
  const [result, setResult] = useState<DiceReadout | null>(null)
  const [resultTravelMs, setResultTravelMs] = useState(1_400)

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
    sequenceRef.current += 1
    const animation = animationRef.current
    if (!animation) return
    animationRef.current = null
    if (animation.kind === 'adjustment') {
      animation.die.body.material.emissiveIntensity = 0
      animation.die.body.scale.setScalar(1)
    }
    animation.resolve()
  }

  const pause = (duration: number) => new Promise<void>((resolve) => {
    animationRef.current = { kind: 'pause', startedAt: performance.now(), duration, resolve }
  })

  const adjustFace = (die: DieVisual, face: number, duration: number) => new Promise<void>((resolve) => {
    animationRef.current = {
      kind: 'adjustment',
      startedAt: performance.now(),
      duration,
      die,
      startQuaternion: die.root.quaternion.clone(),
      targetQuaternion: targetQuaternion(face),
      resolve,
    }
  })

  useImperativeHandle(ref, () => ({
    roll(cue, speed) {
      cancel()
      const sequence = sequenceRef.current
      const reduceMotion = reducedMotionRef.current
      setResult(null)
      setResultTravelMs(reduceMotion ? Math.max(360, 1_000 / speed) : Math.max(280, 1_400 / speed))
      setMode('rolling')
      const visuals = visualsRef.current
      if (!visuals || import.meta.env.MODE === 'test') {
        setResult({ faces: cue.dice, movementTotal: cue.movementTotal, movementModifier: cue.movementModifier })
        setMode('settled')
        return Promise.resolve()
      }
      visuals.root.visible = true
      setPipOpacity(visuals.dice[0], 1)
      setPipOpacity(visuals.dice[1], 1)
      const profiles: readonly [DieRollProfile, DieRollProfile] = [
        createRollProfile(visuals.dice[0], 0, cue.rawDice[0], reduceMotion),
        createRollProfile(visuals.dice[1], 1, cue.rawDice[1], reduceMotion),
      ]
      return new Promise<void>((resolveRoll) => {
        animationRef.current = {
          kind: 'roll',
          startedAt: performance.now(),
          duration: Math.max(reduceMotion ? 600 : 240, 2_400 / speed),
          faces: cue.rawDice,
          reduceMotion,
          profiles,
          resolve: resolveRoll,
          revealed: false,
        }
      }).then(async () => {
        if (sequence !== sequenceRef.current) return
        await pause(Math.max(120, (reduceMotion ? 420 : 650) / speed))
        if (sequence !== sequenceRef.current) return
        const displayed: [number, number] = [...cue.rawDice]
        for (const adjustment of cue.adjustments) {
          setMode('adjusting')
          await adjustFace(visuals.dice[adjustment.dieIndex], adjustment.toFace, Math.max(180, (reduceMotion ? 560 : 900) / speed))
          if (sequence !== sequenceRef.current) return
          displayed[adjustment.dieIndex] = adjustment.toFace
          setResult({ faces: [...displayed], movementTotal: null, movementModifier: 0 })
          setMode('settled')
        }
        setResult({ faces: cue.dice, movementTotal: cue.movementTotal, movementModifier: cue.movementModifier })
        await pause(Math.max(150, (reduceMotion ? 420 : 650) / speed))
        if (sequence === sequenceRef.current) setMode('settled')
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
      if (animation?.kind === 'roll') {
        const progress = Math.min(1, (now - animation.startedAt) / animation.duration)
        const rollProgress = Math.min(1, progress / 0.76)
        const travel = easeOutCubic(Math.min(1, rollProgress / 0.28))
        root.position.y = THREE.MathUtils.lerp(dockY(visuals), -0.18, travel)
        root.scale.setScalar(THREE.MathUtils.lerp(0.7, 1.08, easeOutCubic(travel)))
        visuals.dice.forEach((die, index) => {
          const profile = animation.profiles[index]
          const side = index === 0 ? -1 : 1
          const distanceFromCenter = THREE.MathUtils.lerp(0.62, 1, travel)
          const spread = Math.sin(Math.min(1, rollProgress / 0.82) * Math.PI) * (animation.reduceMotion ? 0.06 : 0.2)
          die.root.position.x = side * (distanceFromCenter + spread)
          die.root.position.y = bounceHeight(rollProgress, index, animation.reduceMotion)
          die.root.position.z = Math.sin(Math.min(1, rollProgress / 0.62) * Math.PI) * (animation.reduceMotion ? 0.04 : 0.24)
          if (rollProgress < profile.spinEnd) {
            die.root.quaternion.copy(profile.startQuaternion).multiply(
              new THREE.Quaternion().setFromEuler(tumbleEuler(profile, tumbleProgress(profile, rollProgress))),
            )
          } else {
            const settleProgress = (rollProgress - profile.spinEnd) / (1 - profile.spinEnd)
            const settle = easeInOutCubic(settleProgress)
            die.root.quaternion.copy(profile.settleQuaternion).slerp(profile.targetQuaternion, settle)
            const wobble = Math.sin(settleProgress * Math.PI * 3) * (1 - settleProgress) * (animation.reduceMotion ? 0.015 : 0.065)
            die.root.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(profile.wobbleAxis, wobble))
          }
          if (rollProgress === 1) die.root.quaternion.copy(profile.targetQuaternion)
        })
        if (progress >= 0.76 && !animation.revealed) {
          animation.revealed = true
          setResult({ faces: animation.faces, movementTotal: null, movementModifier: 0 })
          setMode('settled')
        }
        if (progress === 1) {
          animationRef.current = null
          animation.resolve()
        }
      } else if (animation?.kind === 'adjustment') {
        const progress = Math.min(1, (now - animation.startedAt) / animation.duration)
        const flashEnd = 0.42
        const flashProgress = Math.min(1, progress / flashEnd)
        animation.die.body.material.emissive.setHex(0xf4c85b)
        animation.die.body.material.emissiveIntensity = progress <= flashEnd
          ? Math.sin(flashProgress * Math.PI) * 1.8
          : (1 - progress) * 0.25
        const rotationProgress = THREE.MathUtils.clamp((progress - 0.3) / 0.7, 0, 1)
        animation.die.root.quaternion.copy(animation.startQuaternion).slerp(
          animation.targetQuaternion,
          easeInOutCubic(rotationProgress),
        )
        const pulse = Math.sin(Math.min(1, progress / 0.55) * Math.PI)
        animation.die.body.scale.setScalar(1 + pulse * (reducedMotionRef.current ? 0.035 : 0.09))
        if (progress === 1) {
          animation.die.root.quaternion.copy(animation.targetQuaternion)
          animation.die.body.material.emissiveIntensity = 0
          animation.die.body.scale.setScalar(1)
          animationRef.current = null
          animation.resolve()
        }
      } else if (animation?.kind === 'pause') {
        if (now - animation.startedAt >= animation.duration) {
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
      {result && (mode === 'settled' || mode === 'adjusting') && (
        <div
          className={`dice-readout dice-result ${result.movementModifier !== 0 ? 'has-breakdown' : ''} ${stage === 'rolling' ? 'is-centered' : 'is-corner'}`}
          role="status"
          aria-label={`骰子结果 ${result.movementTotal ?? result.faces[0] + result.faces[1]}`}
          data-dice-faces={result.faces.join('+')}
          data-movement-result={result.movementTotal ?? undefined}
          style={{ '--dice-result-travel-ms': `${resultTravelMs}ms` } as CSSProperties}
        >
          {stage === 'rolling' && result.movementModifier !== 0 ? <>
            <strong>{result.faces[0] + result.faces[1]}</strong>
            <span>{result.movementModifier > 0 ? '+' : '-'}</span>
            <strong>{Math.abs(result.movementModifier)}</strong>
          </> : <strong>{result.movementTotal ?? result.faces[0] + result.faces[1]}</strong>}
        </div>
      )}
    </section>
  )
})
