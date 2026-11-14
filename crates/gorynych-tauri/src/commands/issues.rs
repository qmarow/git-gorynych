//! Новое в 2.0: команды задач (issues) сервера репозитория — тонкая обёртка над `CicdService::issues_*`
//! (`gorynych_cicd::issues`), своей логики здесь нет. Порядок у всех один: `resolve_repo_root(dir)`, затем метод сервиса;
//! `opts.remote` выбирает remote (иначе — upstream текущей ветки или `origin`), как у команд `cicd:*`.
//!
//! Эталона в 1.x нет. Ошибки — `GorynychError` с прежними кодами (`NO_REMOTE`, `NO_PROVIDER`, `NO_TOKEN`, `AUTH`…) и
//! новым `ISSUES_DISABLED` (трекер задач выключен).
//!
//! Номер задачи в аргументах — `u32`: `specta` не пропускает `u64` в TypeScript, а номеров больше 4 млрд не бывает.

use gorynych_cicd::issues::models::{Issue, IssueComment, IssueDetail, IssueInput, IssueLabel, IssueMeta, IssuePatch, IssueQuery, IssuesListResponse};
use gorynych_core::error::Result;
use tauri::State;

use super::cicd::{RemoteOptions, remote, root_of};
use crate::AppState;

/// Страница задач, возможности сервера и адрес списка задач на нём.
#[tauri::command]
#[specta::specta]
pub async fn issues_list(state: State<'_, AppState>, dir: String, query: Option<IssueQuery>, opts: Option<RemoteOptions>) -> Result<IssuesListResponse> {
    let cicd = &state.services()?.cicd;
    cicd.issues_list(&root_of(&dir).await?, &query.unwrap_or_default(), remote(&opts)).await
}

/// Задача с лентой комментариев и событий.
#[tauri::command]
#[specta::specta]
pub async fn issues_get(state: State<'_, AppState>, dir: String, number: u32, opts: Option<RemoteOptions>) -> Result<IssueDetail> {
    let cicd = &state.services()?.cicd;
    cicd.issues_get(&root_of(&dir).await?, u64::from(number), remote(&opts)).await
}

/// Метки, открытые вехи, участники, текущий пользователь и шаблоны задач.
#[tauri::command]
#[specta::specta]
pub async fn issues_meta(state: State<'_, AppState>, dir: String, opts: Option<RemoteOptions>) -> Result<IssueMeta> {
    let cicd = &state.services()?.cicd;
    cicd.issues_meta(&root_of(&dir).await?, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn issues_create(state: State<'_, AppState>, dir: String, input: IssueInput, opts: Option<RemoteOptions>) -> Result<Issue> {
    let cicd = &state.services()?.cicd;
    cicd.issues_create(&root_of(&dir).await?, &input, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn issues_update(state: State<'_, AppState>, dir: String, number: u32, patch: IssuePatch, opts: Option<RemoteOptions>) -> Result<Issue> {
    let cicd = &state.services()?.cicd;
    cicd.issues_update(&root_of(&dir).await?, u64::from(number), &patch, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn issues_comment_add(state: State<'_, AppState>, dir: String, number: u32, body: String, opts: Option<RemoteOptions>) -> Result<IssueComment> {
    let cicd = &state.services()?.cicd;
    cicd.issues_comment_add(&root_of(&dir).await?, u64::from(number), &body, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn issues_comment_update(state: State<'_, AppState>, dir: String, number: u32, id: String, body: String, opts: Option<RemoteOptions>) -> Result<IssueComment> {
    let cicd = &state.services()?.cicd;
    cicd.issues_comment_update(&root_of(&dir).await?, u64::from(number), &id, &body, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn issues_comment_delete(state: State<'_, AppState>, dir: String, number: u32, id: String, opts: Option<RemoteOptions>) -> Result<()> {
    let cicd = &state.services()?.cicd;
    cicd.issues_comment_delete(&root_of(&dir).await?, u64::from(number), &id, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn issues_label_create(state: State<'_, AppState>, dir: String, name: String, color: String, opts: Option<RemoteOptions>) -> Result<IssueLabel> {
    let cicd = &state.services()?.cicd;
    cicd.issues_label_create(&root_of(&dir).await?, &name, &color, remote(&opts)).await
}

#[tauri::command]
#[specta::specta]
pub async fn issues_delete(state: State<'_, AppState>, dir: String, number: u32, opts: Option<RemoteOptions>) -> Result<()> {
    let cicd = &state.services()?.cicd;
    cicd.issues_delete(&root_of(&dir).await?, u64::from(number), remote(&opts)).await
}

#[cfg(test)]
mod tests {
    use gorynych_cicd::issues::models::{IssueSort, IssueState};

    use super::*;

    /// Интерфейс шлёт фильтр частично: пропущенные поля берут значения по умолчанию.
    #[test]
    fn partial_query_and_patch_are_accepted() {
        let query: IssueQuery = serde_json::from_str(r#"{"state":null,"assignee":"@me","sort":"created","ascending":true}"#).unwrap();
        assert_eq!((query.state, query.assignee.as_deref(), query.sort, query.ascending, query.page, query.per_page), (None, Some("@me"), IssueSort::Created, true, 1, 30));
        let query: IssueQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(query.state, Some(IssueState::Open));
        let patch: IssuePatch = serde_json::from_str(r#"{"state":"closed","stateReason":"not_planned","clearMilestone":true}"#).unwrap();
        assert_eq!((patch.state, patch.state_reason.as_deref(), patch.clear_milestone, patch.title), (Some(IssueState::Closed), Some("not_planned"), true, None));
        let input: IssueInput = serde_json::from_str(r#"{"title":"Т","labels":[{"name":"bug"}]}"#).unwrap();
        assert_eq!((input.title.as_str(), input.labels[0].name.as_str(), input.labels[0].id.as_str()), ("Т", "bug", ""));
    }
}
