/**
 * Новое в 2.0: экраны раздела «Задачи», когда списка нет совсем: нет входа (`NO_TOKEN`, `AUTH`) — «Войти»; нет сервера
 * (`NO_REMOTE`, `NO_PROVIDER`) — настройки сервера; трекер выключен (`ISSUES_DISABLED`) — настройки на сервере.
 */
import { Inbox, KeyRound, Plug } from 'lucide-react';
import { Button } from '../Dialogs.tsx';
import { t } from '../../i18n/index.ts';
import type { ForgeStatus_Serialize } from '../../../crates/gorynych-tauri/bindings/commands.ts';
import { EmptyState } from './IssueBits.tsx';

const LOGIN_CODES = new Set(['NO_TOKEN', 'AUTH']);
const NO_SERVER_CODES = new Set(['NO_REMOTE', 'NO_PROVIDER']);

export const isFatal = (code: string | null | undefined): code is string => Boolean(code && (LOGIN_CODES.has(code) || NO_SERVER_CODES.has(code) || code === 'ISSUES_DISABLED'));

/** Настройки задач на сервере: GitLab — «Общие», GitHub и Gitea — настройки репозитория. */
function serverSettingsUrl(forge: ForgeStatus_Serialize | null): string | null {
  if (!forge?.webUrl) return null;
  return forge.provider === 'gitlab' ? `${forge.webUrl}/edit` : `${forge.webUrl}/settings`;
}

interface FatalStateProps {
  code: string;
  forge: ForgeStatus_Serialize | null;
  onLogin: () => void;
  onServerSettings: () => void;
  onOpenWeb: (url: string) => void;
}

export default function FatalState({ code, forge, onLogin, onServerSettings, onOpenWeb }: FatalStateProps) {
  if (LOGIN_CODES.has(code)) {
    return (
      <EmptyState state="login" icon={KeyRound} title={t('issues-login-needed', forge?.host ?? '')}>
        <Button variant="primary" onClick={onLogin}>{t('issues-login')}</Button>
      </EmptyState>
    );
  }
  if (NO_SERVER_CODES.has(code)) {
    return (
      <EmptyState state="no-server" icon={Plug} title={t('issues-no-server')}>
        <button type="button" onClick={onServerSettings} className="text-xs text-gk-blue hover:underline">{t('issues-server-settings')}</button>
      </EmptyState>
    );
  }
  const url = serverSettingsUrl(forge);
  return (
    <EmptyState state="disabled" icon={Inbox} title={t('issues-tracker-off')}>
      {url && <Button onClick={() => onOpenWeb(url)}>{t('issues-open-server-settings')}</Button>}
    </EmptyState>
  );
}
