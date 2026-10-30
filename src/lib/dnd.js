// Перетаскивание коммитов и веток на ветки (merge / fast-forward / cherry-pick / rebase)

export const REF_MIME = 'application/x-gitidea-ref';

/** payload: { kind: 'commit' | 'branch' | 'remote', hash, name?, label } */
export function startRefDrag(e, payload) {
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData(REF_MIME, JSON.stringify(payload));
  e.dataTransfer.setData('text/plain', payload.name ?? payload.hash);
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
  e.dataTransfer.setDragImage(ghost, 12, 12);
  setTimeout(() => ghost.remove(), 0);
}

export function hasRefDrag(e) {
  return [...(e.dataTransfer?.types ?? [])].includes(REF_MIME);
}

export function readRefDrag(e) {
  try {
    return JSON.parse(e.dataTransfer.getData(REF_MIME));
  } catch {
    return null;
  }
}
