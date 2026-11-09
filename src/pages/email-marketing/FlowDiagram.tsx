import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, Clock, Crown, Diamond, Gift, List, LogOut, Mail, MoreHorizontal, Pencil, PhoneOff, Plus, RefreshCw, Repeat, ShoppingBag, ShoppingCart, Tag, Trash2, UserPlus
} from "lucide-react";
import type { EmFlowNode, EmTrigger, EmWorkflow } from "../../lib/api";
import { checkQuestion, triggerText, waitText, type ActionKey, type Slot } from "./automation-model";

/**
 * The flow as Bright's designs draw it: trigger, steps joined by arrows, a
 * check splitting into Yes / No. Read-only on the Automations page and step 1;
 * editable in step 3 ("+" places, drop places, a menu on each step).
 */

export const TRIGGER_ICON: Record<EmTrigger["kind"], typeof Mail> = {
  order_delivered: ShoppingCart, order_placed: ShoppingBag, cart_abandoned: ShoppingCart, new_subscriber: UserPlus,
  inactive: RefreshCw, date_field: Gift, vip: Crown, reorder: Repeat, went_quiet: PhoneOff
};

export const DRAG_TYPE = "application/x-protohub-action";

type Props = {
  trigger: EmTrigger;
  flow: EmWorkflow;
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onAdd?: (slot: Slot) => void;
  onDropAction?: (slot: Slot, action: ActionKey) => void;
  onMenu?: (id: string, action: "edit" | "up" | "down" | "delete") => void;
};

function Arrow({ tone = "#4C32C4" }: { tone?: string }) {
  return (
    <svg width="14" height="22" viewBox="0 0 14 22" aria-hidden className="shrink-0">
      <line x1="7" y1="0" x2="7" y2="16" stroke={tone} strokeWidth="2" />
      <path d="M2 14l5 6 5-6" fill={tone} />
    </svg>
  );
}

function AddSpot({ slot, editable, onAdd, onDropAction }: { slot: Slot; editable?: boolean; onAdd?: (slot: Slot) => void; onDropAction?: Props["onDropAction"] }) {
  const [over, setOver] = useState(false);
  if (!editable) return null;
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const action = event.dataTransfer.getData(DRAG_TYPE) as ActionKey;
    if (action) onDropAction?.(slot, action);
  };
  return (
    <button type="button" aria-label="Add a step here" onClick={() => onAdd?.(slot)}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)} onDrop={drop}
      className={`!min-h-0 my-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed transition-all ${over ? "h-9 w-40 border-[#5B3FD9] bg-[#EEEBFC] text-[#5B3FD9]" : "border-[#C9BEF5] bg-white text-[#5B3FD9] hover:border-[#5B3FD9] dark:bg-slate-900"}`}>
      <Plus className="h-3.5 w-3.5" />{over && <span className="ml-1 text-[12px] font-semibold">Drop here</span>}
    </button>
  );
}

