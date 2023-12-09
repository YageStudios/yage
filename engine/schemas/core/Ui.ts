import { Component, Schema, type } from "@/decorators/type";

@Component("Ui")
export class UiSchema extends Schema {
  @type("string")
  public key: string;

  @type(["string"])
  public ui: string[];
}
