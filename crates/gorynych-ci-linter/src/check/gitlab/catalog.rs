//! Справочники GitLab: начало `electron/ciCheckGitlab.cjs`.

use std::collections::HashSet;
use std::sync::LazyLock;

use crate::check::base::tr;

pub(super) const GLOBAL_KEYS: [&str; 12] = ["default", "include", "stages", "types", "variables", "workflow", "image", "services", "cache", "before_script", "after_script", "spec"];
pub(super) const JOB_KEYS: [&str; 38] = [
    "after_script", "allow_failure", "artifacts", "before_script", "cache", "coverage", "dast_configuration", "dependencies", "environment", "except", "extends", "hooks", "identity", "id_tokens", "image", "inherit",
    "interruptible", "manual_confirmation", "needs", "only", "pages", "parallel", "publish", "release", "resource_group", "retry", "rules", "run", "script", "secrets", "services", "stage", "start_in", "tags", "timeout",
    "trigger", "variables", "when",
];
pub(super) const DEFAULT_KEYS: [&str; 12] = ["after_script", "artifacts", "before_script", "cache", "hooks", "id_tokens", "image", "interruptible", "retry", "services", "tags", "timeout"];
pub(super) const WORKFLOW_KEYS: [&str; 3] = ["name", "rules", "auto_cancel"];
pub(super) const RULE_KEYS: [&str; 9] = ["if", "changes", "exists", "when", "allow_failure", "variables", "needs", "interruptible", "start_in"];
pub(super) const WORKFLOW_RULE_KEYS: [&str; 6] = ["if", "changes", "exists", "when", "variables", "auto_cancel"];
pub(super) const ARTIFACT_KEYS: [&str; 10] = ["paths", "exclude", "expire_in", "expose_as", "name", "public", "access", "reports", "untracked", "when"];
pub(super) const CACHE_KEYS: [&str; 7] = ["key", "paths", "untracked", "unprotect", "when", "policy", "fallback_keys"];
pub(super) const ENV_KEYS: [&str; 7] = ["name", "url", "on_stop", "action", "auto_stop_in", "kubernetes", "deployment_tier"];
pub(super) const REPORTS: [&str; 20] = [
    "accessibility", "annotations", "api_fuzzing", "browser_performance", "coverage_report", "codequality", "container_scanning", "coverage_fuzzing", "cyclonedx", "dast", "dependency_scanning", "dotenv", "junit",
    "load_performance", "metrics", "requirements", "repository_xray", "sast", "secret_detection", "terraform",
];

pub(super) fn removed_report(name: &str) -> Option<String> {
    Some(match name {
        "cobertura" => tr!("coverage_report: { coverage_format: cobertura, path: … } (cobertura удалён в GitLab 15.0)"),
        "performance" => tr!("browser_performance (performance удалён в GitLab 15.0)"),
        "license_management" | "license_scanning" => tr!("cyclonedx / сканирование лицензий (удалено в GitLab 16.0)"),
        _ => return None,
    })
}

pub(super) const JOB_WHEN: [&str; 6] = ["on_success", "on_failure", "always", "manual", "delayed", "never"];
pub(super) const RULE_WHEN: [&str; 6] = JOB_WHEN;
pub(super) const SIMPLE_WHEN: [&str; 3] = ["on_success", "on_failure", "always"];
pub(super) const RETRY_WHEN: [&str; 13] = [
    "always", "unknown_failure", "script_failure", "api_failure", "stuck_or_timeout_failure", "runner_system_failure", "runner_unsupported", "stale_schedule", "job_execution_timeout", "archived_failure", "unmet_prerequisites",
    "scheduler_failure", "data_integrity_failure",
];
pub(super) const ENV_ACTIONS: [&str; 5] = ["start", "prepare", "stop", "verify", "access"];
pub(super) const TIERS: [&str; 5] = ["production", "staging", "testing", "development", "other"];
pub(super) const PIPELINE_SOURCES: [&str; 15] = [
    "api", "chat", "external", "external_pull_request_event", "merge_request_event", "ondemand_dast_scan", "ondemand_dast_validation", "parent_pipeline", "pipeline", "push", "schedule", "security_orchestration_policy", "trigger", "web", "webide",
];
pub(super) const ONLY_REFS: [&str; 12] = ["api", "branches", "chat", "external", "external_pull_requests", "merge_requests", "pipelines", "pushes", "schedules", "tags", "triggers", "web"];
pub(super) const ONLY_KEYS: [&str; 4] = ["refs", "variables", "changes", "kubernetes"];

