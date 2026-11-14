/**
 * Новое в 2.0: выделение задач в списке для массовых действий. Ctrl+клик — добавить или убрать строку, Shift+клик —
 * диапазон от последней отмеченной, обычный клик — снять выделение и открыть задачу. Смена репозитория снимает выделение.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Issue } from '../../lib/issues.ts';

export function useIssueSelection(repoPath: string, items: readonly Issue[], open: (number: number) => void) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const anchor = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => setChecked(new Set()), [repoPath]);

  const toggleChecked = useCallback((number: number) => {
    anchor.current = number;
    setChecked((cur) => {
      const next = new Set(cur);
      if (!next.delete(number)) next.add(number);
      return next;
    });
  }, []);

  const onRowClick = useCallback(
    (number: number, mods?: { ctrl: boolean; shift: boolean }) => {
      if (mods?.ctrl) {
        toggleChecked(number);
        return;
      }
      if (mods?.shift && anchor.current != null) {
        const list = itemsRef.current;
        const [a, b] = [list.findIndex((i) => i.number === anchor.current), list.findIndex((i) => i.number === number)].sort((x, y) => x - y);
        if (a >= 0) setChecked(new Set(list.slice(a, b + 1).map((i) => i.number)));
        return;
      }
      anchor.current = number;
      setChecked((cur) => (cur.size ? new Set() : cur));
      open(number);
    },
    [open, toggleChecked],
  );

  return { checked, setChecked, toggleChecked, onRowClick };
}
