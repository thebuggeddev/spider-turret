import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { createSpiderTSLUniforms } from '../spider/tslMaterials.js?v=38';
import { loadSpiderTurretRig } from '../spider/RobotRig.js?v=38';
import { CameraController } from '../spider/CameraController.js?v=38';
import { ProjectileSystem } from '../spider/ProjectileSystem.js?v=38';
import { RobotController } from '../spider/RobotController.js?v=38';

const h = React.createElement;

const WEAPON_SPECS = {
  GATLING: {
    id: 'GATLING',
    action: 'WEAPON_GATLING',
    chip: 'GAU-6',
    fireLabel: 'FIRE GATLING',
    modTitle: '6-BARREL GATLING CANNON',
    wellLabel: '6×28MM BORE ROTOR',
    cadenceLabel: 'ROTARY CADENCE',
    caliber: '6× 28mm',
    breech: 'ROTARY DRUM',
    maxFeed: '3,600 RPM',
    blueprintSrc: './renders/part_gun.png?v=34',
  },
  RAILGUN: {
    id: 'RAILGUN',
    action: 'WEAPON_RAILGUN',
    chip: 'RAIL-02',
    fireLabel: 'FIRE RAILGUN',
    modTitle: 'EMG-02 TWIN RAILGUN',
    wellLabel: 'TWIN RAIL CAPACITOR',
    cadenceLabel: 'CAPACITOR CHARGE',
    caliber: '38mm PLASMA',
    breech: 'COIL BANK',
    maxFeed: '92 M/S SLUG',
    blueprintSrc: './renders/part_gun_railgun.png?v=34',
  },
  MISSILE: {
    id: 'MISSILE',
    action: 'WEAPON_MISSILE',
    chip: 'MLRS-8',
    fireLabel: 'FIRE MISSILES',
    modTitle: 'MLRS-8 ROCKET POD',
    wellLabel: '8-TUBE ROCKET DRUM',
    cadenceLabel: 'RIPPLE SALVO',
    caliber: '8× 70mm HE',
    breech: '8-TUBE DRUM',
    maxFeed: '250 RPM SALVO',
    blueprintSrc: './renders/part_gun_missile.png?v=34',
  },
};

/**
 * Clean vector icons for the bottom Transport / Player Bar.
 */
function renderActionIcon(id) {
  const props = {
    viewBox: '0 0 24 24',
    width: 15,
    height: 15,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.1,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'btn-svg-icon',
  };

  switch (id) {
    case 'IDLE':
      return h(
        'svg',
        props,
        h('circle', { cx: 12, cy: 12, r: 4 }),
        h('path', { d: 'M12 3v3M12 18v3M3 12h3M18 12h3' })
      );
    case 'WALK':
      return h('svg', props, h('path', { d: 'M13 5l7 7-7 7M5 5l7 7-7 7' }));
    case 'FAST_WALK':
      return h(
        'svg',
        props,
        h('polygon', { points: '13 19 22 12 13 5 13 19' }),
        h('polygon', { points: '2 19 11 12 2 5 2 19' })
      );
    case 'SIT':
      return h(
        'svg',
        props,
        h('path', { d: 'M12 4v10M7 9l5 5 5-5' }),
        h('line', { x1: 4, y1: 19, x2: 20, y2: 19 })
      );
    case 'TURN':
      return h(
        'svg',
        props,
        h('path', { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
        h('path', { d: 'M3 3v5h5' }),
        h('path', { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' })
      );
    case 'HEAD_UP':
      return h('svg', props, h('path', { d: 'M18 15l-6-6-6 6' }));
    case 'HEAD_DOWN':
      return h('svg', props, h('path', { d: 'M6 9l6 6 6-6' }));
    case 'FIRE':
      return h(
        'svg',
        props,
        h('circle', { cx: 12, cy: 12, r: 7 }),
        h('circle', { cx: 12, cy: 12, r: 2.2, fill: 'currentColor' }),
        h('line', { x1: 12, y1: 2, x2: 12, y2: 5 }),
        h('line', { x1: 12, y1: 19, x2: 12, y2: 22 }),
        h('line', { x1: 2, y1: 12, x2: 5, y2: 12 }),
        h('line', { x1: 19, y1: 12, x2: 22, y2: 12 })
      );
    case 'WIREFRAME':
      return h(
        'svg',
        props,
        h('polygon', { points: '12 2 21 7 21 17 12 22 3 17 3 7 12 2' }),
        h('line', { x1: 12, y1: 22, x2: 12, y2: 12 }),
        h('line', { x1: 21, y1: 7, x2: 12, y2: 12 }),
        h('line', { x1: 3, y1: 7, x2: 12, y2: 12 })
      );
    case 'EXPLODE':
      return h(
        'svg',
        props,
        h('path', {
          d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7M3 9V3h6M21 15v6h-6M3 3l7 7M21 21l-7-7',
        })
      );
    case 'SOUND_ON':
      return h(
        'svg',
        props,
        h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }),
        h('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }),
        h('path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' })
      );
    case 'SOUND_OFF':
      return h(
        'svg',
        props,
        h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }),
        h('line', { x1: 23, y1: 9, x2: 17, y2: 15 }),
        h('line', { x1: 17, y1: 9, x2: 23, y2: 15 })
      );
    case 'RESET':
    default:
      return h(
        'svg',
        props,
        h('path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
        h('path', { d: 'M3 3v5h5' })
      );
  }
}

const ORTHO_STAMPS = [
  { id: 'side', preset: 'side', label: 'SIDE', src: './renders/ortho_side.png?v=26' },
  { id: 'front', preset: 'front', label: 'FRONT', src: './renders/ortho_front.png?v=26' },
  { id: 'top', preset: 'reference', label: 'TOP', src: './renders/ortho_top.png?v=26' },
  { id: 'rear', preset: 'rear', label: 'REAR', src: './renders/ortho_rear.png?v=26' },
];

// 6-barrel circular positions around (50, 50) with radius 21
const BARREL_BORES = [0, 60, 120, 180, 240, 300].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return {
    cx: (50 + Math.cos(rad) * 21).toFixed(1),
    cy: (50 + Math.sin(rad) * 21).toFixed(1),
  };
});

// 24 polar protractor ticks around center (720, 460)
const PROTRACTOR_TICKS = Array.from({ length: 24 }, (_, i) => {
  const rad = ((i * 15) * Math.PI) / 180;
  const r1 = i % 3 === 0 ? 276 : 284;
  const r2 = 294;
  return {
    x1: (720 + Math.cos(rad) * r1).toFixed(1),
    y1: (460 + Math.sin(rad) * r1).toFixed(1),
    x2: (720 + Math.cos(rad) * r2).toFixed(1),
    y2: (460 + Math.sin(rad) * r2).toFixed(1),
    major: i % 3 === 0,
  };
});

