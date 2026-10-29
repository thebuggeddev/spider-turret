/**
 * Procedural WebAudio Mechanical & Ballistic Sound Synthesizer for UNIT-06 Spider Turret.
 *
 * Zero external audio files required — synthesizes all mechanical actuators, hydraulic
 * footsteps, 360° gimbal servos, rotary drive motors, railgun capacitor charges,
 * micro-missile rocket ignitions, brass shell clinks, and armor impacts in real time
 * using the browser's native Web Audio API.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.initialized = false;

    // Continuous loop nodes (rotor whine, railgun charge, leg/gimbal servo hum)
    this.rotorOscA = null;
    this.rotorOscB = null;
    this.rotorGain = null;

    this.servoOsc = null;
    this.servoFilter = null;
    this.servoGain = null;

    this._lastShotTime = 0;
    this._bindAutoUnlock();
  }

  _bindAutoUnlock() {
    this._unlockHandler = () => {
      if (this.enabled && !this.initialized) {
        this.init();
      } else if (this.ctx && this.ctx.state === 'suspended' && this.enabled) {
        this.ctx.resume();
      }
    };
    window.addEventListener('pointerdown', this._unlockHandler, { passive: true });
    window.addEventListener('keydown', this._unlockHandler, { passive: true });
  }

  init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended' && this.enabled) {
        this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? 0.42 : 0.0;

      // Subtle master compressor to keep rapid rotary fire & explosions punchy without clipping
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;

      this.masterGain.connect(compressor);
      compressor.connect(this.ctx.destination);

      // Pre-generate 2 seconds of white noise for ballistic blasts, rocket plumes & hydraulic hisses
      const sr = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, sr * 2, sr);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2.0 - 1.0;
      }

      // 1. Continuous Weapon Drive / Capacitor Charge Loop
      this.rotorOscA = this.ctx.createOscillator();
      this.rotorOscB = this.ctx.createOscillator();
      this.rotorGain = this.ctx.createGain();
      const rotorFilter = this.ctx.createBiquadFilter();

      this.rotorOscA.type = 'sawtooth';
      this.rotorOscB.type = 'triangle';
      this.rotorOscA.frequency.value = 90;
      this.rotorOscB.frequency.value = 180;

      rotorFilter.type = 'bandpass';
      rotorFilter.frequency.value = 420;
      rotorFilter.Q.value = 2.2;
      this.rotorFilter = rotorFilter;

      this.rotorGain.gain.value = 0.0;
      this.rotorOscA.connect(rotorFilter);
      this.rotorOscB.connect(rotorFilter);
      rotorFilter.connect(this.rotorGain);
      this.rotorGain.connect(this.masterGain);

      this.rotorOscA.start();
      this.rotorOscB.start();

      // 2. Continuous Quadruped Leg & Turret Gimbal Servo Hum Loop
      this.servoOsc = this.ctx.createOscillator();
      this.servoFilter = this.ctx.createBiquadFilter();
      this.servoGain = this.ctx.createGain();

      this.servoOsc.type = 'sawtooth';
      this.servoOsc.frequency.value = 72;
      this.servoFilter.type = 'lowpass';
      this.servoFilter.frequency.value = 240;
      this.servoGain.gain.value = 0.0;

      this.servoOsc.connect(this.servoFilter);
      this.servoFilter.connect(this.servoGain);
      this.servoGain.connect(this.masterGain);
      this.servoOsc.start();

      this.initialized = true;
    } catch (e) {
      console.warn('WebAudio initialization skipped:', e);
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled && !this.initialized) {
      this.init();
    }
    if (this.ctx && this.masterGain) {
      if (this.enabled && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.masterGain.gain.setTargetAtTime(
        this.enabled ? 0.42 : 0.0,
        this.ctx.currentTime,
        0.03
      );
    }
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  /**
   * Updates continuous mechanical loops (weapon spin/charge whine + leg/gimbal servo hum).
   */
  updateContinuous(dt, { weaponType = 'GATLING', spinRatio = 0, chargeRatio = 0, locoActivity = 0, gimbalVel = 0 } = {}) {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Weapon Motor / Railgun Capacitor Loop
    if (weaponType === 'GATLING') {
      const targetGain = spinRatio > 0.02 ? Math.min(0.14, spinRatio * 0.14) : 0.0;
      const baseFreq = 75 + spinRatio * 340;
      this.rotorOscA.frequency.setTargetAtTime(baseFreq, now, 0.04);
      this.rotorOscB.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.04);
      this.rotorFilter.frequency.setTargetAtTime(220 + spinRatio * 950, now, 0.04);
      this.rotorGain.gain.setTargetAtTime(targetGain, now, 0.04);
    } else if (weaponType === 'RAILGUN') {
      const targetGain = chargeRatio > 0.02 ? Math.min(0.22, 0.04 + chargeRatio * 0.18) : 0.0;
      const baseFreq = 140 + Math.pow(chargeRatio, 1.5) * 1180;
      this.rotorOscA.frequency.setTargetAtTime(baseFreq, now, 0.025);
      this.rotorOscB.frequency.setTargetAtTime(baseFreq * 2.02, now, 0.025);
      this.rotorFilter.frequency.setTargetAtTime(380 + chargeRatio * 2200, now, 0.025);
      this.rotorGain.gain.setTargetAtTime(targetGain, now, 0.03);
    } else {
      this.rotorGain.gain.setTargetAtTime(0.0, now, 0.04);
    }

    // 2. Leg IK & Turret Gimbal Servo Hum
    const combinedServo = Math.min(1.0, locoActivity * 0.75 + gimbalVel * 0.65);
    const servoTargetGain = combinedServo > 0.04 ? combinedServo * 0.065 : 0.0;
    const servoFreq = 68 + locoActivity * 54 + gimbalVel * 95;
    this.servoOsc.frequency.setTargetAtTime(servoFreq, now, 0.05);
    this.servoFilter.frequency.setTargetAtTime(190 + combinedServo * 320, now, 0.05);
    this.servoGain.gain.setTargetAtTime(servoTargetGain, now, 0.05);
  }

  /**
   * Synthesizes a weighty hydraulic quadruped footstep impact + claw click on touchdown.
   */
  playFootstep(isFastWalk = false) {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Low-end hydraulic chassis thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const startFreq = isFastWalk ? 82 : 68;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.11);

    const amp = isFastWalk ? 0.24 : 0.17;
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.13);

    // 2. Crisp metallic claw-talon click + pneumatic micro-hiss
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1250, now);
      filter.Q.value = 3.0;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(isFastWalk ? 0.11 : 0.075, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.05);
    }
  }

  /**
   * Synthesizes a 28mm GAU-6 rotary autocannon shot + delayed brass shell casing clink.
   */
  playGatlingShot() {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._lastShotTime < 0.035) return;
    this._lastShotTime = now;

    // 1. Low-mid breech punch
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.065);

    oscGain.gain.setValueAtTime(0.28, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.075);

    // 2. High-pressure muzzle blast crack
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1450, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.08);
      filter.Q.value = 1.1;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.32, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.09);
    }

    // 3. Ejected brass shell casing metallic clink (80ms later)
    const clinkDelay = 0.075 + Math.random() * 0.035;
    const clinkOsc = this.ctx.createOscillator();
    const clinkGain = this.ctx.createGain();
    clinkOsc.type = 'sine';
    const clinkFreq = 4200 + Math.random() * 1400;
    clinkOsc.frequency.setValueAtTime(clinkFreq, now + clinkDelay);
    clinkOsc.frequency.exponentialRampToValueAtTime(clinkFreq * 0.85, now + clinkDelay + 0.035);

    clinkGain.gain.setValueAtTime(0.035, now + clinkDelay);
    clinkGain.gain.exponentialRampToValueAtTime(0.0005, now + clinkDelay + 0.04);

    clinkOsc.connect(clinkGain);
    clinkGain.connect(this.masterGain);
    clinkOsc.start(now + clinkDelay);
    clinkOsc.stop(now + clinkDelay + 0.045);
  }

  /**
   * Synthesizes a thunderous EMG-02 Twin Railgun hypersonic plasma discharge + sub-bass shockwave.
   */
  playRailgunShot() {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Sub-bass electromagnetic recoil shockwave
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(125, now);
    subOsc.frequency.exponentialRampToValueAtTime(22, now + 0.38);

    subGain.gain.setValueAtTime(0.58, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.44);

    // 2. Hypersonic plasma rail whip-crack (high-frequency downward sweep)
    const whipOsc = this.ctx.createOscillator();
    const whipGain = this.ctx.createGain();
    whipOsc.type = 'sawtooth';
    whipOsc.frequency.setValueAtTime(2800, now);
    whipOsc.frequency.exponentialRampToValueAtTime(140, now + 0.16);

    whipGain.gain.setValueAtTime(0.32, now);
    whipGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    whipOsc.connect(whipGain);
    whipGain.connect(this.masterGain);
    whipOsc.start(now);
    whipOsc.stop(now + 0.19);

    // 3. Ionized air thunder tail
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2400, now);
      filter.frequency.exponentialRampToValueAtTime(280, now + 0.34);
      filter.Q.value = 1.4;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.46, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.38);
    }
  }

  /**
   * Synthesizes an MLRS-8 micro-missile tube pop + solid-rocket ignition whoosh.
   */
  playMissileLaunch() {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Pneumatic launch tube breech pop
    const popOsc = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    popOsc.type = 'triangle';
    popOsc.frequency.setValueAtTime(240, now);
    popOsc.frequency.exponentialRampToValueAtTime(52, now + 0.08);

    popGain.gain.setValueAtTime(0.28, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    popOsc.connect(popGain);
    popGain.connect(this.masterGain);
    popOsc.start(now);
    popOsc.stop(now + 0.095);

    // 2. Solid-propellant rocket motor ignition whoosh
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.linearRampToValueAtTime(1850, now + 0.09);
      filter.frequency.exponentialRampToValueAtTime(620, now + 0.34);
      filter.Q.value = 2.1;

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.02, now);
      nGain.gain.linearRampToValueAtTime(0.32, now + 0.04);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.38);
    }
  }

  /**
   * Synthesizes downrange target armor impact clang or warhead detonation boom.
   */
  playTargetImpact(weaponType = 'GATLING', isKill = false) {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (isKill || weaponType === 'MISSILE' || weaponType === 'RAILGUN') {
      const boomOsc = this.ctx.createOscillator();
      const boomGain = this.ctx.createGain();
      boomOsc.type = 'sine';
      boomOsc.frequency.setValueAtTime(isKill ? 95 : 115, now);
      boomOsc.frequency.exponentialRampToValueAtTime(20, now + (isKill ? 0.45 : 0.24));

      boomGain.gain.setValueAtTime(isKill ? 0.52 : 0.30, now);
      boomGain.gain.exponentialRampToValueAtTime(0.001, now + (isKill ? 0.48 : 0.26));
      boomOsc.connect(boomGain);
      boomGain.connect(this.masterGain);
      boomOsc.start(now);
      boomOsc.stop(now + (isKill ? 0.5 : 0.28));
    }

    // Metallic armor plate ring
    const clangOsc = this.ctx.createOscillator();
    const clangGain = this.ctx.createGain();
    clangOsc.type = 'triangle';
    const f = 920 + Math.random() * 480;
    clangOsc.frequency.setValueAtTime(f, now);
    clangOsc.frequency.exponentialRampToValueAtTime(f * 0.65, now + 0.06);

    clangGain.gain.setValueAtTime(0.09, now);
    clangGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    clangOsc.connect(clangGain);
    clangGain.connect(this.masterGain);
    clangOsc.start(now);
    clangOsc.stop(now + 0.07);
  }

  /**
   * Synthesizes a multi-stage mechanical breech retraction, hydraulic servo slide,
   * and heavy metallic lock-in clunk when transforming between weapon payloads.
   */
  playWeaponSwapSound(toWeapon = 'GATLING') {
    if (!this.initialized || !this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Phase A (t = 0.00s): Breech unlatch click + retraction servo sweep down
    const unlatchOsc = this.ctx.createOscillator();
    const unlatchGain = this.ctx.createGain();
    unlatchOsc.type = 'sawtooth';
    unlatchOsc.frequency.setValueAtTime(340, now);
    unlatchOsc.frequency.exponentialRampToValueAtTime(110, now + 0.22);
    unlatchGain.gain.setValueAtTime(0.14, now);
    unlatchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    unlatchOsc.connect(unlatchGain);
    unlatchGain.connect(this.masterGain);
    unlatchOsc.start(now);
    unlatchOsc.stop(now + 0.25);

    // 2. Phase B (t = 0.26s): Heavy breech handover clunk + pneumatic hiss
    const clunkTime = now + 0.25;
    const clunkOsc = this.ctx.createOscillator();
    const clunkGain = this.ctx.createGain();
    clunkOsc.type = 'triangle';
    clunkOsc.frequency.setValueAtTime(145, clunkTime);
    clunkOsc.frequency.exponentialRampToValueAtTime(38, clunkTime + 0.14);
    clunkGain.gain.setValueAtTime(0.26, clunkTime);
    clunkGain.gain.exponentialRampToValueAtTime(0.001, clunkTime + 0.15);
    clunkOsc.connect(clunkGain);
    clunkGain.connect(this.masterGain);
    clunkOsc.start(clunkTime);
    clunkOsc.stop(clunkTime + 0.16);

    // 3. Phase C (t = 0.30s -> 0.64s): Weapon-specific extension & lock-out signature
    const lockTime = now + 0.30;
    const extOsc = this.ctx.createOscillator();
    const extGain = this.ctx.createGain();
    if (toWeapon === 'RAILGUN') {
      // Rising electromagnetic capacitor calibration hum
      extOsc.type = 'sine';
      extOsc.frequency.setValueAtTime(220, lockTime);
      extOsc.frequency.exponentialRampToValueAtTime(980, lockTime + 0.32);
      extGain.gain.setValueAtTime(0.14, lockTime);
      extGain.gain.exponentialRampToValueAtTime(0.001, lockTime + 0.34);
    } else if (toWeapon === 'MISSILE') {
      // Rapid mechanical rack-latch sequence
      extOsc.type = 'square';
      extOsc.frequency.setValueAtTime(180, lockTime);
      extOsc.frequency.setValueAtTime(260, lockTime + 0.10);
      extOsc.frequency.setValueAtTime(340, lockTime + 0.20);
      extGain.gain.setValueAtTime(0.11, lockTime);
      extGain.gain.exponentialRampToValueAtTime(0.001, lockTime + 0.32);
    } else {
      // High-speed rotary indexing spin-lock
      extOsc.type = 'sawtooth';
      extOsc.frequency.setValueAtTime(150, lockTime);
      extOsc.frequency.exponentialRampToValueAtTime(420, lockTime + 0.28);
      extGain.gain.setValueAtTime(0.12, lockTime);
      extGain.gain.exponentialRampToValueAtTime(0.001, lockTime + 0.30);
    }
    extOsc.connect(extGain);
    extGain.connect(this.masterGain);
    extOsc.start(lockTime);
    extOsc.stop(lockTime + 0.35);
  }

  dispose() {
    window.removeEventListener('pointerdown', this._unlockHandler);
    window.removeEventListener('keydown', this._unlockHandler);
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
  }
}
