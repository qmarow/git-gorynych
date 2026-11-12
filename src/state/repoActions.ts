// Действия `repo:action(dir, name, payload)`: имя → аргумент и результат.
// В bindings результат — одно объединение `ActionOutput_Serialize` без метки, поэтому соответствие «имя → тип» записано
// здесь по `RepoEngine::run` (crates/gorynych-git/src/actions/mod.rs). Новое действие в Rust без строки здесь — ошибка
// типов (`ActionOutputs` обязан покрыть все имена `RepoAction_Deserialize`).
import type {
  AccessInfo_Serialize,
  BranchCreated_Serialize,
  BranchDeleted,
  BranchRenamed,
  BranchUpdated_Serialize,
  CheckoutPreview_Serialize,
  Checkout_Serialize,
  CommitResult_Serialize,
  ConflictInfo_Serialize,
  Discarded,
  FastForwarded,
  FetchResult,
  FileRestored,
  GitRawResult,
  HeadMoved_Serialize,
  HistoryLabel,
  HunksApplied,
  OperationResult_Serialize,
  PullResult_Serialize,
  PushResult_Serialize,
  RebaseDone_Serialize,
  RefMoved_Serialize,
  RemoteBranchDeleted,
  RepoAction_Deserialize,
  ResetResult_Serialize,
  ResolveResult_Serialize,
  RevertPreview_Serialize,
  RevertedTo_Serialize,
  StashFilesRestored,
  StashPopped,
  StashPushed,
  StashRef,
  TagInfo_Serialize,
} from '../../crates/gorynych-tauri/bindings/commands.ts';

export type RepoActionName = RepoAction_Deserialize['name'];

/**
 * Поля, у которых JSON не совпадает с типом в bindings: `PathsArg` разбирается своим `Deserialize`
 * (`write.rs`: строка `'all'` или список путей), а specta описывает само перечисление (`"All" | { List }`).
 */
type WirePayloads = {
  stage: { paths: 'all' | string[] };
  unstage: { paths: 'all' | string[] };
};

/** Аргумент действия, как его отправляет интерфейс (поля на стороне Rust необязательны и разбираются мягко) */
export type ActionPayload<N extends RepoActionName> = N extends keyof WirePayloads
  ? WirePayloads[N]
  : Extract<RepoAction_Deserialize, { name: N }>['payload'];

type Outputs = {
  checkAccess: AccessInfo_Serialize;
  fetch: FetchResult;
  pull: PullResult_Serialize;
  push: PushResult_Serialize;
  undo: HistoryLabel;
  redo: HistoryLabel;
  continueOperation: OperationResult_Serialize;
  abortOperation: OperationResult_Serialize;
  stage: string;
  unstage: string;
  commit: CommitResult_Serialize;
  checkout: Checkout_Serialize;
  checkoutPreview: CheckoutPreview_Serialize;
  createBranch: BranchCreated_Serialize;
  stash: StashPushed;
  stashApplyAt: StashRef;
  stashPopAt: StashRef;
  stashDrop: StashRef;
  revertToPreview: RevertPreview_Serialize;
  getConflict: ConflictInfo_Serialize;
  saveResolution: ResolveResult_Serialize;
  resolveWhole: ResolveResult_Serialize;
  markResolved: ResolveResult_Serialize;
  revertTo: RevertedTo_Serialize;
  checkoutCommit: Checkout_Serialize;
  createTag: TagInfo_Serialize;
  deleteTag: TagInfo_Serialize;
  deleteRemoteBranch: RemoteBranchDeleted;
  renameBranch: BranchRenamed;
  deleteBranch: BranchDeleted;
  cherryPick: HeadMoved_Serialize;
  revert: HeadMoved_Serialize;
  reset: ResetResult_Serialize;
  merge: RefMoved_Serialize;
  rebase: RefMoved_Serialize;
  rebaseApply: RebaseDone_Serialize;
  rebaseStart: RebaseDone_Serialize;
  restoreFile: FileRestored;
  restoreFromStash: StashFilesRestored;
  applyHunks: HunksApplied;
  mergeInto: RefMoved_Serialize;
  cherryPickInto: HeadMoved_Serialize;
  updateBranch: BranchUpdated_Serialize;
  fastForward: FastForwarded;
  gitRaw: GitRawResult;
  discardAll: Discarded;
  stashPop: StashPopped;
};

// Ровно те же имена, что у `RepoAction`: пропущенное имя — «Property … is missing», лишнее — несовместимость с `never`
type Covers<T extends Record<RepoActionName, unknown> & Record<Exclude<keyof T, RepoActionName>, never>> = T;

export type ActionOutputs = Covers<Outputs>;
export type ActionOutput<N extends RepoActionName> = ActionOutputs[N];