const PREDEFINED_TEXT: &str = "CI CI_API_V4_URL CI_API_GRAPHQL_URL CI_BUILDS_DIR CI_COMMIT_AUTHOR CI_COMMIT_BEFORE_SHA CI_COMMIT_BRANCH CI_COMMIT_DESCRIPTION CI_COMMIT_MESSAGE \
CI_COMMIT_MESSAGE_IS_TRUNCATED CI_COMMIT_REF_NAME CI_COMMIT_REF_PROTECTED CI_COMMIT_REF_SLUG CI_COMMIT_SHA CI_COMMIT_SHORT_SHA CI_COMMIT_TAG \
CI_COMMIT_TAG_MESSAGE CI_COMMIT_TIMESTAMP CI_COMMIT_TITLE CI_CONCURRENT_ID CI_CONCURRENT_PROJECT_ID CI_CONFIG_PATH CI_DEBUG_TRACE CI_DEBUG_SERVICES \
CI_DEFAULT_BRANCH CI_DEFAULT_BRANCH_SLUG CI_DEPENDENCY_PROXY_DIRECT_GROUP_IMAGE_PREFIX CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX \
CI_DEPENDENCY_PROXY_PASSWORD CI_DEPENDENCY_PROXY_SERVER CI_DEPENDENCY_PROXY_USER CI_DEPLOY_FREEZE CI_DEPLOY_PASSWORD CI_DEPLOY_USER \
CI_DISPOSABLE_ENVIRONMENT CI_ENVIRONMENT_NAME CI_ENVIRONMENT_SLUG CI_ENVIRONMENT_URL CI_ENVIRONMENT_ACTION CI_ENVIRONMENT_TIER CI_RELEASE_DESCRIPTION \
CI_GITLAB_FIPS_MODE CI_HAS_OPEN_REQUIREMENTS CI_JOB_ID CI_JOB_IMAGE CI_JOB_JWT CI_JOB_MANUAL CI_JOB_NAME CI_JOB_NAME_SLUG CI_JOB_STAGE CI_JOB_STATUS \
CI_JOB_TIMEOUT CI_JOB_TOKEN CI_JOB_URL CI_JOB_STARTED_AT CI_KUBERNETES_ACTIVE CI_NODE_INDEX CI_NODE_TOTAL CI_OPEN_MERGE_REQUESTS CI_PAGES_DOMAIN \
CI_PAGES_HOSTNAME CI_PAGES_URL CI_PIPELINE_ID CI_PIPELINE_IID CI_PIPELINE_SOURCE CI_PIPELINE_TRIGGERED CI_PIPELINE_URL CI_PIPELINE_CREATED_AT \
CI_PIPELINE_NAME CI_PIPELINE_SCHEDULE_DESCRIPTION CI_PROJECT_DIR CI_PROJECT_ID CI_PROJECT_NAME CI_PROJECT_NAMESPACE CI_PROJECT_NAMESPACE_ID \
CI_PROJECT_NAMESPACE_SLUG CI_PROJECT_PATH_SLUG CI_PROJECT_PATH CI_PROJECT_REPOSITORY_LANGUAGES CI_PROJECT_ROOT_NAMESPACE CI_PROJECT_TITLE \
CI_PROJECT_DESCRIPTION CI_PROJECT_URL CI_PROJECT_VISIBILITY CI_PROJECT_CLASSIFICATION_LABEL CI_REGISTRY CI_REGISTRY_IMAGE CI_REGISTRY_PASSWORD \
CI_REGISTRY_USER CI_REPOSITORY_URL CI_RUNNER_DESCRIPTION CI_RUNNER_EXECUTABLE_ARCH CI_RUNNER_ID CI_RUNNER_REVISION CI_RUNNER_SHORT_TOKEN \
CI_RUNNER_TAGS CI_RUNNER_VERSION CI_SERVER_FQDN CI_SERVER_HOST CI_SERVER_NAME CI_SERVER_PORT CI_SERVER_PROTOCOL CI_SERVER_SHELL_SSH_HOST \
CI_SERVER_SHELL_SSH_PORT CI_SERVER_REVISION CI_SERVER_TLS_CA_FILE CI_SERVER_TLS_CERT_FILE CI_SERVER_TLS_KEY_FILE CI_SERVER_URL \
CI_SERVER_VERSION_MAJOR CI_SERVER_VERSION_MINOR CI_SERVER_VERSION_PATCH CI_SERVER_VERSION CI_SERVER CI_SHARED_ENVIRONMENT CI_TEMPLATE_REGISTRY_HOST \
CI_TRIGGER_SHORT_TOKEN CI_MERGE_REQUEST_APPROVED CI_MERGE_REQUEST_ASSIGNEES CI_MERGE_REQUEST_DIFF_BASE_SHA CI_MERGE_REQUEST_DIFF_ID \
CI_MERGE_REQUEST_EVENT_TYPE CI_MERGE_REQUEST_DESCRIPTION CI_MERGE_REQUEST_DESCRIPTION_IS_TRUNCATED CI_MERGE_REQUEST_ID CI_MERGE_REQUEST_IID \
CI_MERGE_REQUEST_LABELS CI_MERGE_REQUEST_MILESTONE CI_MERGE_REQUEST_PROJECT_ID CI_MERGE_REQUEST_PROJECT_PATH CI_MERGE_REQUEST_PROJECT_URL \
CI_MERGE_REQUEST_REF_PATH CI_MERGE_REQUEST_SOURCE_BRANCH_NAME CI_MERGE_REQUEST_SOURCE_BRANCH_PROTECTED CI_MERGE_REQUEST_SOURCE_BRANCH_SHA \
CI_MERGE_REQUEST_SOURCE_PROJECT_ID CI_MERGE_REQUEST_SOURCE_PROJECT_PATH CI_MERGE_REQUEST_SOURCE_PROJECT_URL CI_MERGE_REQUEST_SQUASH_ON_MERGE \
CI_MERGE_REQUEST_TARGET_BRANCH_NAME CI_MERGE_REQUEST_TARGET_BRANCH_PROTECTED CI_MERGE_REQUEST_TARGET_BRANCH_SHA CI_MERGE_REQUEST_TITLE \
CI_MERGE_REQUEST_DRAFT CI_EXTERNAL_PULL_REQUEST_IID CI_EXTERNAL_PULL_REQUEST_SOURCE_REPOSITORY CI_EXTERNAL_PULL_REQUEST_TARGET_REPOSITORY \
CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_SHA CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME \
CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_SHA GITLAB_CI GITLAB_FEATURES GITLAB_USER_EMAIL GITLAB_USER_ID GITLAB_USER_LOGIN GITLAB_USER_NAME GITLAB_ENV \
TRIGGER_PAYLOAD CHAT_CHANNEL CHAT_INPUT CHAT_USER_ID KUBECONFIG";