/**
 * Cohesive Warm-Vellum Spatial Layout (`?v=26`):
 * - Left Card (`.left-telemetry-card`): Architectural drafting card featuring a Dual-Schematic Vector Stage (Top-Down Quadruped Gait & Azimuth Cone + 6-Bore Rotary Muzzle Cross-Section) above a crisp 2×2 live telemetry grid.
 * - Bottom-Left (`.poster-bottom-left`): Kept 100% as-is (`1.97m × 1.86m · 420kg` + 4 clickable Ortho Thumbnails).
 * - Right Major Card (`.right-anatomy-card`): Kept 100% as-is.
 */
function SpatialAnatomyCanvas({
  activeOrtho,
  weaponType,
  onSelectOrthoStamp,
  onFocusPreset,
  onGimbalPointerEvent,
  dossierRpmRef,
  barrelTempRef,
  muzzleRotorSvgRef,
  headAimRef,
  rightGunRpmRef,
  rightHeadAimRef,
  rightLegClearanceRef,
  turretNeedleSvgRef,
  chassisMmRef,
  legPostureRef,
  gaitPairARef,
  gaitPairBRef,
}) {
  const activeWeaponSpec = WEAPON_SPECS[weaponType] || WEAPON_SPECS.GATLING;

  return h(
    React.Fragment,
    null,

    // ========================================================================
    // 1. ARCHITECTURAL POLAR PROTRACTOR & RANGE RING BACKDROP
    // ========================================================================
    h(
      'div',
      { className: 'spatial-backdrop-layer', 'aria-hidden': 'true' },
      h(
        'svg',
        {
          viewBox: '0 0 1440 900',
          preserveAspectRatio: 'xMidYMid slice',
          className: 'spatial-leader-svg',
        },
        h('circle', {
          cx: 720,
          cy: 460,
          r: 294,
          fill: 'none',
          stroke: '#d5cfc3',
          strokeWidth: '1.1',
        }),
        h('circle', {
          cx: 720,
          cy: 460,
          r: 232,
          fill: 'none',
          stroke: '#cbc5b8',
          strokeWidth: '1.1',
          strokeDasharray: '6 6',
        }),
        h('circle', {
          cx: 720,
          cy: 460,
          r: 168,
          fill: 'none',
          stroke: '#ded9ce',
          strokeWidth: '1',
        }),
        PROTRACTOR_TICKS.map((t, idx) =>
          h('line', {
            key: idx,
            x1: t.x1,
            y1: t.y1,
            x2: t.x2,
            y2: t.y2,
            stroke: t.major ? '#a8a195' : '#ccc6ba',
            strokeWidth: t.major ? '1.4' : '1',
          })
        ),
        h('line', { x1: 385, y1: 460, x2: 438, y2: 460, stroke: '#b5afa2', strokeWidth: '1.2' }),
        h('line', { x1: 1002, y1: 460, x2: 1055, y2: 460, stroke: '#b5afa2', strokeWidth: '1.2' }),
        h('line', { x1: 720, y1: 135, x2: 720, y2: 178, stroke: '#b5afa2', strokeWidth: '1.2' }),
        h('line', { x1: 720, y1: 742, x2: 720, y2: 785, stroke: '#b5afa2', strokeWidth: '1.2' }),
        h(
          'text',
          { x: 720, y: 126, textAnchor: 'middle', fill: '#8e887d', fontSize: '9', fontFamily: 'IBM Plex Mono', fontWeight: '700' },
          '000° N · TURRET BORE AXIS'
        ),
        h(
          'text',
          { x: 720, y: 800, textAnchor: 'middle', fill: '#8e887d', fontSize: '9', fontFamily: 'IBM Plex Mono', fontWeight: '700' },
          '180° S · Ø 1.86M FOOTPRINT ENVELOPE'
        )
      )
    ),

    // ========================================================================
    // 2. LEFT CARD: SLEEK TACTILE INSTRUMENT WELLS & PILL METRICS CARD
    // ========================================================================
    h(
      'section',
      { className: 'left-telemetry-card', 'aria-label': 'Kinematic and Ballistic Vector Schematics' },
      h(
        'div',
        { className: 'ltc-top-row' },
        h('span', { className: 'ltc-eyebrow' }, 'KINEMATICS & PAYLOAD'),
        h('span', { ref: legPostureRef, className: 'ltc-posture-pill' }, 'STANDING')
      ),

      // Two Tactile Recessed Instrument Wells Side-by-Side
      h(
        'div',
        { className: 'ltc-wells-row' },
        // Well 1: Top-Down Quadruped Footfall & Turret Azimuth Vector (Interactive Drag to Aim Head!)
        h(
          'div',
          {
            className: 'ltc-well-card interactive-well',
            title: 'Drag anywhere in dial to aim Head 360° Yaw & Pitch',
            onPointerDown: (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onGimbalPointerEvent(e);
            },
            onPointerMove: (e) => {
              if (e.buttons > 0) onGimbalPointerEvent(e);
            },
          },
          h(
            'svg',
            { viewBox: '0 0 100 100', className: 'ltc-schem-svg' },
            h('circle', {
              cx: 50,
              cy: 50,
              r: 42,
              fill: 'none',
              stroke: '#d6d1c6',
              strokeWidth: '1',
              strokeDasharray: '2.5 2.5',
            }),
            h('line', { x1: 50, y1: 4, x2: 50, y2: 11, stroke: '#b5afa2', strokeWidth: '1.2' }),
            h('line', { x1: 50, y1: 89, x2: 50, y2: 96, stroke: '#b5afa2', strokeWidth: '1.2' }),
            h('line', { x1: 4, y1: 50, x2: 11, y2: 50, stroke: '#b5afa2', strokeWidth: '1.2' }),
            h('line', { x1: 89, y1: 50, x2: 96, y2: 50, stroke: '#b5afa2', strokeWidth: '1.2' }),
            // Diagonal Gait Pair A (FL -> RR)
            h(
              'g',
              { ref: gaitPairARef, className: 'gait-pair active-pair' },
              h('polyline', { points: '50,50 32,32 21,21', fill: 'none', strokeWidth: '2.2' }),
              h('polyline', { points: '50,50 68,68 79,79', fill: 'none', strokeWidth: '2.2' }),
              h('circle', { cx: 32, cy: 32, r: 2.3 }),
              h('circle', { cx: 68, cy: 68, r: 2.3 }),
              h('circle', { cx: 21, cy: 21, r: 4 }),
              h('circle', { cx: 79, cy: 79, r: 4 })
            ),
            // Diagonal Gait Pair B (FR -> RL)
            h(
              'g',
              { ref: gaitPairBRef, className: 'gait-pair' },
              h('polyline', { points: '50,50 68,32 79,21', fill: 'none', strokeWidth: '2.2' }),
              h('polyline', { points: '50,50 32,68 21,79', fill: 'none', strokeWidth: '2.2' }),
              h('circle', { cx: 68, cy: 32, r: 2.3 }),
              h('circle', { cx: 32, cy: 68, r: 2.3 }),
              h('circle', { cx: 79, cy: 21, r: 4 }),
              h('circle', { cx: 21, cy: 79, r: 4 })
            ),
            h('circle', {
              cx: 50,
              cy: 50,
              r: 13,
              fill: '#f8f6f0',
              stroke: '#18181b',
              strokeWidth: '1.8',
            }),
            h(
              'g',
              { ref: turretNeedleSvgRef, style: { transformOrigin: '50px 50px' } },
              h('polygon', {
                points: '50,50 40,14 60,14',
                fill: 'rgba(230, 86, 22, 0.14)',
              }),
              h('line', { x1: 50, y1: 50, x2: 50, y2: 11, stroke: '#e65616', strokeWidth: '2.4' }),
              h('circle', { cx: 50, cy: 50, r: 3.4, fill: '#e65616' })
            )
          ),
          h('span', { className: 'ltc-well-lbl' }, '4-LIMB GAIT & YAW')
        ),

        // Well 2: Active Weapon Muzzle Cross-Section (Gatling 6-Bore / Railgun Coils / Missile 8-Tube Matrix)
        h(
          'div',
          { className: 'ltc-well-card' },
          h(
            'svg',
            { viewBox: '0 0 100 100', className: 'ltc-schem-svg' },
            h('circle', {
              cx: 50,
              cy: 50,
              r: 42,
              fill: 'none',
              stroke: '#d6d1c6',
              strokeWidth: '1',
              strokeDasharray: '2.5 2.5',
            }),
            h('circle', {
              cx: 50,
              cy: 50,
              r: 34,
              fill: '#f8f6f0',
              stroke: '#18181b',
              strokeWidth: '1.6',
            }),
            weaponType === 'RAILGUN'
              ? h(
                  'g',
                  null,
                  h('rect', { x: 25, y: 24, width: 11, height: 52, rx: 2, fill: '#ffffff', stroke: '#18181b', strokeWidth: '1.6' }),
                  h('rect', { x: 64, y: 24, width: 11, height: 52, rx: 2, fill: '#ffffff', stroke: '#18181b', strokeWidth: '1.6' }),
                  h('line', { x1: 36, y1: 36, x2: 64, y2: 36, stroke: '#e65616', strokeWidth: '1.8', strokeDasharray: '2 2' }),
                  h('line', { x1: 36, y1: 64, x2: 64, y2: 64, stroke: '#e65616', strokeWidth: '1.8', strokeDasharray: '2 2' }),
                  h('circle', { cx: 50, cy: 50, r: 8.5, fill: '#e65616' }),
                  h('circle', { cx: 50, cy: 50, r: 3.5, fill: '#ffffff' })
                )
              : weaponType === 'MISSILE'
              ? h(
                  'g',
                  null,
                  [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((deg, tIdx) => {
                    const rad = (deg * Math.PI) / 180;
                    const cx = (50 + Math.cos(rad) * 22.5).toFixed(1);
                    const cy = (50 + Math.sin(rad) * 22.5).toFixed(1);
                    return h(
                      'g',
                      { key: tIdx },
                      h('circle', {
                        cx,
                        cy,
                        r: 5.5,
                        fill: '#ffffff',
                        stroke: '#18181b',
                        strokeWidth: '1.5',
                      }),
                      h('circle', {
                        cx,
                        cy,
                        r: 2.3,
                        fill: '#e65616',
                      })
                    );
                  }),
                  h('circle', { cx: 50, cy: 50, r: 6.2, fill: '#18181b' }),
                  h('circle', { cx: 50, cy: 50, r: 2.5, fill: '#ffffff' })
                )
              : h(
                  'g',
                  { ref: muzzleRotorSvgRef, style: { transformOrigin: '50px 50px' } },
                  BARREL_BORES.map((b, idx) =>
                    h(
                      'g',
                      { key: idx },
                      h('circle', {
                        cx: b.cx,
                        cy: b.cy,
                        r: 6.8,
                        fill: '#ffffff',
                        stroke: '#18181b',
                        strokeWidth: '1.6',
                      }),
                      h('circle', {
                        cx: b.cx,
                        cy: b.cy,
                        r: 2.2,
                        fill: '#18181b',
                      })
                    )
                  ),
                  h('circle', { cx: 50, cy: 50, r: 6.5, fill: '#e65616' }),
                  h('circle', { cx: 50, cy: 50, r: 2.2, fill: '#ffffff' })
                )
          ),
          h('span', { className: 'ltc-well-lbl' }, activeWeaponSpec.wellLabel)
        )
      ),

      // 2x2 Tactile Metric Pills (Matches Bottom-Left Typography & Stamp Style)
      h(
        'div',
        { className: 'ltc-pills-grid' },
        h(
          'div',
          { className: 'ltc-metric-pill' },
          h('span', { ref: dossierRpmRef, className: 'ltc-mp-val' }, '0 RPM'),
          h('span', { className: 'ltc-mp-lbl' }, activeWeaponSpec.cadenceLabel)
        ),
        h(
          'div',
          { className: 'ltc-metric-pill' },
          h('span', { ref: barrelTempRef, className: 'ltc-mp-val orange' }, '28°C COLD'),
          h('span', { className: 'ltc-mp-lbl' }, 'BARREL CORE')
        ),
        h(
          'div',
          { className: 'ltc-metric-pill' },
          h('span', { ref: headAimRef, className: 'ltc-mp-val' }, '0° / 0°'),
          h('span', { className: 'ltc-mp-lbl' }, 'GIMBAL AIM')
        ),
        h(
          'div',
          { className: 'ltc-metric-pill' },
          h('span', { ref: chassisMmRef, className: 'ltc-mp-val' }, '560 mm'),
          h('span', { className: 'ltc-mp-lbl' }, 'CLEARANCE')
        )
      )
    ),

    // ========================================================================
    // 3. LOWER-LEFT: OPEN SCALE TYPOGRAPHY + 4 ORTHOGRAPHIC THUMBNAILS (KEPT AS IS!)
    // ========================================================================
    h(
      'div',
      { className: 'poster-bottom-left', 'aria-label': 'Orthographic Projections and Scale' },
      h(
        'div',
        { className: 'pbl-scale-metrics' },
        h(
          'div',
          { className: 'pbl-metric' },
          h('span', { className: 'pbl-big' }, '1.97m'),
          h('span', { className: 'pbl-sub' }, 'HEIGHT')
        ),
        h('span', { className: 'pbl-sep' }, '×'),
        h(
          'div',
          { className: 'pbl-metric' },
          h('span', { className: 'pbl-big' }, '1.86m'),
          h('span', { className: 'pbl-sub' }, 'LENGTH')
        ),
        h('span', { className: 'pbl-sep' }, '·'),
        h(
          'div',
          { className: 'pbl-metric' },
          h('span', { className: 'pbl-big' }, '420kg'),
          h('span', { className: 'pbl-sub' }, '148 PARTS')
        )
      ),
      h(
        'div',
        { className: 'ortho-stamp-row' },
        ORTHO_STAMPS.map((st) =>
          h(
            'button',
            {
              key: st.id,
              className: `ortho-stamp-btn ${activeOrtho === st.id ? 'active' : ''}`,
              onClick: () => onSelectOrthoStamp(st),
              title: `Align 3D view to ${st.label} Orthographic Projection`,
            },
            h('img', { src: st.src, alt: st.label, className: 'ortho-stamp-img' }),
            h('span', { className: 'ortho-stamp-lbl' }, st.label)
          )
        )
      )
    ),

    // ========================================================================
    // 4. RIGHT MAJOR CARD: SUB-ASSEMBLY BLUEPRINT DOSSIER (LONGER, MAJOR HEIGHT)
    // ========================================================================
    h(
      'aside',
      { className: 'right-anatomy-card', 'aria-label': 'Mechanical Sub-Assembly Blueprints' },
      h(
        'div',
        { className: 'rac-sheet-header' },
        h(
          'div',
          { className: 'rac-title-group' },
          h('span', { className: 'rac-tag' }, 'DWG-06'),
          h('span', { className: 'rac-title' }, 'SUB-ASSEMBLY CAD BLUEPRINTS')
        ),
        h('span', { className: 'rac-sub' }, '3 MODULES')
      ),

      h(
        'div',
        { className: 'rac-modules-stack' },

        // MODULE 01: PRIMARY WEAPON PAYLOAD (GATLING / RAILGUN / MISSILE POD)
        h(
          'article',
          {
            className: 'rac-module-block',
            onClick: () => onFocusPreset('front'),
            title: 'Click to align camera to Front Weapon View',
          },
          h(
            'div',
            { className: 'rac-mod-head' },
            h(
              'div',
              { className: 'rac-mod-left' },
              h('span', { className: 'rac-mod-num orange' }, '01'),
              h('span', { className: 'rac-mod-name' }, activeWeaponSpec.modTitle)
            ),
            h('span', { ref: rightGunRpmRef, className: 'rac-mod-live' }, '0 RPM')
          ),
          h(
            'div',
            { className: 'rac-sketch-box' },
            h('span', { className: 'stage-bracket tl' }),
            h('span', { className: 'stage-bracket tr' }),
            h('span', { className: 'stage-bracket bl' }),
            h('span', { className: 'stage-bracket br' }),
            h('img', {
              src: activeWeaponSpec.blueprintSrc,
              alt: 'Primary Weapon Payload Blueprint',
              className: 'rac-sketch-img',
            })
          ),
          h(
            'div',
            { className: 'rac-spec-strip' },
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'CALIBER'),
              h('span', { className: 'rac-sv' }, activeWeaponSpec.caliber)
            ),
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'BREECH'),
              h('span', { className: 'rac-sv' }, activeWeaponSpec.breech)
            ),
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'MAX FEED'),
              h('span', { className: 'rac-sv' }, activeWeaponSpec.maxFeed)
            )
          )
        ),

        // MODULE 02: SPHERICAL GIMBAL HEAD & EXHAUSTS
        h(
          'article',
          {
            className: 'rac-module-block',
            onClick: () => onFocusPreset('rear'),
            title: 'Click to align camera to Spherical Head & Rear Exhausts',
          },
          h(
            'div',
            { className: 'rac-mod-head' },
            h(
              'div',
              { className: 'rac-mod-left' },
              h('span', { className: 'rac-mod-num' }, '02'),
              h('span', { className: 'rac-mod-name' }, 'SPHERICAL HEAD & EXHAUSTS')
            ),
            h('span', { ref: rightHeadAimRef, className: 'rac-mod-live' }, '0° / 0°')
          ),
          h(
            'div',
            { className: 'rac-sketch-box' },
            h('span', { className: 'stage-bracket tl' }),
            h('span', { className: 'stage-bracket tr' }),
            h('span', { className: 'stage-bracket bl' }),
            h('span', { className: 'stage-bracket br' }),
            h('img', {
              src: './renders/part_head.png?v=25',
              alt: 'Spherical Head and Exhausts Blueprint',
              className: 'rac-sketch-img',
            })
          ),
          h(
            'div',
            { className: 'rac-spec-strip' },
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'OPTICS'),
              h('span', { className: 'rac-sv' }, 'T-VISOR + CAM')
            ),
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'MANIFOLD'),
              h('span', { className: 'rac-sv' }, '6× EXHAUSTS')
            ),
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'GIMBAL'),
              h('span', { className: 'rac-sv' }, '360° / +45°')
            )
          )
        ),

        // MODULE 03: 3-DOF ARTICULATED SPIDER LIMB
        h(
          'article',
          {
            className: 'rac-module-block',
            onClick: () => onFocusPreset('underside'),
            title: 'Click to align camera to Lower Spider Limbs',
          },
          h(
            'div',
            { className: 'rac-mod-head' },
            h(
              'div',
              { className: 'rac-mod-left' },
              h('span', { className: 'rac-mod-num' }, '03'),
              h('span', { className: 'rac-mod-name' }, 'ARTICULATED SPIDER LIMB')
            ),
            h('span', { ref: rightLegClearanceRef, className: 'rac-mod-live' }, '560 mm')
          ),
          h(
            'div',
            { className: 'rac-sketch-box' },
            h('span', { className: 'stage-bracket tl' }),
            h('span', { className: 'stage-bracket tr' }),
            h('span', { className: 'stage-bracket bl' }),
            h('span', { className: 'stage-bracket br' }),
            h('img', {
              src: './renders/part_leg.png?v=25',
              alt: 'Articulated Spider Limb Blueprint',
              className: 'rac-sketch-img',
            })
          ),
          h(
            'div',
            { className: 'rac-spec-strip' },
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'FEMUR L1'),
              h('span', { className: 'rac-sv' }, '310mm I-BEAM')
            ),
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'TIBIA L2'),
              h('span', { className: 'rac-sv' }, '355mm SHIN')
            ),
            h(
              'div',
              { className: 'rac-spec-cell' },
              h('span', { className: 'rac-sk' }, 'ANCHOR'),
              h('span', { className: 'rac-sv' }, '2-PAD PINCER')
            )
          )
        )
      )
    )
  );
}

