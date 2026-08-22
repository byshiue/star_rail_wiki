import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRelease } from "../app/ReleaseProvider";
import type { AccountProfile } from "../domain/profiles";
import { ProfileInventoryEditor } from "./ProfileInventoryEditor";
import { CURRENT_PROFILE_SCHEMA_VERSION } from "./profileJson";
import { readSelectedProfileUid, selectProfileUid } from "./profileSelection";
import { defaultProfileService, type ImportStrategy, type ProfileService } from "./profileService";

type ProfilePageProps = { service?: ProfileService };

export function ProfilePage({ service = defaultProfileService }: ProfilePageProps) {
  const { bundle, index, loading: releaseLoading, error: releaseError } = useRelease();
  const [profiles, setProfiles] = useState<AccountProfile[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newUid, setNewUid] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const releaseIds = useMemo(() => index?.releases.map(({ id }) => id).sort() ?? (bundle ? [bundle.release.id] : []), [bundle, index]);
  const [releaseId, setReleaseId] = useState("");
  const [rename, setRename] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [importStrategy, setImportStrategy] = useState<ImportStrategy | "">("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [exportedJson, setExportedJson] = useState("");

  const selected = profiles.find(({ uid }) => uid === selectedUid) ?? null;

  async function refresh(preferredUid?: string | null) {
    const loaded = await service.listProfiles();
    setProfiles(loaded);
    const requested = preferredUid === undefined ? readSelectedProfileUid() : preferredUid;
    const next = requested && loaded.some(({ uid }) => uid === requested) ? requested : loaded[0]?.uid ?? null;
    setSelectedUid(next);
    selectProfileUid(next);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    void service.listProfiles().then((loaded) => {
      if (!active) return;
      setProfiles(loaded);
      const remembered = readSelectedProfileUid();
      const next = remembered && loaded.some(({ uid }) => uid === remembered) ? remembered : loaded[0]?.uid ?? null;
      setSelectedUid(next);
      selectProfileUid(next);
      setError(null);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "本地档案读取失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [service]);

  useEffect(() => {
    if (!releaseId && releaseIds.length) setReleaseId(bundle?.release.id ?? releaseIds[0]!);
  }, [bundle?.release.id, releaseId, releaseIds]);

  useEffect(() => { setRename(selected?.label ?? ""); setExportedJson(""); }, [selected]);

  async function act(action: () => Promise<void>) {
    setError(null);
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "本地档案操作失败"); }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      if (profiles.some(({ uid }) => uid === newUid.trim())) throw new Error("UID " + newUid.trim() + " 已存在；请使用导入的显式合并或替换策略");
      const now = new Date().toISOString();
      const created = await service.putProfile({
        schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION, uid: newUid.trim(),
        ...(newLabel.trim() ? { label: newLabel.trim() } : {}),
        dataReleaseId: releaseId, updatedAt: now, characters: [], lightCones: [], relics: [],
      });
      setNewUid(""); setNewLabel("");
      await refresh(created.uid);
    });
  }

  function choose(uid: string) {
    setSelectedUid(uid);
    selectProfileUid(uid);
    setError(null);
  }

  if (loading || releaseLoading) return <p role="status">正在加载本地账号与版本资料…</p>;

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <header><p className="eyebrow">仅存于此浏览器 · 不联网 · 不保存凭证</p><h1 id="profile-title">账号与版本</h1><p>每个九位数字 UID 使用独立 IndexedDB 记录；切换账号不会共享库存。</p></header>
      {releaseError ? <p role="alert">版本资料加载失败：{releaseError}</p> : null}
      {!bundle && index?.currentReleaseId === null ? <div className="version-warning" role="status"><strong>暂无已发布 current 版本。</strong><p>仍可按所选历史或测试版本保存本地档案；版本来源会写入 dataReleaseId。</p></div> : null}
      {error ? <div role="alert" className="build-error">{error}</div> : null}

      <form className="profile-create" onSubmit={create}>
        <h2>新建本地账号</h2>
        <label>新账号 UID<input aria-label="新账号 UID" inputMode="numeric" pattern="[0-9]{9}" value={newUid} onChange={(event) => setNewUid(event.target.value)} /></label>
        <label>显示名<input aria-label="显示名" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} /></label>
        <label>档案数据版本<select aria-label="档案数据版本" value={releaseId} onChange={(event) => setReleaseId(event.target.value)}>{releaseIds.map((id) => <option key={id}>{id}</option>)}</select></label>
        <button type="submit" disabled={!releaseId}>创建本地账号</button>
      </form>

      {profiles.length === 0 ? <p role="status">还没有本地账号。创建或导入后可编辑库存。</p> : <div className="profile-workspace">
        <aside aria-label="本地账号列表"><h2>选择账号</h2>{profiles.map((profile) => <button type="button" aria-pressed={profile.uid === selectedUid} key={profile.uid} onClick={() => choose(profile.uid)}><strong>{profile.label ?? "未命名账号"}</strong><span>{profile.uid}</span></button>)}</aside>
        {selected ? <div className="profile-detail">
          <h2>{selected.label ?? "未命名账号"} · {selected.uid}</h2>
          <p>档案版本 <code>{selected.dataReleaseId}</code> · schema v{selected.schemaVersion} · 更新 {selected.updatedAt}</p>
          <div className="profile-actions"><label>账号显示名<input aria-label="账号显示名" value={rename} onChange={(event) => setRename(event.target.value)} /></label><button type="button" onClick={() => void act(async () => { await service.putProfile({ ...selected, label: rename.trim() || undefined, updatedAt: new Date().toISOString() }); await refresh(selected.uid); })}>保存显示名</button><button type="button" onClick={() => void act(async () => setExportedJson(await service.exportProfile(selected.uid)))}>生成 JSON 备份</button><button type="button" onClick={() => { setDeleteConfirmation(""); setDeleteOpen(true); }}>删除账号</button></div>
          {exportedJson ? <label>JSON 备份<textarea aria-label="JSON 备份" readOnly value={exportedJson} onFocus={(event) => event.currentTarget.select()} /></label> : null}
          <ProfileInventoryEditor profile={selected} bundle={bundle} onSave={async (profile) => { await act(async () => { await service.putProfile(profile); await refresh(profile.uid); }); }} />
        </div> : null}
      </div>}

      <section className="profile-import" aria-labelledby="import-title"><h2 id="import-title">导入 JSON 备份</h2><p>文件在浏览器内验证，不会上传。若 UID 已存在，必须明确选择合并或替换。</p><label>JSON 文件<input aria-label="JSON 文件" type="file" accept="application/json,.json" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} /></label><label>冲突处理<select aria-label="冲突处理" value={importStrategy} onChange={(event) => setImportStrategy(event.target.value as ImportStrategy | "")}><option value="">请选择</option><option value="merge">合并（保留较高投入）</option><option value="replace">替换该 UID</option></select></label><button type="button" disabled={!importFile || !importStrategy} onClick={() => void act(async () => { if (!importFile || !importStrategy) return; const imported = await service.importProfile(await importFile.text(), importStrategy); await refresh(imported.uid); setImportFile(null); setImportStrategy(""); })}>验证并导入</button></section>

      {deleteOpen && selected ? <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" className="delete-dialog"><h2 id="delete-title">删除账号 {selected.uid}</h2><p>此操作仅删除该精确 UID 的本地档案，且无法在站内恢复。请输入完整 UID 确认。</p><label>输入 UID 确认删除<input autoFocus aria-label="输入 UID 确认删除" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><button type="button" onClick={() => setDeleteOpen(false)}>取消</button><button type="button" disabled={deleteConfirmation !== selected.uid} onClick={() => void act(async () => { await service.deleteProfile(selected.uid, deleteConfirmation); setDeleteOpen(false); await refresh(null); })}>永久删除 {selected.uid}</button></section></div> : null}
      <span className="visually-hidden" aria-live="polite">{selectedUid ? `已选择 UID ${selectedUid}` : "未选择 UID"}</span>
    </section>
  );
}
