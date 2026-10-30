import { AlertTriangle, Link2, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { Button } from './Dialogs.jsx';

const SCOPE_LABELS = {
  api: 'просмотр и действия',
  read_api: 'только просмотр',
};

/**
 * Пайплайны CI/CD работают от авторизации репозитория — той же, что для Pull и Push. Отдельного входа нет:
 * здесь только видно, работает ли она для пайплайнов, и кнопка открыть окно авторизации репозитория.
 */
export function CiAuth({ forge, onEditLogin }) {
  if (!forge) {
    return <p className="text-[13px] text-gk-muted">У репозитория нет remote — авторизовать нечего.</p>;
  }
  const t = forge.token ?? {};
  const host = forge.host;

  if (t.configured) {
    const legacy = t.source === 'legacy' || t.source === 'legacy-shared';
    return (
      <div className="animate-fade-in space-y-3" data-testid="ci-auth" data-source={t.source}>
        <div className="flex items-center gap-3 rounded-lg border border-gk-green/25 bg-gk-green/[0.06] px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fc6d26]/20 text-[13px] font-bold text-[#fc6d26]">
            {(t.user?.name ?? t.user?.username ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] text-gk-strong">
              {t.pending ? <Loader2 size={14} className="shrink-0 animate-spin text-gk-muted" /> : <ShieldCheck size={14} className="shrink-0 text-gk-green" />}
              <span className="truncate">{t.user?.name ?? (t.pending ? 'Проверяем авторизацию…' : 'Авторизован')}</span>
              {t.user?.username && <span className="truncate text-gk-muted">@{t.user.username}</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-gk-muted" data-testid="ci-auth-source">
              <Link2 size={11} className="shrink-0" />
              <span className="truncate">
                {legacy ? 'Токен CI/CD из прежней версии — авторизуйте репозиторий, чтобы всё работало от одной авторизации' : 'Авторизация репозитория — одна для Pull, Push и пайплайнов'}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-gk-dim">
              {host}
              {t.scopes ? ` · ${t.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(', ')}` : ''}
              {t.expiresAt ? ` · действует до ${new Date(t.expiresAt).toLocaleDateString('ru-RU')}` : ''}
            </div>
          </div>
        </div>
        {t.scopes && !t.scopes.includes('api') && (
          <p className="text-[12px] leading-relaxed text-gk-muted">
            Токен только для чтения: пайплайны и логи видны, но запускать, перезапускать и отменять нельзя. Для действий нужен токен с
            правом «api».
          </p>
        )}
        {onEditLogin && (
          <Button onClick={onEditLogin} data-testid="ci-edit-login">
            <LogIn size={13} /> Изменить авторизацию репозитория
          </Button>
        )}
      </div>
    );
  }

  const problem = t.repoLogin;
  return (
    <div className="animate-fade-in space-y-3 text-[13px]" data-testid="ci-auth-setup">
      {problem ? (
        <div data-testid="ci-login-problem" className="flex items-start gap-2 rounded-lg border border-gk-yellow/30 bg-gk-yellow/[0.07] px-3 py-2.5 text-[12.5px] leading-relaxed text-gk-text/90">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-gk-yellow" />
          <span>{problem.reason}</span>
        </div>
      ) : (
        <p data-testid="ci-login-hint" className="text-[12.5px] leading-relaxed text-gk-muted">
          Репозиторий на {host} ещё не авторизован. Авторизуйтесь один раз — эта авторизация будет работать и для Pull/Push, и для
          пайплайнов.
        </p>
      )}
      {onEditLogin && (
        <Button variant="blue" onClick={onEditLogin} data-testid="ci-auth-open">
          <LogIn size={13} /> {problem ? 'Изменить авторизацию репозитория' : 'Авторизовать репозиторий'}
        </Button>
      )}
    </div>
  );
}