/**
 * R3F Scene managing the centered Spider Turret GLB, 4-leg analytical IK, and firing ballistics.
 */
function SpiderBattlefieldScene({
  glbUrl,
  tslUniforms,
  robotControllerRef,
  cameraControllerRef,
  rendererReadyRef,
  onLoadProgress,
  onLoadComplete,
  onModeChange,
  onTelemetryUpdate,
}) {
  const { scene, camera, gl } = useThree();
  const [robotRootObj, setRobotRootObj] = useState(null);
  const hasInitializedRef = useRef(false);
  const envInitializedRef = useRef(false);

  useEffect(() => {
    scene.background = null;
    scene.fog = null;

    const hemiLight = new THREE.HemisphereLight(0xfffcf5, 0x383a40, 0.95);
    hemiLight.position.set(0, 15, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff6e8, 2.45);
    keyLight.position.set(5.5, 8.5, 6.2);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd8e2f0, 1.05);
    fillLight.position.set(-6.5, 4.5, 3.5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffe8d2, 1.25);
    rimLight.position.set(-3.0, 5.8, -7.2);
    scene.add(rimLight);

    return () => {
      scene.remove(hemiLight);
      scene.remove(keyLight);
      scene.remove(fillLight);
      scene.remove(rimLight);
    };
  }, [scene]);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const camCtrl = new CameraController(camera, gl.domElement);
    cameraControllerRef.current = camCtrl;

    const projSys = new ProjectileSystem(scene);

    loadSpiderTurretRig({
      url: glbUrl,
      tslUniforms,
      onProgress: onLoadProgress,
    })
      .then((rig) => {
        const robotCtrl = new RobotController({
          rig,
          projectileSystem: projSys,
          cameraController: camCtrl,
          tslUniforms,
          onModeChange,
          onTelemetryUpdate,
        });
        robotControllerRef.current = robotCtrl;
        setRobotRootObj(rig.sceneRoot);
        if (onLoadComplete) onLoadComplete();
      })
      .catch((err) => {
        console.error('Failed to load spider_turret.glb:', err);
      });

    return () => {
      if (cameraControllerRef.current) {
        cameraControllerRef.current.dispose();
      }
      if (robotControllerRef.current) {
        robotControllerRef.current.dispose();
      }
    };
  }, [
    glbUrl,
    scene,
    camera,
    gl,
    tslUniforms,
    robotControllerRef,
    cameraControllerRef,
    onLoadProgress,
    onLoadComplete,
    onModeChange,
    onTelemetryUpdate,
  ]);

  useFrame((state, rawDelta) => {
    if (rendererReadyRef && rendererReadyRef.current) {
      if (!envInitializedRef.current) {
        envInitializedRef.current = true;
        try {
          const pmremGenerator = new THREE.PMREMGenerator(state.gl);
          const roomEnv = new RoomEnvironment();
          const envRT = pmremGenerator.fromScene(roomEnv, 0.04);
          state.scene.environment = envRT.texture;
          state.scene.environmentIntensity = 0.72;
          roomEnv.dispose();
          pmremGenerator.dispose();
        } catch (e) {
          console.warn('PMREM environment generation fallback:', e);
        }
      }

      const dt = Math.min(rawDelta, 0.05);
      if (robotControllerRef.current) {
        robotControllerRef.current.update(dt);
      }
      state.gl.render(state.scene, state.camera);
    }
  }, 1);

  return robotRootObj ? h('primitive', { object: robotRootObj }) : null;
}

