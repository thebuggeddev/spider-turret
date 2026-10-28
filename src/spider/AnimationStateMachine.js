/**
 * Modular Animation State Machine for the Spider Turret.
 * Coordinates both interactive Control Mode movement states and
 * Inspect Mode / Testing Panel mechanical demonstration modes.
 */
export class AnimationStateMachine {
  constructor(onChangeCallback = null) {
    this.onChangeCallback = onChangeCallback;

    // Active test override triggered from the Mechanical Animation Testing Panel:
    // null | 'IDLE' | 'WALK' | 'FAST_WALK' | 'TURN' | 'AIM' | 'FIRE' | 'BARREL_SPIN'
    this.testOverride = null;
    this.locomotionState = 'IDLE';
    this.weaponState = 'STANDBY';
  }

  setTestOverride(mode) {
    this.testOverride = mode;
    this._notify();
  }

  clearTestOverride() {
    if (this.testOverride !== null) {
      this.testOverride = null;
      this._notify();
    }
  }

  /**
   * Computes the current locomotion and weapon states from live inputs + any active test panel override.
   */
  evaluate({
    fwdInput = 0,
    turnInput = 0,
    strafeInput = 0,
    isFastInput = false,
    isFiringInput = false,
    spinSpeed = 0,
  }) {
    let nextLoco = 'IDLE';
    let nextWeapon = 'STANDBY';

    if (this.testOverride) {
      switch (this.testOverride) {
        case 'IDLE':
          nextLoco = 'IDLE';
          break;
        case 'WALK':
          nextLoco = 'WALK_FORWARD';
          break;
        case 'FAST_WALK':
          nextLoco = 'FAST_WALK';
          break;
        case 'TURN':
          nextLoco = 'TURN_IN_PLACE';
          break;
        case 'AIM':
          nextLoco = 'IDLE';
          nextWeapon = 'TARGET_TRACKING';
          break;
        case 'FIRE':
          nextLoco = 'IDLE';
          nextWeapon = 'FIRING_BURST';
          break;
        case 'BARREL_SPIN':
          nextLoco = 'IDLE';
          nextWeapon = 'BARREL_SPIN';
          break;
        default:
          nextLoco = 'IDLE';
      }
    } else {
      if (Math.abs(fwdInput) > 0.05) {
        if (fwdInput > 0) {
          nextLoco = isFastInput ? 'FAST_WALK' : 'WALK_FORWARD';
        } else {
          nextLoco = isFastInput ? 'FAST_REVERSE' : 'WALK_BACKWARD';
        }
      } else if (Math.abs(strafeInput) > 0.05) {
        nextLoco = strafeInput > 0 ? 'STRAFE_RIGHT' : 'STRAFE_LEFT';
      } else if (Math.abs(turnInput) > 0.05) {
        nextLoco = turnInput > 0 ? 'TURN_LEFT' : 'TURN_RIGHT';
      } else {
        nextLoco = 'IDLE';
      }
    }

    if (isFiringInput || this.testOverride === 'FIRE') {
      nextWeapon = spinSpeed > 8.0 ? 'FIRING_ACTIVE' : 'SPIN_UP';
    } else if (this.testOverride === 'BARREL_SPIN') {
      nextWeapon = 'BARREL_SPIN';
    } else if (spinSpeed > 0.4) {
      nextWeapon = 'SPIN_DOWN';
    } else if (this.testOverride === 'AIM') {
      nextWeapon = 'TARGET_TRACKING';
    }

    const changed = nextLoco !== this.locomotionState || nextWeapon !== this.weaponState;
    this.locomotionState = nextLoco;
    this.weaponState = nextWeapon;

    if (changed) {
      this._notify();
    }

    return {
      locomotionState: this.locomotionState,
      weaponState: this.weaponState,
      testOverride: this.testOverride,
    };
  }

  _notify() {
    if (this.onChangeCallback) {
      this.onChangeCallback({
        locomotionState: this.locomotionState,
        weaponState: this.weaponState,
        testOverride: this.testOverride,
      });
    }
  }
}
