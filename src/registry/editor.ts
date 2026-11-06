import * as Blockly from "blockly/core";
import { getRuntimeSpec } from "../custom-blocks/runtime";
import type { ImageTarget } from "./types";
import { argValue, setArgValue, slotOwner } from "../blocks/value";

export const isNativeImageField = (type: string, field: string) =>
  field === "IMAGE" ||
  (type === "is_tag" && field === "FROM") ||
  (type === "df_copy" && field === "FROM") ||
  (type === "bc_docker_from" && field === "NAME");
export function imageFields(block: Blockly.Block): string[] {
  const definition = (block as any).byobDefinition;
  if (definition)
    return definition.parameters
      .filter(
        (parameter: any) =>
          ["text", "multiline"].includes(parameter.kind) &&
          definition.bindings.some((binding: any) => {
            const pending = [definition.root];
            while (pending.length) {
              const node: any = pending.pop();
              if (node.id === binding.blockId)
                return (
                  binding.parameterId === parameter.id &&
                  isNativeImageField(node.type, binding.field)
                );
              if (node.next?.block) pending.push(node.next.block);
              if (node.inputs?.BODY?.block)
                pending.push(node.inputs.BODY.block);
            }
            return false;
          }),
      )
      .map(
        (parameter: any) => `P_${parameter.id.replace(/[^A-Za-z0-9_]/g, "_")}`,
      );
  return (getRuntimeSpec(block)?.args ?? [])
    .filter(
      (arg) =>
        isNativeImageField(block.type, arg.name) &&
        !(
          block.type === "bc_docker_from" &&
          block.getFieldValue("KIND") !== "DockerImage"
        ),
    )
    .map((arg) => arg.name);
}
export function imageTarget(block: Blockly.Block, field: string): ImageTarget {
  const workspace = block.workspace,
    id = block.id;
  const spec = getRuntimeSpec(block),
    title =
      spec?.msg.replace(/%\d+/g, "").replace(/\s+/g, " ").trim() ?? "Image";
  const definition = (block as any).byobDefinition;
  const parameter = definition?.parameters?.find(
    (parameter: any) =>
      `P_${parameter.id.replace(/[^A-Za-z0-9_]/g, "_")}` === field,
  );
  const name = String(
    parameter?.label ??
      argValue(block, "NAME") ??
      argValue(block, "STAGE") ??
      "",
  );
  return {
    id: JSON.stringify([workspace.id, id, field]),
    label: `${title}${name ? ` · ${name}` : ""}`,
    reference: String(argValue(block, field) ?? ""),
    apply(reference) {
      if (workspace.getBlockById(id) !== block || !(block.getField(field) || block.getInput(field)))
        throw new Error(
          "Der Zielblock ist nicht mehr vorhanden. Bitte den Image-Browser erneut öffnen.",
        );
      Blockly.Events.setGroup(true);
      try {
        setArgValue(block, field, reference);
        if (argValue(block, field) !== reference)
          throw new Error(
            "Dieses Eingabefeld akzeptiert die Image-Adresse nicht.",
          );
      } finally {
        Blockly.Events.setGroup(false);
      }
    },
  };
}
export let openImagePicker: ((target: ImageTarget) => void) | undefined;
export const setImagePicker = (open: typeof openImagePicker) => {
  openImagePicker = open;
};

/** Keep normal keyboard editing; add the registry action to the existing input popup. */
class RegistryImageField extends Blockly.FieldTextInput {
  static override fromJson(options: Blockly.FieldTextInputFromJsonConfig) {
    return new RegistryImageField(options.text, undefined, options);
  }
  protected override showEditor_(event?: Event) {
    super.showEditor_(event);
    const source = this.getSourceBlock();
    // a literal in a slot belongs to the block that owns the slot
    const owner = source?.type === "byob_image" ? slotOwner(source) : source && this.name ? { block: source, name: this.name } : null;
    if (
      !owner ||
      owner.block.isInFlyout ||
      !openImagePicker ||
      !imageFields(owner.block).includes(owner.name)
    )
      return;
    const { block, name } = owner;
    const host = Blockly.WidgetDiv.getDiv();
    if (!host) return;
    host.querySelector(".registry-field-button")?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "registry-field-button";
    button.textContent = "Image & Tag auswählen…";
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = imageTarget(block, name);
      Blockly.WidgetDiv.hide();
      openImagePicker?.(target);
    });
    host.append(button);
  }
  protected override widgetDispose_() {
    Blockly.WidgetDiv.getDiv()
      ?.querySelector(".registry-field-button")
      ?.remove();
    super.widgetDispose_();
  }
}
let fieldRegistered = false;
export function registerImageField() {
  if (!fieldRegistered) {
    Blockly.fieldRegistry.register("field_registry_image", RegistryImageField);
    fieldRegistered = true;
  }
}