/**
 * Spatial Anatomy Poster & Interactive 3D Showcase for UNIT-06.
 */
export function SpiderTurretApp({ glbUrl = './spider_turret.glb?v=25' }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [mode, setMode] = useState('inspect'); // 'inspect' | 'control'
  const [activeCamPreset, setActiveCamPreset] = useState('reference');
  const [activeOrtho, setActiveOrtho] = useState('side');
  const [uiFlags, setUiFlags] = useState({
    activeOverride: 'IDLE',
    weaponType: 'GATLING',
    soundEnabled: true,
    isSitting: false,
    isWireframe: false,
    isExploded: false,
  });

  const tslUniforms = useMemo(() => createSpiderTSLUniforms(), []);
  const robotControllerRef = useRef(null);
  const cameraControllerRef = useRef(null);
  const rendererReadyRef = useRef(false);

  const telemetryDataRef = useRef({
    locomotionState: 'IDLE',
    weaponState: 'STANDBY',
    weaponType: 'GATLING',
    chargePct: 0,
    soundEnabled: true,
    testOverride: null,
    isSitting: false,
    isWireframe: false,
    isExploded: false,
    turretYawDeg: 0,
    turretPitchDeg: 0,
    headingDeg: 0,
    barrelRpm: 0,
    barrelHeatPct: 0,
    barrelTempC: 28,
    chassisHeightMm: 560,
    isFiring: false,
    shotsFired: 0,
  });

  // DOM refs for 15Hz live telemetry updates
  const stateDomRef = useRef(null);
  const shotsDomRef = useRef(null);
  const reticleReadoutDomRef = useRef(null);
  const reticleRingDomRef = useRef(null);

  const dossierRpmRef = useRef(null);
  const barrelTempRef = useRef(null);
  const ledContainerRef = useRef(null);
  const muzzleRotorSvgRef = useRef(null);
  const headAimRef = useRef(null);
  const rightGunRpmRef = useRef(null);
  const rightHeadAimRef = useRef(null);
  const rightLegClearanceRef = useRef(null);
  const turretNeedleSvgRef = useRef(null);
  const chassisMmRef = useRef(null);
  const legPostureRef = useRef(null);
  const gaitPairARef = useRef(null);
  const gaitPairBRef = useRef(null);
  const legLoadBarRefs = useRef([]);
  const rotorAngleRef = useRef(0);
  const gimbalPuckDomRef = useRef(null);
  const gimbalDockReadoutRef = useRef(null);

  const handleLoadComplete = useCallback(() => setIsLoaded(true), []);

  const handleTelemetryUpdate = useCallback((nextTel) => {
    telemetryDataRef.current = nextTel;

    if (stateDomRef.current) {
      stateDomRef.current.textContent = nextTel.locomotionState.replace('_', ' ');
    }
    const ySign = nextTel.turretYawDeg > 0 ? '+' : '';
    const pSign = nextTel.turretPitchDeg > 0 ? '+' : '';
    const gimbalStr = `${ySign}${nextTel.turretYawDeg}° / ${pSign}${nextTel.turretPitchDeg}°`;

    if (headAimRef.current) {
      headAimRef.current.textContent = gimbalStr;
    }
    if (rightHeadAimRef.current) {
      rightHeadAimRef.current.textContent = gimbalStr;
    }
    if (gimbalDockReadoutRef.current) {
      gimbalDockReadoutRef.current.textContent = gimbalStr;
    }
    if (gimbalPuckDomRef.current) {
      // Map yaw [-180..180] and pitch [-37..45] to puck offset in [-12px..12px]
      const px = THREE.MathUtils.clamp((-nextTel.turretYawDeg / 180) * 12, -12, 12);
      const py = THREE.MathUtils.clamp((-nextTel.turretPitchDeg / 42) * 12, -12, 12);
      gimbalPuckDomRef.current.style.transform = `translate(calc(-50% + ${px.toFixed(1)}px), calc(-50% + ${py.toFixed(1)}px))`;
    }
    if (turretNeedleSvgRef.current) {
      turretNeedleSvgRef.current.style.transform = `rotate(${nextTel.turretYawDeg}deg)`;
    }

    const wType = nextTel.weaponType || 'GATLING';
    const weaponMetricText =
      wType === 'RAILGUN'
        ? `${nextTel.chargePct || 0}% CAP`
        : wType === 'MISSILE'
        ? nextTel.isFiring
          ? '210 RPM'
          : '8 READY'
        : `${nextTel.barrelRpm} RPM`;

    if (dossierRpmRef.current) {
      dossierRpmRef.current.textContent = weaponMetricText;
    }
    if (rightGunRpmRef.current) {
      rightGunRpmRef.current.textContent = weaponMetricText;
    }
    if (muzzleRotorSvgRef.current) {
      if (nextTel.barrelRpm > 10) {
        rotorAngleRef.current = (rotorAngleRef.current + nextTel.barrelRpm * 0.015) % 360;
        muzzleRotorSvgRef.current.style.transform = `rotate(${rotorAngleRef.current.toFixed(1)}deg)`;
      }
    }
    // Update 12-segment vellum thermal matrix
    if (ledContainerRef.current) {
      const children = ledContainerRef.current.children;
      const activeCells = Math.max(1, Math.round((nextTel.barrelHeatPct / 100) * 12));
      for (let i = 0; i < children.length; i++) {
        if (i < activeCells) {
          children[i].className =
            i >= 8 ? 'ltc-led-cell lit-hot' : i >= 4 ? 'ltc-led-cell lit-warm' : 'ltc-led-cell lit-low';
        } else {
          children[i].className = 'ltc-led-cell';
        }
      }
    }
    if (shotsDomRef.current) {
      shotsDomRef.current.textContent = `${nextTel.shotsFired} RDS`;
    }
    if (chassisMmRef.current) {
      chassisMmRef.current.textContent = `${nextTel.chassisHeightMm} mm`;
    }
    if (rightLegClearanceRef.current) {
      rightLegClearanceRef.current.textContent = `${nextTel.chassisHeightMm} mm`;
    }
    if (legPostureRef.current) {
      if (nextTel.isSitting) {
        legPostureRef.current.textContent = 'CROUCHED';
      } else if (nextTel.locomotionState !== 'IDLE') {
        legPostureRef.current.textContent = nextTel.locomotionState.replace('_', ' ');
      } else {
        legPostureRef.current.textContent = 'STANDING';
      }
    }
    // Update diagonal gait radar & 4-limb hydraulic load bars
    const now = performance.now();
    const isMoving = nextTel.locomotionState !== 'IDLE';
    if (gaitPairARef.current && gaitPairBRef.current) {
      if (isMoving) {
        const flip = Math.floor(now / 260) % 2 === 0;
        gaitPairARef.current.setAttribute('class', flip ? 'gait-pair active-pair' : 'gait-pair');
        gaitPairBRef.current.setAttribute('class', !flip ? 'gait-pair active-pair' : 'gait-pair');
      } else {
        gaitPairARef.current.setAttribute('class', 'gait-pair active-pair');
        gaitPairBRef.current.setAttribute('class', 'gait-pair');
      }
    }
    if (legLoadBarRefs.current.length === 4) {
      const baseLoad = nextTel.isSitting ? 84 : 58;
      for (let i = 0; i < 4; i++) {
        const barEl = legLoadBarRefs.current[i];
        if (!barEl) continue;
        const phase = isMoving ? Math.sin(now * 0.012 + (i === 0 || i === 3 ? 0 : Math.PI)) * 28 : 0;
        const pct = Math.min(98, Math.max(22, Math.round(baseLoad + phase)));
        barEl.style.width = `${pct}%`;
      }
    }
    const tempLabel =
      nextTel.barrelHeatPct > 55
        ? `${nextTel.barrelTempC}°C HOT`
        : nextTel.barrelHeatPct > 12
        ? `${nextTel.barrelTempC}°C WARM`
        : `${nextTel.barrelTempC}°C COLD`;
    if (barrelTempRef.current) {
      barrelTempRef.current.textContent = tempLabel;
    }
    if (reticleReadoutDomRef.current) {
      reticleReadoutDomRef.current.textContent = `AZ ${ySign}${nextTel.turretYawDeg}° · EL ${pSign}${nextTel.turretPitchDeg}°`;
    }
    if (reticleRingDomRef.current) {
      reticleRingDomRef.current.className = `reticle-ring ${nextTel.isFiring ? 'firing' : ''}`;
    }

    const nextOverride =
      nextTel.testOverride || (nextTel.locomotionState === 'IDLE' ? 'IDLE' : 'MANUAL');
    const nextSound = nextTel.soundEnabled !== undefined ? nextTel.soundEnabled : true;
    setUiFlags((prev) => {
      if (
        prev.activeOverride === nextOverride &&
        prev.weaponType === wType &&
        prev.soundEnabled === nextSound &&
        prev.isSitting === nextTel.isSitting &&
        prev.isWireframe === nextTel.isWireframe &&
        prev.isExploded === nextTel.isExploded
      ) {
        return prev;
      }
      return {
        activeOverride: nextOverride,
        weaponType: wType,
        soundEnabled: nextSound,
        isSitting: nextTel.isSitting,
        isWireframe: nextTel.isWireframe,
        isExploded: nextTel.isExploded,
      };
    });
  }, []);

  const handleModeSelect = useCallback((nextMode) => {
    if (robotControllerRef.current) {
      robotControllerRef.current.setMode(nextMode);
    }
    setMode(nextMode);
  }, []);

  const handlePresetView = useCallback((preset) => {
    setActiveCamPreset(preset);
    if (preset === 'front' || preset === 'side' || preset === 'rear') {
      setActiveOrtho(preset);
    }
    if (cameraControllerRef.current && robotControllerRef.current) {
      if (cameraControllerRef.current.mode !== 'inspect') {
        robotControllerRef.current.setMode('inspect');
      }
      cameraControllerRef.current.setPresetView(preset, robotControllerRef.current.position);
    }
  }, []);

  const handleSelectOrthoStamp = useCallback(
    (stamp) => {
      setActiveOrtho(stamp.id);
      if (stamp.preset) {
        handlePresetView(stamp.preset);
      }
    },
    [handlePresetView]
  );

  const handleTestTrigger = useCallback((actionName) => {
    if (robotControllerRef.current) {
      robotControllerRef.current.triggerTestAction(actionName);
    }
  }, []);

  /**
   * Omni-directional 2D Head Gimbal pointer handler:
   * Maps pointer position inside any circular gimbal pad to full 360° Yaw (-180°..+180°)
   * and continuous Up/Down Elevation Pitch (-37°..+45°) at any angle.
   */
  const handleGimbalPointerEvent = useCallback((e) => {
    if (!robotControllerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxR = Math.max(12, rect.width * 0.44);
    let nx = (e.clientX - cx) / maxR;
    let ny = (e.clientY - cy) / maxR;
    const mag = Math.hypot(nx, ny);
    if (mag > 1.0) {
      nx /= mag;
      ny /= mag;
    }
    const targetYawRad = -nx * Math.PI; // Full -180° to +180° (360° direction)
    const targetPitchRad = -ny * 0.72;  // Continuous -41° down to +41° up
    robotControllerRef.current.setManualHeadAim(targetYawRad, targetPitchRad);
  }, []);

  useEffect(() => {
    window.__SPIDER_APP__ = {
      getRobotController: () => robotControllerRef.current,
      getCameraController: () => cameraControllerRef.current,
      setMode: handleModeSelect,
      setPresetView: handlePresetView,
      triggerTest: handleTestTrigger,
      getTelemetry: () => telemetryDataRef.current,
    };
  }, [handleModeSelect, handlePresetView, handleTestTrigger]);

  const locoButtons = [
    { id: 'IDLE', label: 'Stand' },
    { id: 'WALK', label: 'Walk' },
    { id: 'FAST_WALK', label: 'Sprint' },
    { id: 'TURN', label: 'Turn' },
    { id: 'SIT', label: 'Sit' },
  ];

  const camPresets = [
    { id: 'reference', label: '3/4 Studio' },
    { id: 'front', label: 'Front' },
    { id: 'side', label: 'Side' },
    { id: 'rear', label: 'Rear' },
    { id: 'underside', label: 'Low' },
  ];

  const isButtonActive = (id) => {
    if (id === 'SIT') return uiFlags.isSitting;
    if (id === 'WIREFRAME') return uiFlags.isWireframe;
    if (id === 'EXPLODE') return uiFlags.isExploded;
    if (id === 'HEAD_UP' || id === 'HEAD_DOWN' || id === 'RESET') return false;
    if (id === 'IDLE') return uiFlags.activeOverride === 'IDLE' && !uiFlags.isSitting;
    return uiFlags.activeOverride === id;
  };

  return h(
    'div',
    { className: 'bf-viewport' },

    // 1. LEFT TELEMETRY CARD, BOTTOM-LEFT ORTHO STAMPS & RIGHT MAJOR BLUEPRINT CARD
    h(SpatialAnatomyCanvas, {
      activeOrtho,
      weaponType: uiFlags.weaponType,
      onSelectOrthoStamp: handleSelectOrthoStamp,
      onFocusPreset: handlePresetView,
      onGimbalPointerEvent: handleGimbalPointerEvent,
      dossierRpmRef,
      barrelTempRef,
      ledContainerRef,
      muzzleRotorSvgRef,
      headAimRef,
      rightGunRpmRef,
      rightHeadAimRef,
      rightLegClearanceRef,
      turretNeedleSvgRef,
      chassisMmRef,
      legPostureRef,
      gaitPairARef,
      gaitPairBRef,
      legLoadBarRefs,
    }),

    // 2. REACT THREE FIBER WEBGPU + TSL CANVAS (DEAD-CENTER ROBOT)
    h(
      Canvas,
      {
        className: 'bf-canvas-layer',
        frameloop: 'always',
        shadows: false,
        camera: {
          fov: 40,
          near: 0.15,
          far: 85,
          position: [3.10, 2.28, 2.58],
        },
        gl: (defaultProps) => {
          const canvasEl =
            defaultProps instanceof HTMLCanvasElement
              ? defaultProps
              : defaultProps?.canvas;
          const renderer = new WebGPURenderer({
            canvas: canvasEl,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
          renderer.setSize(window.innerWidth, window.innerHeight);
          renderer.setClearColor(0x000000, 0.0);
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.14;
          renderer.init().then(() => {
            rendererReadyRef.current = true;
          });
          return renderer;
        },
      },
      h(SpiderBattlefieldScene, {
        glbUrl,
        tslUniforms,
        robotControllerRef,
        cameraControllerRef,
        rendererReadyRef,
        onLoadProgress: setLoadPct,
        onLoadComplete: handleLoadComplete,
        onModeChange: setMode,
        onTelemetryUpdate: handleTelemetryUpdate,
      })
    ),

    // 3. CENTER TARGETING RETICLE IN INTERACTIVE CONTROL MODE
    mode === 'control' &&
      h(
        'div',
        { className: 'tactical-reticle' },
        h('div', { ref: reticleRingDomRef, className: 'reticle-ring' }),
        h('div', { className: 'reticle-dot' }),
        h('div', { ref: reticleReadoutDomRef, className: 'reticle-readout' }, 'AZ 0° · EL 0°')
      ),

    // 4. TOP-LEFT EDITORIAL TITLE STAMP (OPEN ON VELLUM PAPER)
    h(
      'header',
      { className: 'poster-title-stamp' },
      h(
        'div',
        { className: 'pts-eyebrow' },
        h('span', { className: 'pts-dot' }),
        h('span', null, 'AUTONOMOUS SENTRY PLATFORM')
      ),
      h('h1', { className: 'pts-heading' }, 'UNIT-06 SPIDER TURRET'),
      h(
        'div',
        { className: 'pts-badge-row' },
        h(
          'span',
          { className: 'pts-badge' },
          'STATE: ',
          h('strong', { ref: stateDomRef, className: 'orange' }, 'IDLE')
        ),
        h(
          'span',
          { className: 'pts-badge' },
          'FIRED: ',
          h('strong', { ref: shotsDomRef }, '0 RDS')
        ),
        h('span', { className: 'pts-badge muted' }, '19 ACTIVE JOINTS')
      )
    ),

    // 5. TOP-RIGHT FLOATING CAMERA & MODE PILLS
    h(
      'nav',
      { className: 'poster-top-controls', 'aria-label': 'Camera and Mode Controls' },
      mode === 'inspect' &&
        h(
          'div',
          { className: 'bf-cam-strip' },
          camPresets.map((p) =>
            h(
              'button',
              {
                key: p.id,
                className: `cam-chip ${activeCamPreset === p.id ? 'active' : ''}`,
                onClick: () => handlePresetView(p.id),
              },
              p.label
            )
          )
        ),
      h(
        'div',
        { className: 'bf-mode-pill' },
        h(
          'button',
          {
            className: `mode-btn ${mode === 'inspect' ? 'active' : ''}`,
            onClick: () => handleModeSelect('inspect'),
          },
          '360° Orbit'
        ),
        h(
          'button',
          {
            className: `mode-btn play-mode-btn ${mode === 'control' ? 'active-play' : ''}`,
            onClick: () => handleModeSelect('control'),
          },
          'Live Control'
        )
      )
    ),

    // 6. BOTTOM-CENTER COMPACT FLOATING COMMAND DOCK
    h(
      'footer',
      { className: 'player-dock-wrap' },
      h(
        'div',
        { className: 'player-dock' },
        // Group 1: Locomotion & Posture Pill Strip
        h(
          'div',
          { className: 'player-seg' },
          locoButtons.map((btn) =>
            h(
              'button',
              {
                key: btn.id,
                className: `player-pill ${isButtonActive(btn.id) ? 'active' : ''}`,
                onClick: () => handleTestTrigger(btn.id),
              },
              renderActionIcon(btn.id),
              h('span', null, btn.label)
            )
          )
        ),

        h('div', { className: 'player-divider' }),

        // Group 2: Compact Turret Gimbal Dial + 3-Way Weapon Selector + Fire Trigger
        h(
          'div',
          { className: 'player-seg ordnance-seg' },
          h(
            'div',
            {
              className: 'gimbal-xy-pad',
              title: 'Drag to aim Head 360° & Pitch (Double-click to center at 0°)',
              onPointerDown: (e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                handleGimbalPointerEvent(e);
              },
              onPointerMove: (e) => {
                if (e.buttons > 0) handleGimbalPointerEvent(e);
              },
              onDoubleClick: () => handleTestTrigger('HEAD_CENTER'),
            },
            h('span', { className: 'gimbal-axis-h' }),
            h('span', { className: 'gimbal-axis-v' }),
            h('span', { ref: gimbalPuckDomRef, className: 'gimbal-puck' })
          ),
          Object.values(WEAPON_SPECS).map((wSpec) =>
            h(
              'button',
              {
                key: wSpec.id,
                className: `player-pill compact-pill ${
                  uiFlags.weaponType === wSpec.id ? 'active' : ''
                }`,
                title: `Transform to ${wSpec.modTitle}`,
                onClick: () => handleTestTrigger(wSpec.action),
              },
              h('span', null, wSpec.chip)
            )
          ),
          h(
            'button',
            {
              className: `player-fire-btn ${isButtonActive('FIRE') ? 'active' : ''}`,
              title: (WEAPON_SPECS[uiFlags.weaponType] || WEAPON_SPECS.GATLING).fireLabel,
              onClick: () => handleTestTrigger('FIRE'),
            },
            renderActionIcon('FIRE'),
            h('span', null, 'FIRE')
          )
        ),

        h('div', { className: 'player-divider' }),

        // Group 3: Compact Icon-Only Utility Cluster (SFX, Wireframe, Explode, Reset)
        h(
          'div',
          { className: 'player-seg util-seg' },
          h(
            'button',
            {
              className: `player-pill icon-only-pill ${uiFlags.soundEnabled ? 'active-sfx' : ''}`,
              title: 'Toggle Mechanical & Ballistic Audio SFX (M)',
              onClick: () => handleTestTrigger('TOGGLE_SOUND'),
            },
            renderActionIcon(uiFlags.soundEnabled ? 'SOUND_ON' : 'SOUND_OFF')
          ),
          h(
            'button',
            {
              className: `player-pill icon-only-pill cad-pill ${
                isButtonActive('WIREFRAME') ? 'active-cad' : ''
              }`,
              title: 'Toggle CAD Wireframe Overlay',
              onClick: () => handleTestTrigger('WIREFRAME'),
            },
            renderActionIcon('WIREFRAME')
          ),
          h(
            'button',
            {
              className: `player-pill icon-only-pill cad-pill ${
                isButtonActive('EXPLODE') ? 'active-cad' : ''
              }`,
              title: 'Toggle Mechanical Exploded View',
              onClick: () => handleTestTrigger('EXPLODE'),
            },
            renderActionIcon('EXPLODE')
          ),
          h(
            'button',
            {
              className: 'player-pill icon-only-pill',
              title: 'Reset Pose & Camera (R)',
              onClick: () => handleTestTrigger('RESET'),
            },
            renderActionIcon('RESET')
          )
        )
      )
    ),

    // 7. STUDIO LOADING OVERLAY
    !isLoaded &&
      h(
        'div',
        { className: 'bf-loader-overlay' },
        h(
          'div',
          { className: 'bf-loader-card' },
          h('div', { className: 'loader-eyebrow' }, 'INITIALIZING PROCEDURAL 3D RIG'),
          h('div', { className: 'loader-title' }, 'UNIT-06 SPIDER ROTARY TURRET'),
          h(
            'div',
            {
              className: 'loader-bar-outer',
            },
            h('div', {
              className: 'loader-bar-inner',
              style: { width: `${Math.max(12, loadPct)}%` },
            })
          )
        )
      )
  );
}
