//! Новое в 2.0: задачи Bitbucket — их нет.
//!
//! Встроенный трекер задач Bitbucket Cloud и его API (`/repositories/:workspace/:repo/issues`) удалены 20.08.2026
//! (журнал изменений Atlassian: «the API endpoints that support Issue Tracker are now fully removed»); в актуальном
//! `api.bitbucket.org/swagger.json` этих путей нет. У Bitbucket Data Center трекера никогда не было. Поэтому все флаги
//! [`IssueCaps`] — `false`, список — `ISSUES_DISABLED`, остальные действия — `issues-not-supported`. Сетевых запросов нет.

use async_trait::async_trait;
use gorynych_core::error::Result;

use super::*;
use crate::providers::Ctx;

pub struct BitbucketIssues;

#[async_trait]
impl IssueProvider for BitbucketIssues {
    fn caps(&self, _ctx: &Ctx) -> IssueCaps {
        IssueCaps::default()
    }

    fn web_url(&self, _ctx: &Ctx) -> Option<String> {
        None
    }

    async fn list(&self, _ctx: &Ctx, _query: &IssueQuery) -> Result<IssueList> {
        Err(disabled("Bitbucket"))
    }

    async fn get(&self, _ctx: &Ctx, _number: u64) -> Result<IssueDetail> {
        Err(disabled("Bitbucket"))
    }

    async fn meta(&self, _ctx: &Ctx) -> Result<IssueMeta> {
        Err(disabled("Bitbucket"))
    }

    async fn create(&self, _ctx: &Ctx, _input: &IssueInput) -> Result<Issue> {
        Err(not_supported())
    }

    async fn update(&self, _ctx: &Ctx, _number: u64, _patch: &IssuePatch) -> Result<Issue> {
        Err(not_supported())
    }

    async fn comment_add(&self, _ctx: &Ctx, _number: u64, _body: &str) -> Result<IssueComment> {
        Err(not_supported())
    }

    async fn comment_update(&self, _ctx: &Ctx, _number: u64, _id: &str, _body: &str) -> Result<IssueComment> {
        Err(not_supported())
    }

    async fn comment_delete(&self, _ctx: &Ctx, _number: u64, _id: &str) -> Result<()> {
        Err(not_supported())
    }

    async fn label_create(&self, _ctx: &Ctx, _name: &str, _color: &str) -> Result<IssueLabel> {
        Err(not_supported())
    }

    async fn delete(&self, _ctx: &Ctx, _number: u64) -> Result<()> {
        Err(not_supported())
    }
}
