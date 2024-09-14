import type { GameModel } from "yage/game/GameModel";
import { EntityFactory } from "yage/entity/EntityFactory";
import { Child } from "yage/schemas/entity/Child";
import type { Animation } from "yage/schemas/core/Animate";
import { Animate } from "yage/schemas/core/Animate";
import { AnimationEase, DEPTHS } from "yage/constants/enums";
import { System, SystemImpl } from "minecs";

@System(Animate)
export class AnimateSystem extends SystemImpl<GameModel> {
  static depth = DEPTHS.PREDRAW - 1;

  init = (gameModel: GameModel, entity: number) => {
    const animate = gameModel.getTypedUnsafe(Animate, entity);

    for (let i = 0; i < animate.animations.length; i++) {
      const animation = animate.animations[i];
      animation.tweens[0].frameStart = gameModel.timeElapsed;
      if (animation.relative) {
        animation.previousValue = 0;
      }
    }
  };

  run = (gameModel: GameModel, entity: number) => {
    const animate = gameModel.getTypedUnsafe(Animate, entity);
    if (!animate) {
      return;
    }
    const parent = gameModel.getTyped(Child, entity)?.parent;
    for (let i = 0; i < animate.animations.length; i++) {
      const animation = animate.animations[i];
      const tween = animation.tweens[0];
      const progress = (gameModel.timeElapsed - tween.frameStart) / tween.duration;
      const easedProgress = this.ease(progress, tween.ease);
      const value = this.lerp(tween.start, tween.end, easedProgress);

      const component = animation.applyToParent
        ? gameModel.getComponent(animation.componentType, parent ?? -1)
        : gameModel.getComponent(animation.componentType, entity);
      if (component && component[animation.property] !== undefined) {
        if (animation.relative) {
          const relativePosition = component[animation.property] - animation.previousValue;
          component[animation.property] = relativePosition + value;
          animation.previousValue = value;
        } else {
          component[animation.property] = value;
        }
      }
      if (progress >= 1) {
        const shiftedTween = animation.tweens.shift()!;
        if (animation.loop) {
          animation.tweens.push(shiftedTween);
        }
        if (animation.tweens.length > 0) {
          animation.tweens[0].frameStart = gameModel.timeElapsed;
        } else {
          if (animation.spawnChildOnComplete) {
            const overrides: any = {
              Child: { parent: entity },
            };
            for (let i = 0; i < animation.spawnChildOnComplete.overrideComponents?.length ?? 0; i++) {
              const override = animation.spawnChildOnComplete.overrideComponents[i];
              overrides[override.type] = override.data;
            }
            const child = EntityFactory.getInstance().generateEntity(
              gameModel,
              animation.spawnChildOnComplete.description,
              overrides
            );
          }
          animate.animations.splice(i, 1);
          i--;
          if (animate.animations.length === 0) {
            gameModel.removeComponent(Animate, entity);
          }
        }
      }
    }
  };

  lerp(start: number, end: number, progress: number) {
    return start + (end - start) * progress;
  }

  ease(progress: number, ease: AnimationEase) {
    switch (ease) {
      case AnimationEase.LINEAR:
        return progress;
      case AnimationEase.QUADRATIC:
        return progress * progress;
      case AnimationEase.CUBIC:
        return progress * progress * progress;
      case AnimationEase.QUARTIC:
        return progress * progress * progress * progress;
      case AnimationEase.QUINTIC:
        return progress * progress * progress * progress * progress;
      case AnimationEase.SINUSOIDAL:
        return 1 - Math.cos((progress * Math.PI) / 2);
      case AnimationEase.EXPONENTIAL:
        return progress === 0 ? 0 : Math.pow(2, 10 * (progress - 1));
      case AnimationEase.CIRCULAR:
        return 1 - Math.sqrt(1 - progress * progress);
      case AnimationEase.ELASTIC:
        return -1 * Math.pow(2, -10 * progress) * Math.sin(((progress - 0.075) * (2 * Math.PI)) / 0.3);
      case AnimationEase.BACK:
        return progress * progress * (2.70158 * progress - 1.70158);
      case AnimationEase.BOUNCE:
        if (progress < 1 / 2.75) {
          return 7.5625 * progress * progress;
        } else if (progress < 2 / 2.75) {
          return 7.5625 * (progress -= 1.5 / 2.75) * progress + 0.75;
        } else if (progress < 2.5 / 2.75) {
          return 7.5625 * (progress -= 2.25 / 2.75) * progress + 0.9375;
        } else {
          return 7.5625 * (progress -= 2.625 / 2.75) * progress + 0.984375;
        }
    }
  }
}

export const animate = (entity: number, animation: Animation, gameModel: GameModel) => {
  if (!gameModel.hasComponent(Animate, entity)) {
    gameModel.addComponent(Animate, entity);
  }
  animation.tweens[0].frameStart = gameModel.timeElapsed;
  const animate = gameModel.getTypedUnsafe(Animate, entity);
  animate.animations.push(animation);
};
