import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import type { StockState } from "../../lib/inventory";
import type { ItemType, MoveType, StockOp } from "./types";

export const itemTypes: Record<ItemType, MessageKey> = {
  part: "inventory.itemType.part",
  consumable: "inventory.itemType.consumable",
  fluid: "inventory.itemType.fluid",
  tire: "inventory.itemType.tire",
  tool: "inventory.itemType.tool",
  merchandise: "inventory.itemType.merchandise",
  other: "inventory.itemType.other",
};

export const moveTypes: Record<MoveType, { labelKey: MessageKey; tone: BadgeTone }> = {
  receipt: { labelKey: "inventory.moveTypeLabel.receipt", tone: "green" },
  return: { labelKey: "inventory.moveTypeLabel.return", tone: "green" },
  transfer_in: { labelKey: "inventory.moveTypeLabel.transfer_in", tone: "blue" },
  transfer_out: { labelKey: "inventory.moveTypeLabel.transfer_out", tone: "blue" },
  issue: { labelKey: "inventory.moveTypeLabel.issue", tone: "slate" },
  sale: { labelKey: "inventory.moveTypeLabel.sale", tone: "slate" },
  consumption: { labelKey: "inventory.moveTypeLabel.consumption", tone: "slate" },
  adjustment: { labelKey: "inventory.moveTypeLabel.adjustment", tone: "purple" },
};

export const stockStateMeta: Record<StockState, { labelKey: MessageKey; tone: BadgeTone }> = {
  ok: { labelKey: "inventory.state.ok", tone: "green" },
  low: { labelKey: "inventory.state.low", tone: "yellow" },
  out: { labelKey: "inventory.state.out", tone: "red" },
  untracked: { labelKey: "inventory.untracked", tone: "slate" },
};

export const opLabels: Record<StockOp, { button: MessageKey; title: MessageKey; done: MessageKey }> = {
  receive: { button: "inventory.op.receive", title: "inventory.opTitle.receive", done: "inventory.opDone.receive" },
  issue: { button: "inventory.op.issue", title: "inventory.opTitle.issue", done: "inventory.opDone.issue" },
  transfer: { button: "inventory.op.transfer", title: "inventory.opTitle.transfer", done: "inventory.opDone.transfer" },
  adjust: { button: "inventory.op.adjust", title: "inventory.opTitle.adjust", done: "inventory.opDone.adjust" },
};
