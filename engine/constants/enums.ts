export enum ComponentCategory {
  NONE,
  AUGMENT,
  BEHAVIOR,
  COLLIDEFILTER,
  CONTAINER,
  EFFECT,
  ENEMY,
  INTERACTION,
  TRIGGER,
  MENU,
  PHYSICS,
  RENDERING,
  UI,
  WEAPON,
  SPEEDMOD,
  GEM,
  TYPE,

  PICKUP,
  ONE_OFF,

  CORE,
  MAP,

  PERSIST,

  DAMAGE,
  DAMAGEMOD,

  PROJECTILECOUNTMOD,
  WEAPON_AUGMENT,

  DAMAGEAPPLIER,
  DAMAGEINTERACTION,
  TARGET,
  AURA,

  ON_ITEMDROP_MOD,

  ON_ADD_TO_PARENT,
  ON_REMOVE_FROM_PARENT,

  ON_PICKUP,
  ON_ADD_TO_INVENTORY,

  ON_HIT,
  ON_HIT_MOD,

  ON_DAMAGE,
  ON_APPLY_DAMAGE,

  ON_ENTITY_CREATION,

  ON_KILL,
  ON_DEATH,
  ON_DODGE,
  ON_EJECT,
  ON_HEAL,
  ON_LEVELUP,

  ON_START,
  ON_END,
  ON_LEAVE,
  ON_JOIN,
  ON_PLAYER_DEATH,
}

export enum SoundType {
  DEFAULT,
  FX,
  MUSIC,
  UI,
  VOICE,
  AMBIENT,
}

export enum EntityTypeEnum {
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
  TIME,
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
  PLAYER =        0b0000001000000000,
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

export enum MobSpawnPositionEnum {
  CIRCLE,
  GROUPED,
  RANDOM,
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
  ALLY,
}

export enum DamageCategoryEnum {
  NONE,
  MELEE,
  RANGED,
  ELEMENTAL,
  AOE,
  ALL,
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

export enum AnimationEase {
  LINEAR,
  QUADRATIC,
  CUBIC,
  QUARTIC,
  QUINTIC,
  SINUSOIDAL,
  EXPONENTIAL,
  CIRCULAR,
  ELASTIC,
  BACK,
  BOUNCE,
}

export enum DEPTHS {
  NORUN = -10000000,
  CORE = 0,
  KILLSTATS = 1,
  HEALTH = 1000,
  PLAYER_MOVEMENT = 2000,
  LOCOMOTION = 3000,
  COLLISION = 4000,
  DAMAGE = 5000,
  ATTACH_POST = 6000,
  ITEMS = 7000,
  TRIGGERS = 8000,
  ANIMATE = 9000,
  PREDRAW = 10000,
  DRAW = 11000,
}