/// `PREDEFINED`.
pub(super) static PREDEFINED: LazyLock<HashSet<&'static str>> = LazyLock::new(|| PREDEFINED_TEXT.split(' ').collect());

/// `[...PREDEFINED]`: порядок значим для `suggest`.
pub(super) fn predefined_ordered() -> impl Iterator<Item = &'static str> {
    PREDEFINED_TEXT.split(' ')
}

/// `CONTENT_VARS`: значение зависит от содержимого, итог не предсказать.
pub(super) fn is_content_var(name: &str) -> bool {
    crate::check::base::re!(r"^(CI_COMMIT_(MESSAGE|TITLE|DESCRIPTION|AUTHOR|TAG_MESSAGE)|CI_MERGE_REQUEST_(LABELS|TITLE|DESCRIPTION|DRAFT|APPROVED|ASSIGNEES|MILESTONE)|GITLAB_USER_\w+|CI_PROJECT_\w+|CI_SERVER_\w+|CI_PIPELINE_SCHEDULE_DESCRIPTION|CI_RUNNER_\w+|CI_REGISTRY\w*|CI_API_\w+)$").test(name)
}

/// `OLD_VARS`.
pub(super) fn old_var(name: &str) -> Option<&'static str> {
    Some(match name {
        "CI_BUILD_REF_NAME" => "CI_COMMIT_REF_NAME",
        "CI_BUILD_REF" => "CI_COMMIT_SHA",
        "CI_BUILD_TAG" => "CI_COMMIT_TAG",
        "CI_BUILD_NAME" => "CI_JOB_NAME",
        "CI_BUILD_STAGE" => "CI_JOB_STAGE",
        "CI_BUILD_ID" => "CI_JOB_ID",
        "CI_BUILD_TOKEN" => "CI_JOB_TOKEN",
        "CI_BUILD_REF_SLUG" => "CI_COMMIT_REF_SLUG",
        "CI_BUILD_BEFORE_SHA" => "CI_COMMIT_BEFORE_SHA",
        "CI_BUILD_REPO" => "CI_REPOSITORY_URL",
        "CI_BUILD_TRIGGERED" => "CI_PIPELINE_TRIGGERED",
        "CI_BUILD_MANUAL" => "CI_JOB_MANUAL",
        _ => return None,
    })
}
