export const ClientConfig = {
  SERVER: {
    API_BASE_URL: 'http://localhost:3000',
  },
  CAMERA: {
    FOLLOW_LERP: 0.1,
    ZOOM: 1.7,
  },
  WORLD: {
    WIDTH: 4000,
    HEIGHT: 4000,
  },
  MOVEMENT: {
    ARRIVAL_THRESHOLD: 15,
    CLICK_MARKER_FADE_MS: 2000,
  },
  COMBAT: {
    ATTACK_TIMEOUT_MS: 3000,
    SCREEN_SHAKE_INTENSITY: 10,
    SCREEN_SHAKE_DURATION: 300,
    RECENT_ATTACK_THRESHOLD_MS: 2000,
    FLOATING_TEXT_RISE: 30,
  },
  // Per-class attack animation tuning
  // impactFrame: the 0-indexed frame where the hit lands (damage text appears)
  // frameRate: override for attack animation speed (null = use default animIntervalMs)
  ATTACK_ANIMS: {
    fighter:  { impactFrame: 1, frameRate: null },
    archer:   { impactFrame: 7, frameRate: 18 },  // 9 frames @ 18fps = 500ms total
    wizard:   { impactFrame: 2, frameRate: null },
    priest:   { impactFrame: 3, frameRate: null },
  } as Record<string, { impactFrame: number; frameRate: number | null }>,
  SELECTION: {
    BOX_COLOR: 0x00ff00,
    BOX_ALPHA: 0.15,
    BOX_STROKE_ALPHA: 0.6,
    MIN_DRAG_PX: 5,
    INDICATOR_COLOR: 0x00ff00,
    INDICATOR_ALPHA: 0.3,
    INDICATOR_RADIUS: 20,
    DESELECTED_ALPHA: 0.5,
  },
  ENEMY: {
    DEATH_FADE_MS: 500,
    DEATH_DESTROY_DELAY_MS: 10000,
  },
  EXPERIENCE: {
    BASE_XP: 100,
    LEVEL_EXPONENT: 1.5,
  },
};
