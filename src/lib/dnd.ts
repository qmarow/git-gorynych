// Перетаскивание коммитов и веток на ветки (merge / fast-forward / cherry-pick / rebase)

export const REF_MIME = 'application/x-gitidea-ref';

export interface RefDragPayload {
  kind: 'commit' | 'branch' | 'remote';
  hash: string;
  name?: string;
  label: string;
}

/** Событие перетаскивания: React `DragEvent` или DOM `DragEvent` — нужен только `dataTransfer`. */
interface DragLike {
  dataTransfer: DataTransfer | null;
}

export function startRefDrag(e: DragLike, payload: RefDragPayload): void {
  const transfer = e.dataTransfer!;
  transfer.effectAllowed = 'copyMove';
  transfer.setData(REF_MIME, JSON.stringify(payload));
  transfer.setData('text/plain', payload.name ?? payload.hash);
  // Своя «ярлычок»-картинка вместо полупрозрачной копии строки
  const ghost = document.createElement('div');
  ghost.textContent = `${payload.kind === 'commit' ? '◉' : '⎇'} ${payload.label}`;
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '-1000px',
    left: '-1000px',
    padding: '4px 10px',
    borderRadius: '6px',
    font: '600 12px Inter, system-ui, sans-serif',
    color: '#fff',
    background: payload.kind === 'commit' ? 'rgba(47,155,255,0.95)' : 'rgba(60,200,140,0.95)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
    whiteSpace: 'nowrap',
    maxWidth: '360px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  document.body.appendChild(ghost);
  transfer.setDragImage(ghost, 12, 12);
  setTimeout(() => ghost.remove(), 0);
}

export function hasRefDrag(e: DragLike): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes(REF_MIME);
}

/** Данные чужого перетаскивания или испорченный JSON — `null`. Форма не проверяется, как и в 1.x. */
export function readRefDrag(e: DragLike): RefDragPayload | null {
  try {
    return JSON.parse(e.dataTransfer!.getData(REF_MIME));
  } catch {
    return null;
  }
}
