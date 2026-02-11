;; Physics simulation: Verlet, muscles, constraints, ground/wall collisions.
;; Memory layout: particles (9 f64 each), then constraints (10 f64 each), then walls (3 f64 each).
;; Particle: posX, posY, oldPosX, oldPosY, mass, radius, isLocked, velX, velY (stride 72).
;; Constraint: p1Index, p2Index, restLength, stiffness, currentLength, isMuscle, baseLength, amplitude, frequency, phase (stride 80).
;; Wall: x, normalX, normalY (stride 24).

(module
  (import "env" "sin" (func $sin (param f64) (result f64)))
  (memory (export "memory") 1)

  (func $integrate_verlet (export "integrate_verlet")
    (param $particlesOffset i32) (param $numParticles i32)
    (param $forceX f64) (param $forceY f64) (param $dt f64) (param $airResistance f64)
    (local $i i32) (local $off i32) (local $vx f64) (local $vy f64) (local $ax f64) (local $ay f64)
    (local $dtSq f64) (local $newPosX f64) (local $newPosY f64) (local $mass f64)
    (local $dampingFactor f64) (local $dampedVx f64) (local $dampedVy f64)
    (local $isLocked f64)
    local.get $numParticles
    i32.eqz
    if
      return
    end
    local.get $dt
    local.get $dt
    f64.mul
    local.set $dtSq
    i32.const 0
    local.set $i
    (block $particle_loop_break
      (loop $particle_loop
        local.get $i
        local.get $numParticles
        i32.ge_u
        br_if $particle_loop_break
        ;; off = particlesOffset + i * 72
        local.get $particlesOffset
        local.get $i
        i32.const 72
        i32.mul
        i32.add
        local.set $off
        ;; isLocked at off+48
        local.get $off
        i32.const 48
        i32.add
        f64.load
        local.set $isLocked
        local.get $isLocked
        f64.const 0
        f64.ne
        if
          ;; skip locked particle
        else
          ;; vx = pos.x - oldPos.x, vy = pos.y - oldPos.y
          local.get $off
          f64.load
          local.get $off
          i32.const 16
          i32.add
          f64.load
          f64.sub
          local.set $vx
          local.get $off
          i32.const 8
          i32.add
          f64.load
          local.get $off
          i32.const 24
          i32.add
          f64.load
          f64.sub
          local.set $vy
          ;; mass at off+32
          local.get $off
          i32.const 32
          i32.add
          f64.load
          local.set $mass
          ;; ax = forceX/mass, ay = forceY/mass
          local.get $forceX
          local.get $mass
          f64.div
          local.set $ax
          local.get $forceY
          local.get $mass
          f64.div
          local.set $ay
          ;; newPosX = pos.x + vx + ax*dtSq, newPosY = pos.y + vy + ay*dtSq
          local.get $off
          f64.load
          local.get $vx
          f64.add
          local.get $ax
          local.get $dtSq
          f64.mul
          f64.add
          local.set $newPosX
          local.get $off
          i32.const 8
          i32.add
          f64.load
          local.get $vy
          f64.add
          local.get $ay
          local.get $dtSq
          f64.mul
          f64.add
          local.set $newPosY
          ;; oldPos = pos (store current pos into oldPos)
          local.get $off
          i32.const 16
          i32.add
          local.get $off
          f64.load
          f64.store
          local.get $off
          i32.const 24
          i32.add
          local.get $off
          i32.const 8
          i32.add
          f64.load
          f64.store
          ;; pos = newPos
          local.get $off
          local.get $newPosX
          f64.store
          local.get $off
          i32.const 8
          i32.add
          local.get $newPosY
          f64.store
          ;; velocity = vx/dt, vy/dt
          local.get $off
          i32.const 56
          i32.add
          local.get $vx
          local.get $dt
          f64.div
          f64.store
          local.get $off
          i32.const 64
          i32.add
          local.get $vy
          local.get $dt
          f64.div
          f64.store
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $particle_loop
      )
    )
    ;; Air resistance pass if airResistance > 0
    local.get $airResistance
    f64.const 0
    f64.gt
    if
      f64.const 1
      local.get $airResistance
      f64.sub
      local.set $dampingFactor
      i32.const 0
      local.set $i
      (block $damp_break
        (loop $damp_loop
          local.get $i
          local.get $numParticles
          i32.ge_u
          br_if $damp_break
          local.get $particlesOffset
          local.get $i
          i32.const 72
          i32.mul
          i32.add
          local.set $off
          local.get $off
          i32.const 48
          i32.add
          f64.load
          f64.const 0
          f64.eq
          if
            local.get $off
            f64.load
            local.get $off
            i32.const 16
            i32.add
            f64.load
            f64.sub
            local.set $vx
            local.get $off
            i32.const 8
            i32.add
            f64.load
            local.get $off
            i32.const 24
            i32.add
            f64.load
            f64.sub
            local.set $vy
            local.get $vx
            local.get $dampingFactor
            f64.mul
            local.set $dampedVx
            local.get $vy
            local.get $dampingFactor
            f64.mul
            local.set $dampedVy
            ;; oldPos.x = pos.x - dampedVx, oldPos.y = pos.y - dampedVy
            local.get $off
            i32.const 16
            i32.add
            local.get $off
            f64.load
            local.get $dampedVx
            f64.sub
            f64.store
            local.get $off
            i32.const 24
            i32.add
            local.get $off
            i32.const 8
            i32.add
            f64.load
            local.get $dampedVy
            f64.sub
            f64.store
            ;; velocity = damped
            local.get $off
            i32.const 56
            i32.add
            local.get $dampedVx
            f64.store
            local.get $off
            i32.const 64
            i32.add
            local.get $dampedVy
            f64.store
          end
          local.get $i
          i32.const 1
          i32.add
          local.set $i
          br $damp_loop
        )
      )
    end
  )

  (func $update_muscles (export "update_muscles")
    (param $constraintsOffset i32) (param $numMuscles i32) (param $time f64)
    (local $i i32) (local $off i32) (local $baseLength f64) (local $amplitude f64)
    (local $frequency f64) (local $phase f64) (local $arg f64) (local $oscillation f64) (local $currentLength f64)
    (local $isMuscle f64)
    f64.const 0x1.921fb54442d18p+1
    local.set $arg
    i32.const 0
    local.set $i
    (block $break
      (loop $loop
        local.get $i
        local.get $numMuscles
        i32.ge_u
        br_if $break
        local.get $constraintsOffset
        local.get $i
        i32.const 80
        i32.mul
        i32.add
        local.set $off
        local.get $off
        i32.const 40
        i32.add
        f64.load
        local.set $isMuscle
        local.get $isMuscle
        f64.const 0
        f64.ne
        if
          local.get $off
          i32.const 48
          i32.add
          f64.load
          local.set $baseLength
          local.get $off
          i32.const 56
          i32.add
          f64.load
          local.set $amplitude
          local.get $off
          i32.const 64
          i32.add
          f64.load
          local.set $frequency
          local.get $off
          i32.const 72
          i32.add
          f64.load
          local.set $phase
          ;; arg = time * frequency * 2*PI + phase
          local.get $time
          local.get $frequency
          f64.mul
          f64.const 0x1.921fb54442d18p+2
          f64.mul
          local.get $phase
          f64.add
          local.set $arg
          local.get $arg
          call $sin
          local.get $amplitude
          f64.mul
          local.set $oscillation
          local.get $baseLength
          f64.const 1
          local.get $oscillation
          f64.add
          f64.mul
          local.set $currentLength
          local.get $off
          i32.const 32
          i32.add
          local.get $currentLength
          f64.store
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
  )

  (func $satisfy_constraints (export "satisfy_constraints")
    (param $particlesOffset i32) (param $constraintsOffset i32) (param $numConstraints i32) (param $iterations i32)
    (local $iter i32) (local $c i32) (local $coff i32) (local $p1Idx i32) (local $p2Idx i32)
    (local $p1Off i32) (local $p2Off i32) (local $x1 f64) (local $y1 f64) (local $x2 f64) (local $y2 f64)
    (local $dx f64) (local $dy f64) (local $dist f64) (local $targetLen f64) (local $diff f64)
    (local $dirX f64) (local $dirY f64) (local $corrX f64) (local $corrY f64)
    (local $stiffness f64) (local $m1 f64) (local $m2 f64) (local $totalMass f64) (local $p1Ratio f64) (local $p2Ratio f64)
    (local $isLocked1 f64) (local $isLocked2 f64)
    local.get $iterations
    i32.const 0
    i32.le_s
    if
      return
    end
    i32.const 0
    local.set $iter
    (block $iter_break
      (loop $iter_loop
        local.get $iter
        local.get $iterations
        i32.ge_s
        br_if $iter_break
        i32.const 0
        local.set $c
        (block $const_break
          (loop $const_loop
            local.get $c
            local.get $numConstraints
            i32.ge_u
            br_if $const_break
            ;; coff = constraintsOffset + c * 80
            local.get $constraintsOffset
            local.get $c
            i32.const 80
            i32.mul
            i32.add
            local.set $coff
            ;; p1Idx, p2Idx as f64 at 0 and 8 - load and convert to i32 via trunc
            local.get $coff
            f64.load
            i32.trunc_sat_f64_u
            local.set $p1Idx
            local.get $coff
            i32.const 8
            i32.add
            f64.load
            i32.trunc_sat_f64_u
            local.set $p2Idx
            ;; p1Off = particlesOffset + p1Idx*72, p2Off = particlesOffset + p2Idx*72
            local.get $particlesOffset
            local.get $p1Idx
            i32.const 72
            i32.mul
            i32.add
            local.set $p1Off
            local.get $particlesOffset
            local.get $p2Idx
            i32.const 72
            i32.mul
            i32.add
            local.set $p2Off
            ;; x1,y1 = p1.pos, x2,y2 = p2.pos
            local.get $p1Off
            f64.load
            local.set $x1
            local.get $p1Off
            i32.const 8
            i32.add
            f64.load
            local.set $y1
            local.get $p2Off
            f64.load
            local.set $x2
            local.get $p2Off
            i32.const 8
            i32.add
            f64.load
            local.set $y2
            ;; dx = x2-x1, dy = y2-y1, dist = sqrt(dx*dx + dy*dy)
            local.get $x2
            local.get $x1
            f64.sub
            local.set $dx
            local.get $y2
            local.get $y1
            f64.sub
            local.set $dy
            local.get $dx
            local.get $dx
            f64.mul
            local.get $dy
            local.get $dy
            f64.mul
            f64.add
            f64.sqrt
            local.set $dist
            ;; skip if dist == 0 to avoid div by zero
            local.get $dist
            f64.const 0
            f64.eq
            if
            else
              ;; targetLen = currentLength at coff+32
              local.get $coff
              i32.const 32
              i32.add
              f64.load
              local.set $targetLen
              ;; diff = dist - targetLen
              local.get $dist
              local.get $targetLen
              f64.sub
              local.set $diff
              ;; if |diff| < 0.01 skip
              local.get $diff
              f64.abs
              f64.const 0x1.47ae147ae147bp-7
              f64.lt
              if
              else
                ;; direction = (dx/dist, dy/dist), correction = direction * diff * stiffness
                local.get $coff
                i32.const 24
                i32.add
                f64.load
                local.set $stiffness
                local.get $dx
                local.get $dist
                f64.div
                local.set $dirX
                local.get $dy
                local.get $dist
                f64.div
                local.set $dirY
                local.get $dirX
                local.get $diff
                f64.mul
                local.get $stiffness
                f64.mul
                local.set $corrX
                local.get $dirY
                local.get $diff
                f64.mul
                local.get $stiffness
                f64.mul
                local.set $corrY
                ;; mass-weighted: p1Ratio = m2/(m1+m2), p2Ratio = m1/(m1+m2)
                local.get $p1Off
                i32.const 32
                i32.add
                f64.load
                local.set $m1
                local.get $p2Off
                i32.const 32
                i32.add
                f64.load
                local.set $m2
                local.get $m1
                local.get $m2
                f64.add
                local.set $totalMass
                local.get $m2
                local.get $totalMass
                f64.div
                local.set $p1Ratio
                local.get $m1
                local.get $totalMass
                f64.div
                local.set $p2Ratio
                ;; p1.isLocked at p1Off+48, p2 at p2Off+48
                local.get $p1Off
                i32.const 48
                i32.add
                f64.load
                local.set $isLocked1
                local.get $p2Off
                i32.const 48
                i32.add
                f64.load
                local.set $isLocked2
                ;; if !p1.isLocked: p1.pos += correction * p1Ratio
                local.get $isLocked1
                f64.const 0
                f64.eq
                if
                  local.get $p1Off
                  local.get $x1
                  local.get $corrX
                  local.get $p1Ratio
                  f64.mul
                  f64.add
                  f64.store
                  local.get $p1Off
                  i32.const 8
                  i32.add
                  local.get $y1
                  local.get $corrY
                  local.get $p1Ratio
                  f64.mul
                  f64.add
                  f64.store
                end
                ;; if !p2.isLocked: p2.pos -= correction * p2Ratio
                local.get $isLocked2
                f64.const 0
                f64.eq
                if
                  local.get $p2Off
                  local.get $x2
                  local.get $corrX
                  local.get $p2Ratio
                  f64.mul
                  f64.sub
                  f64.store
                  local.get $p2Off
                  i32.const 8
                  i32.add
                  local.get $y2
                  local.get $corrY
                  local.get $p2Ratio
                  f64.mul
                  f64.sub
                  f64.store
                end
              end
            end
            local.get $c
            i32.const 1
            i32.add
            local.set $c
            br $const_loop
          )
        )
        local.get $iter
        i32.const 1
        i32.add
        local.set $iter
        br $iter_loop
      )
    )
  )

  (func $ground_collision (export "ground_collision")
    (param $particlesOffset i32) (param $numParticles i32)
    (param $groundY f64) (param $friction f64) (param $restitution f64)
    (local $i i32) (local $off i32) (local $radius f64) (local $posY f64) (local $newPosY f64)
    (local $vx f64) (local $vy f64) (local $frictionForce f64) (local $newOldPosY f64) (local $newOldPosX f64)
    i32.const 0
    local.set $i
    (block $break
      (loop $loop
        local.get $i
        local.get $numParticles
        i32.ge_u
        br_if $break
        local.get $particlesOffset
        local.get $i
        i32.const 72
        i32.mul
        i32.add
        local.set $off
        local.get $off
        i32.const 48
        i32.add
        f64.load
        f64.const 0
        f64.ne
        if
        else
          local.get $off
          i32.const 40
          i32.add
          f64.load
          local.set $radius
          local.get $off
          i32.const 8
          i32.add
          f64.load
          local.set $posY
          local.get $groundY
          local.get $radius
          f64.sub
          local.set $newPosY
          local.get $posY
          local.get $newPosY
          f64.le
          if
          else
            local.get $off
            f64.load
            local.get $off
            i32.const 16
            i32.add
            f64.load
            f64.sub
            local.set $vx
            local.get $posY
            local.get $off
            i32.const 24
            i32.add
            f64.load
            f64.sub
            local.set $vy
            local.get $vx
            local.get $friction
            f64.mul
            local.set $frictionForce
            local.get $vy
            f64.const 0
            f64.lt
            if
              local.get $newPosY
              local.get $vy
              f64.const 0.95
              f64.mul
              f64.sub
              local.set $newOldPosY
            else
              local.get $newPosY
              local.get $vy
              local.get $restitution
              f64.mul
              f64.add
              local.set $newOldPosY
            end
            local.get $off
            f64.load
            local.get $vx
            f64.sub
            local.get $frictionForce
            f64.add
            local.set $newOldPosX
            local.get $off
            i32.const 8
            i32.add
            local.get $newPosY
            f64.store
            local.get $off
            i32.const 16
            i32.add
            local.get $newOldPosX
            f64.store
            local.get $off
            i32.const 24
            i32.add
            local.get $newOldPosY
            f64.store
            local.get $off
            i32.const 56
            i32.add
            local.get $off
            f64.load
            local.get $off
            i32.const 16
            i32.add
            f64.load
            f64.sub
            f64.const 0.016
            f64.div
            f64.store
            local.get $off
            i32.const 64
            i32.add
            local.get $off
            i32.const 8
            i32.add
            f64.load
            local.get $off
            i32.const 24
            i32.add
            f64.load
            f64.sub
            f64.const 0.016
            f64.div
            f64.store
          end
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
  )

  (func $wall_collision (export "wall_collision")
    (param $particlesOffset i32) (param $numParticles i32) (param $wallsOffset i32) (param $numWalls i32)
    (local $i i32) (local $w i32) (local $poff i32) (local $woff i32) (local $wallX f64) (local $normalX f64)
    (local $posX f64) (local $radius f64) (local $distToWall f64) (local $vx f64)
    i32.const 0
    local.set $i
    (block $p_break
      (loop $p_loop
        local.get $i
        local.get $numParticles
        i32.ge_u
        br_if $p_break
        local.get $particlesOffset
        local.get $i
        i32.const 72
        i32.mul
        i32.add
        local.set $poff
        local.get $poff
        i32.const 48
        i32.add
        f64.load
        f64.const 0
        f64.ne
        if
        else
          local.get $poff
          f64.load
          local.set $posX
          local.get $poff
          i32.const 40
          i32.add
          f64.load
          local.set $radius
          i32.const 0
          local.set $w
          (block $w_break
            (loop $w_loop
              local.get $w
              local.get $numWalls
              i32.ge_u
              br_if $w_break
              local.get $wallsOffset
              local.get $w
              i32.const 24
              i32.mul
              i32.add
              local.set $woff
              local.get $woff
              f64.load
              local.set $wallX
              local.get $woff
              i32.const 8
              i32.add
              f64.load
              local.set $normalX
              local.get $poff
              f64.load
              local.get $wallX
              f64.sub
              local.set $distToWall
              local.get $distToWall
              local.get $distToWall
              f64.mul
              f64.sqrt
              local.get $radius
              f64.lt
              if
                local.get $distToWall
                local.get $normalX
                f64.mul
                f64.const 0
                f64.lt
                if
                  local.get $poff
                  local.get $wallX
                  local.get $normalX
                  local.get $radius
                  f64.mul
                  f64.add
                  f64.store
                  local.get $poff
                  f64.load
                  local.get $poff
                  i32.const 16
                  i32.add
                  f64.load
                  f64.sub
                  local.set $vx
                  local.get $poff
                  i32.const 16
                  i32.add
                  local.get $poff
                  f64.load
                  local.get $vx
                  f64.const 0.5
                  f64.mul
                  f64.sub
                  f64.store
                end
              end
              local.get $w
              i32.const 1
              i32.add
              local.set $w
              br $w_loop
            )
          )
        end
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $p_loop
      )
    )
  )

  ;; ============================================================
  ;; Batch physics: step ALL creatures in one call.
  ;; Memory: creatures data back-to-back, then walls, then metadata.
  ;; Metadata per creature (16 f64 = 128 bytes):
  ;;   +0  isDead        +8  headIdx       +16 startX
  ;;   +24 currentX      +32 currentY      +40 maxDistance
  ;;   +48 minHeadY      +56 reachedTarget +64 targetX
  ;;   +72 targetY       +80 targetW       +88 targetH
  ;;   +96 airborneSteps +104 totalSteps   +112 headYSum
  ;;   +120 headYSumSq
  ;; ============================================================

  (func $step_all_creatures (export "step_all_creatures")
    (param $creaturesOffset i32)
    (param $numCreatures i32)
    (param $numParticles i32)
    (param $numConstraints i32)
    (param $numMuscles i32)
    (param $wallsOffset i32)
    (param $numWalls i32)
    (param $metadataOffset i32)
    (param $groundY f64)
    (param $groundFriction f64)
    (param $groundRestitution f64)
    (param $forceX f64)
    (param $forceY f64)
    (param $dt f64)
    (param $airResistance f64)
    (param $time f64)
    (param $constraintIterations i32)
    (local $c i32)
    (local $creatureStride i32)
    (local $particlesOff i32)
    (local $constraintsOff i32)
    (local $musclesOff i32)
    (local $metaOff i32)
    ;; creatureStride = numParticles * 72 + numConstraints * 80
    local.get $numParticles
    i32.const 72
    i32.mul
    local.get $numConstraints
    i32.const 80
    i32.mul
    i32.add
    local.set $creatureStride
    i32.const 0
    local.set $c
    (block $break
      (loop $loop
        local.get $c
        local.get $numCreatures
        i32.ge_u
        br_if $break
        ;; metaOff = metadataOffset + c * 128
        local.get $metadataOffset
        local.get $c
        i32.const 128
        i32.mul
        i32.add
        local.set $metaOff
        ;; skip dead creatures (isDead != 0)
        local.get $metaOff
        f64.load
        f64.const 0
        f64.ne
        if
        else
          ;; particlesOff = creaturesOffset + c * creatureStride
          local.get $creaturesOffset
          local.get $c
          local.get $creatureStride
          i32.mul
          i32.add
          local.set $particlesOff
          ;; constraintsOff = particlesOff + numParticles * 72
          local.get $particlesOff
          local.get $numParticles
          i32.const 72
          i32.mul
          i32.add
          local.set $constraintsOff
          ;; musclesOff = constraintsOff + (numConstraints - numMuscles) * 80
          local.get $constraintsOff
          local.get $numConstraints
          local.get $numMuscles
          i32.sub
          i32.const 80
          i32.mul
          i32.add
          local.set $musclesOff
          ;; 1. update_muscles(musclesOff, numMuscles, time)
          local.get $musclesOff
          local.get $numMuscles
          local.get $time
          call $update_muscles
          ;; 2. integrate_verlet(particlesOff, numParticles, forceX, forceY, dt, airResistance)
          local.get $particlesOff
          local.get $numParticles
          local.get $forceX
          local.get $forceY
          local.get $dt
          local.get $airResistance
          call $integrate_verlet
          ;; 3. satisfy_constraints(particlesOff, constraintsOff, numConstraints, iterations)
          local.get $particlesOff
          local.get $constraintsOff
          local.get $numConstraints
          local.get $constraintIterations
          call $satisfy_constraints
          ;; 4. ground_collision(particlesOff, numParticles, groundY, friction, restitution)
          local.get $particlesOff
          local.get $numParticles
          local.get $groundY
          local.get $groundFriction
          local.get $groundRestitution
          call $ground_collision
          ;; 5. wall_collision(particlesOff, numParticles, wallsOffset, numWalls)
          local.get $particlesOff
          local.get $numParticles
          local.get $wallsOffset
          local.get $numWalls
          call $wall_collision
        end
        local.get $c
        i32.const 1
        i32.add
        local.set $c
        br $loop
      )
    )
  )

  ;; ============================================================
  ;; Post-step: head-death, center-of-mass, maxDistance, minHeadY,
  ;; target-zone check for all creatures.
  ;; ============================================================

  (func $post_step_creatures (export "post_step_creatures")
    (param $creaturesOffset i32)
    (param $numCreatures i32)
    (param $numParticles i32)
    (param $numConstraints i32)
    (param $metadataOffset i32)
    (param $groundY f64)
    (param $leftFootIdx i32)
    (param $rightFootIdx i32)
    (local $c i32)
    (local $creatureStride i32)
    (local $particlesOff i32)
    (local $metaOff i32)
    (local $headIdx i32)
    (local $headOff i32)
    (local $headY f64)
    (local $headRadius f64)
    (local $totalMass f64)
    (local $weightedX f64)
    (local $weightedY f64)
    (local $pOff i32)
    (local $mass f64)
    (local $p i32)
    (local $centerX f64)
    (local $maxDist f64)
    (local $minHeadY f64)
    (local $posX f64)
    (local $posY f64)
    (local $targetX f64)
    (local $targetY f64)
    (local $targetW f64)
    (local $targetH f64)
    (local $footOff i32)
    (local $footY f64)
    (local $footRadius f64)
    (local $lFootAirborne i32)
    ;; creatureStride = numParticles * 72 + numConstraints * 80
    local.get $numParticles
    i32.const 72
    i32.mul
    local.get $numConstraints
    i32.const 80
    i32.mul
    i32.add
    local.set $creatureStride
    i32.const 0
    local.set $c
    (block $c_break
      (loop $c_loop
        local.get $c
        local.get $numCreatures
        i32.ge_u
        br_if $c_break
        ;; metaOff = metadataOffset + c * 128
        local.get $metadataOffset
        local.get $c
        i32.const 128
        i32.mul
        i32.add
        local.set $metaOff
        ;; skip dead
        local.get $metaOff
        f64.load
        f64.const 0
        f64.ne
        if
        else
          ;; particlesOff = creaturesOffset + c * creatureStride
          local.get $creaturesOffset
          local.get $c
          local.get $creatureStride
          i32.mul
          i32.add
          local.set $particlesOff
          ;; headIdx from metadata at +8
          local.get $metaOff
          i32.const 8
          i32.add
          f64.load
          i32.trunc_sat_f64_u
          local.set $headIdx
          ;; headOff = particlesOff + headIdx * 72
          local.get $particlesOff
          local.get $headIdx
          i32.const 72
          i32.mul
          i32.add
          local.set $headOff
          ;; headY = pos.y at headOff+8
          local.get $headOff
          i32.const 8
          i32.add
          f64.load
          local.set $headY
          ;; headRadius at headOff+40
          local.get $headOff
          i32.const 40
          i32.add
          f64.load
          local.set $headRadius
          ;; head-death: if headY >= groundY - headRadius
          local.get $headY
          local.get $groundY
          local.get $headRadius
          f64.sub
          f64.ge
          if
            ;; mark dead
            local.get $metaOff
            f64.const 1
            f64.store
            ;; skip rest, advance counter
            local.get $c
            i32.const 1
            i32.add
            local.set $c
            br $c_loop
          end
          ;; minHeadY = min(current, headY)
          local.get $metaOff
          i32.const 48
          i32.add
          f64.load
          local.set $minHeadY
          local.get $headY
          local.get $minHeadY
          f64.lt
          if
            local.get $metaOff
            i32.const 48
            i32.add
            local.get $headY
            f64.store
          end
          ;; Center of mass
          f64.const 0
          local.set $totalMass
          f64.const 0
          local.set $weightedX
          f64.const 0
          local.set $weightedY
          i32.const 0
          local.set $p
          (block $p_break
            (loop $p_loop
              local.get $p
              local.get $numParticles
              i32.ge_u
              br_if $p_break
              local.get $particlesOff
              local.get $p
              i32.const 72
              i32.mul
              i32.add
              local.set $pOff
              ;; mass at pOff+32
              local.get $pOff
              i32.const 32
              i32.add
              f64.load
              local.set $mass
              local.get $totalMass
              local.get $mass
              f64.add
              local.set $totalMass
              local.get $weightedX
              local.get $pOff
              f64.load
              local.get $mass
              f64.mul
              f64.add
              local.set $weightedX
              local.get $weightedY
              local.get $pOff
              i32.const 8
              i32.add
              f64.load
              local.get $mass
              f64.mul
              f64.add
              local.set $weightedY
              local.get $p
              i32.const 1
              i32.add
              local.set $p
              br $p_loop
            )
          )
          ;; centerX = weightedX / totalMass
          local.get $weightedX
          local.get $totalMass
          f64.div
          local.set $centerX
          ;; write currentX at +24
          local.get $metaOff
          i32.const 24
          i32.add
          local.get $centerX
          f64.store
          ;; write currentY at +32
          local.get $metaOff
          i32.const 32
          i32.add
          local.get $weightedY
          local.get $totalMass
          f64.div
          f64.store
          ;; maxDistance = max(maxDistance, centerX) at +40
          local.get $metaOff
          i32.const 40
          i32.add
          f64.load
          local.set $maxDist
          local.get $centerX
          local.get $maxDist
          f64.gt
          if
            local.get $metaOff
            i32.const 40
            i32.add
            local.get $centerX
            f64.store
          end
          ;; target zone check (only if not already reached)
          local.get $metaOff
          i32.const 56
          i32.add
          f64.load
          f64.const 0
          f64.eq
          if
            local.get $metaOff
            i32.const 64
            i32.add
            f64.load
            local.set $targetX
            local.get $metaOff
            i32.const 72
            i32.add
            f64.load
            local.set $targetY
            local.get $metaOff
            i32.const 80
            i32.add
            f64.load
            local.set $targetW
            local.get $metaOff
            i32.const 88
            i32.add
            f64.load
            local.set $targetH
            i32.const 0
            local.set $p
            (block $tz_break
              (loop $tz_loop
                local.get $p
                local.get $numParticles
                i32.ge_u
                br_if $tz_break
                local.get $particlesOff
                local.get $p
                i32.const 72
                i32.mul
                i32.add
                local.set $pOff
                local.get $pOff
                f64.load
                local.set $posX
                local.get $pOff
                i32.const 8
                i32.add
                f64.load
                local.set $posY
                ;; posX >= targetX
                local.get $posX
                local.get $targetX
                f64.ge
                if
                  ;; posX <= targetX + targetW
                  local.get $posX
                  local.get $targetX
                  local.get $targetW
                  f64.add
                  f64.le
                  if
                    ;; posY >= targetY
                    local.get $posY
                    local.get $targetY
                    f64.ge
                    if
                      ;; posY <= targetY + targetH
                      local.get $posY
                      local.get $targetY
                      local.get $targetH
                      f64.add
                      f64.le
                      if
                        local.get $metaOff
                        i32.const 56
                        i32.add
                        f64.const 1
                        f64.store
                        br $tz_break
                      end
                    end
                  end
                end
                local.get $p
                i32.const 1
                i32.add
                local.set $p
                br $tz_loop
              )
            )
          end

          ;; ---- Walking metrics ----
          ;; totalSteps++ at metadata+104
          local.get $metaOff
          i32.const 104
          i32.add
          local.get $metaOff
          i32.const 104
          i32.add
          f64.load
          f64.const 1
          f64.add
          f64.store
          ;; headYSum += headY at metadata+112
          local.get $metaOff
          i32.const 112
          i32.add
          local.get $metaOff
          i32.const 112
          i32.add
          f64.load
          local.get $headY
          f64.add
          f64.store
          ;; headYSumSq += headY * headY at metadata+120
          local.get $metaOff
          i32.const 120
          i32.add
          local.get $metaOff
          i32.const 120
          i32.add
          f64.load
          local.get $headY
          local.get $headY
          f64.mul
          f64.add
          f64.store
          ;; Airborne check: both feet off ground?
          ;; Left foot: footOff = particlesOff + leftFootIdx * 72
          i32.const 0
          local.set $lFootAirborne
          local.get $particlesOff
          local.get $leftFootIdx
          i32.const 72
          i32.mul
          i32.add
          local.set $footOff
          ;; footY at footOff+8
          local.get $footOff
          i32.const 8
          i32.add
          f64.load
          local.set $footY
          ;; footRadius at footOff+40
          local.get $footOff
          i32.const 40
          i32.add
          f64.load
          local.set $footRadius
          ;; if footY < groundY - footRadius => left foot is airborne
          local.get $footY
          local.get $groundY
          local.get $footRadius
          f64.sub
          f64.lt
          if
            i32.const 1
            local.set $lFootAirborne
          end
          ;; Only check right foot if left is airborne
          local.get $lFootAirborne
          if
            ;; Right foot: footOff = particlesOff + rightFootIdx * 72
            local.get $particlesOff
            local.get $rightFootIdx
            i32.const 72
            i32.mul
            i32.add
            local.set $footOff
            local.get $footOff
            i32.const 8
            i32.add
            f64.load
            local.set $footY
            local.get $footOff
            i32.const 40
            i32.add
            f64.load
            local.set $footRadius
            ;; if footY < groundY - footRadius => both airborne
            local.get $footY
            local.get $groundY
            local.get $footRadius
            f64.sub
            f64.lt
            if
              ;; airborneSteps++ at metadata+96
              local.get $metaOff
              i32.const 96
              i32.add
              local.get $metaOff
              i32.const 96
              i32.add
              f64.load
              f64.const 1
              f64.add
              f64.store
            end
          end
        end
        local.get $c
        i32.const 1
        i32.add
        local.set $c
        br $c_loop
      )
    )
  )
)
