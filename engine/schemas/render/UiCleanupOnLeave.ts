import { Component, Schema } from "minecs";
import { ComponentCategory } from "yage/constants/enums";

@Component(ComponentCategory.ON_LEAVE)
export class UiCleanupOnLeave extends Schema {}
