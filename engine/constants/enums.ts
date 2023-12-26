export enum ComponentCategory {
  NONE,
  AUGMENT,
  PROJECTILE_AUGMENT,
  BEHAVIOR,
  COLLIDEFILTER,
  CONTAINER,
  DAMAGE,
  DAMAGEMOD,
  EFFECT,
  ENEMY,
  INTERACTION,
  TRIGGER,
  MENU,
  PICKUP,
  PHYSICS,
  RENDERING,
  UI,
  WEAPON,
  SPEEDMOD,
  PROJECTILECOUNTMOD,
  GEM,
  TYPE,
  DAMAGEAPPLIER,
  ONHIT,
  ONPICKUP,
  ONE_OFF,
  CORE,
  MAP,
  DAMAGEINTERACTION,
  TARGET,
  AURA,
}

export enum EntityType {
  ENTITY,
  ENEMY,
  ALTAR,
  PROJECTILE,
  PICKUP,
  ALLY,
  WEAPON,
  WALL,
  INTERACTABLE,
  MAP,
  DOOR,
  PLAYER,
}

export enum WeaponTypeEnum {
  NONE,
  SWORD,
  BOW,
  GUN,
  STAFF,
  MAGIC,
}

export enum EnemyTypeEnum {
  U_DEF,
  ALL,
  DEMON,
  SLUDGE,
  NECROMANCER,
  ORC,
  ZOMBIE,
}

export enum TriggerTypeEnum {
  DEATH,
  HEALTH_DECREASE,
  HEALTH_INCREASE,
  ONATTACH,
}

export enum WaveTypeEnum {
  SINE,
  SQUARE,
  TRIANGLE,
  SAWTOOTH,
}

export enum ReactStateEnum {
  CHASING,
  IDLE,
  INITIAL,
}

export enum GemTypeEnum {
  SUPPORT,
  DASH,
  ABILITY,
  ULTIMATE,
}

export enum AuraApplicatorTypeEnum {
  ON_HIT,
  SELF,
}

// prettier-ignore
export enum CollisionCategoryEnum {
  NONE =          0b0000000000000000,
  DEFAULT =       0b0000000000000001,
  ALLY =          0b0000000000000010,
  ENEMY =         0b0000000000000100,
  PROJECTILE =    0b0000000000001000,
  PICKUP =        0b0000000000010000,
  WALL =          0b0000000000100000,
  INTERACTABLE =  0b0000000001000000,
  MAP =           0b0000000010000000,
  TERRAIN =       0b0000000100000000,
  ALL =           0b1111111111111111,
}

export enum SeekPointSpeedTypeEnum {
  LINEAR,
  SLOW,
  SINE,
  SINE_SLOW,
  SAWTOOTH,
  SAWTOOTH_SLOW,
}

export enum MobCircleSpawnStrategyEnum {
  RANDOM,
  UNIFORM,
}

export enum OrbPatternEnum {
  NONE,
  STROBE_ROTATE,
}

export enum DamageDirectionEnum {
  PROJECTILE,
  OWNER,
}

export enum DamageTypeEnum {
  NORMAL,
  FIRE,
  ICE,
  SHOCK,
  CHAOS,
}

export enum DamageCategoryEnum {
  NONE,
  MELEE,
  RANGED,
  MAGIC,
  AOE,
}

export enum FaceDirectionEnum {
  NONE,
  ROTATE,
  HORIZONTAL,
  VERTICAL,
  HORIZONTAL_ROTATE,
}

export enum PickupStateEnum {
  PICKED_UP,
  CARRIED,
  DROPPED,
  ON_THE_GROUND,
  STUCK,
  STATIC,
  INTERACTABLE,
  BROKEN,
}

export enum FlingComponentPositionTypeEnum {
  CIRCLE,
  POSITION,
  CIRCLE_POSITION,
}

export enum InheritFromParentEnum {
  NONE,
  OWNER,
  SOURCE,
  WEAPON,
  HIT_OWNER,
  HIT_SOURCE,
  HIT_WEAPON,
  HIT_VALUE,
  REVERSE_HIT_VALUE,
}

export enum DialogTypeEnum {
  YARN,
  TEXT,
  CHOICE,
  CONFIRM,
  RESTART,
}

export enum VisibleConditionEnum {
  COMPONENT,
}

export enum VisibleConditionTypeEnum {
  BOOLEAN,
  NUMBER,
  STRING,
}

export enum VisibleConditionOperatorEnum {
  EQUAL,
  NOT_EQUAL,
  GREATER_THAN,
  LESS_THAN,
  GREATER_THAN_OR_EQUAL,
  LESS_THAN_OR_EQUAL,
}

export enum StabStateEnum {
  STAB,
  RETURN,
  NONE,
}

export enum SwingStateEnum {
  WINDUP,
  SWING,
  NONE,
}
