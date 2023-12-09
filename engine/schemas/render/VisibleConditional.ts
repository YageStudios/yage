import { VisibleConditionEnum, VisibleConditionOperatorEnum, VisibleConditionTypeEnum } from "@/constants/enums";
import { Component, Schema, defaultValue, type } from "@/decorators/type";

class VisibleConditionSchema extends Schema {
  @type(VisibleConditionEnum)
  condition: VisibleConditionEnum;

  @type("string")
  component: string;

  @type("string")
  key: string;

  @type("string")
  stringValue: string;

  @type("boolean")
  booleanValue: string;

  @type("number")
  numberValue: string;

  @type(VisibleConditionTypeEnum)
  valueType: VisibleConditionTypeEnum;

  @type(VisibleConditionOperatorEnum)
  @defaultValue(VisibleConditionOperatorEnum.EQUAL)
  operator: VisibleConditionOperatorEnum;
}

@Component("VisibleConditional")
export class VisibleConditionalSchema extends Schema {
  @type([VisibleConditionSchema])
  @defaultValue([])
  conditions: VisibleConditionSchema[];
}