function NodeMenu({ onMenu, id, first, last }: { onMenu: NonNullable<Props["onMenu"]>; id: string; first: boolean; last: boolean }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [open]);
  const items: Array<{ key: "edit" | "up" | "down" | "delete"; label: string; icon: typeof Pencil; hide?: boolean }> = [
    { key: "edit", label: "Edit step", icon: Pencil },
    { key: "up", label: "Move up", icon: ArrowUp, hide: first },
    { key: "down", label: "Move down", icon: ArrowDown, hide: last },
    { key: "delete", label: "Delete step", icon: Trash2 }
  ];
  return (
    <>
      <button ref={button} type="button" aria-label="Step menu" onClick={(event) => {
        event.stopPropagation();
        const rect = button.current!.getBoundingClientRect();
        setAt({ top: rect.bottom + 4, left: Math.min(window.innerWidth - 180, rect.right - 168) });
        setOpen((value) => !value);
      }} className="!min-h-0 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && at && createPortal(
        <div style={{ top: at.top, left: at.left }} className="fixed z-[120] w-[168px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
          {items.filter((item) => !item.hide).map((item) => (
            <button key={item.key} type="button" onClick={() => { setOpen(false); onMenu(id, item.key); }}
              className={`!min-h-0 flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800 ${item.key === "delete" ? "text-rose-600" : "text-gray-700 dark:text-slate-200"}`}>
              <item.icon className="h-4 w-4" />{item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function Card({ children, tone = "plain", selected, onClick, menu, wide = true }: { children: ReactNode; tone?: "plain" | "trigger" | "green" | "end"; selected?: boolean; onClick?: () => void; menu?: ReactNode; wide?: boolean }) {
  const look = {
    trigger: "border-[#B9A3FF] bg-[#F1ECFF] dark:border-violet-500/50 dark:bg-violet-500/15",
    plain: "border-[#D9D2F7] bg-[#FBFAFF] dark:border-slate-700 dark:bg-slate-900",
    green: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    end: "border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800"
  }[tone];
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(event) => { if (onClick && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); } }}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${wide ? "w-[230px]" : "min-w-[130px]"} ${look} ${onClick ? "cursor-pointer hover:border-[#8B74EE]" : ""} ${selected ? "ring-2 ring-[#5B3FD9]" : ""}`}>
      {children}
      {menu}
    </div>
  );
}

const Title = ({ top, bottom }: { top: string; bottom?: string }) => (
  <span className="min-w-0 flex-1">
    <span className="block truncate text-[13px] font-bold leading-tight text-gray-900 dark:text-slate-50" title={top}>{top}</span>
    {bottom && <span className="block truncate text-[12px] leading-tight text-gray-600 dark:text-slate-400" title={bottom}>{bottom}</span>}
  </span>
);

function NodeView({ node, props, first, last }: { node: EmFlowNode; props: Props; first: boolean; last: boolean }) {
  const menu = props.editable && props.onMenu ? <NodeMenu onMenu={props.onMenu} id={node.id} first={first} last={last} /> : undefined;
  const select = props.onSelect ? () => props.onSelect!(node.id) : undefined;
  const selected = props.selectedId === node.id;
  switch (node.type) {
    case "wait":
      return <Card wide={false} onClick={select} selected={selected} menu={menu}><Clock className="h-6 w-6 shrink-0 text-[#4C32C4]" /><Title top="Wait" bottom={waitText(node)} /></Card>;
    case "email":
      return <Card onClick={select} selected={selected} menu={menu}><Mail className="h-6 w-6 shrink-0 text-[#4C32C4]" /><Title top={node.name} bottom={node.email.preheader || node.email.subject || "No subject yet"} /></Card>;
    case "tag":
      return <Card tone="green" onClick={select} selected={selected} menu={menu}><Tag className="h-6 w-6 shrink-0 text-emerald-600" /><Title top={`${node.action === "add" ? "Add Tag" : "Remove Tag"}`} bottom={node.tagName || "Pick a tag"} /></Card>;
    case "list":
      return <Card tone="green" onClick={select} selected={selected} menu={menu}><List className="h-6 w-6 shrink-0 text-emerald-600" /><Title top="Add to List" bottom={node.listName || "Pick a list"} /></Card>;
    case "exit":
      return <Card tone="end" wide={false} onClick={select} selected={selected} menu={menu}><LogOut className="h-5 w-5 shrink-0 text-gray-500" /><Title top="End Flow" /></Card>;
    default:
      return null;
  }
}

function Branch({ nodes, slotBase, props }: { nodes: EmFlowNode[]; slotBase: Omit<Slot, "index">; props: Props }) {
  return (
    <div className="flex flex-col items-center">
      {nodes.map((node, index) => (
        <div key={node.id} className="flex flex-col items-center">
          {(index > 0 || props.editable) && <AddSpot slot={{ ...slotBase, index }} editable={props.editable} onAdd={props.onAdd} onDropAction={props.onDropAction} />}
          {(index > 0 || props.editable) && <Arrow />}
          {node.type === "condition"
            ? <Condition node={node} props={props} first={index === 0} last={index === nodes.length - 1} />
            : <NodeView node={node} props={props} first={index === 0} last={index === nodes.length - 1} />}
        </div>
      ))}
      {nodes.length > 0 && props.editable && <Arrow />}
      <AddSpot slot={{ ...slotBase, index: nodes.length }} editable={props.editable} onAdd={props.onAdd} onDropAction={props.onDropAction} />
    </div>
  );
}

function Condition({ node, props, first, last }: { node: Extract<EmFlowNode, { type: "condition" }>; props: Props; first: boolean; last: boolean }) {
  const menu = props.editable && props.onMenu ? <NodeMenu onMenu={props.onMenu} id={node.id} first={first} last={last} /> : undefined;
  return (
    <div className="flex flex-col items-center">
      <Card onClick={props.onSelect ? () => props.onSelect!(node.id) : undefined} selected={props.selectedId === node.id} menu={menu}>
        <Diamond className="h-6 w-6 shrink-0 text-[#4C32C4]" /><Title top={node.name || checkQuestion(node.check)} />
      </Card>
      <div className="relative mt-0 flex items-start gap-5 pt-1">
        <span aria-hidden className="absolute left-[25%] right-[25%] top-0 h-3 rounded-t-lg border-x-2 border-t-2 border-[#4C32C4]" />
        {(["yes", "no"] as const).map((side) => (
          <div key={side} className="flex min-w-[180px] flex-col items-center pt-3">
            <span className={`mb-1 rounded-full px-3 py-0.5 text-[12px] font-bold ${side === "yes" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300"}`}>{side === "yes" ? "Yes" : "No"}</span>
            <Arrow tone={side === "yes" ? "#4C32C4" : "#E11D48"} />
            <Branch nodes={side === "yes" ? node.yes : node.no} slotBase={{ parentId: node.id, branch: side }} props={props} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FlowDiagram(props: Props) {
  const TriggerIcon = TRIGGER_ICON[props.trigger.kind] ?? ShoppingCart;
  return (
    <div className="inline-flex min-w-full flex-col items-center px-4 py-3">
      <Card tone="trigger"><TriggerIcon className="h-6 w-6 shrink-0 text-[#4C32C4]" /><Title top="Trigger" bottom={triggerText(props.trigger)} /></Card>
      {(!props.editable || props.flow.nodes.length === 0) && <Arrow />}
      {props.flow.nodes.length === 0 && !props.editable && <p className="m-0 mt-1 text-[12.5px] text-gray-500">No steps yet.</p>}
      <Branch nodes={props.flow.nodes} slotBase={{ parentId: null, branch: null }} props={props} />
    </div>
  );
}
