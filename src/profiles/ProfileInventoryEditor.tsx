import { useEffect, useMemo, useState } from "react";
import type { AccountProfile, OwnedCharacter, OwnedLightCone, OwnedRelic } from "../domain/profiles";
import type { GameReleaseBundle } from "../domain/releases";

type ProfileInventoryEditorProps = {
  profile: AccountProfile;
  bundle: GameReleaseBundle | null;
  onSave: (profile: AccountProfile) => Promise<void>;
};

function coneInstanceId(cone: OwnedLightCone): string {
  return cone.instanceId ?? `legacy:${cone.logicalId}`;
}

export function ProfileInventoryEditor({ profile, bundle, onSave }: ProfileInventoryEditorProps) {
  const [characters, setCharacters] = useState<OwnedCharacter[]>(profile.characters);
  const [lightCones, setLightCones] = useState<OwnedLightCone[]>(profile.lightCones);
  const [relics, setRelics] = useState<OwnedRelic[]>(profile.relics);
  const [characterId, setCharacterId] = useState("");
  const [lightConeId, setLightConeId] = useState("");
  const [relicSetId, setRelicSetId] = useState("");
  const [relicInstanceId, setRelicInstanceId] = useState("");
  const [relicSlot, setRelicSlot] = useState("");
  const [saving, setSaving] = useState(false);
  const additionsEnabled = bundle !== null && bundle.release.id === profile.dataReleaseId;

  useEffect(() => {
    setCharacters(profile.characters);
    setLightCones(profile.lightCones);
    setRelics(profile.relics);
  }, [profile]);

  const availableCharacters = useMemo(() => bundle?.entities.characters
    .filter(({ validToReleaseId }) => validToReleaseId === null)
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId)) ?? [], [bundle]);
  const equipment = useMemo(() => bundle?.entities.equipment
    .filter(({ validToReleaseId }) => validToReleaseId === null)
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId)) ?? [], [bundle]);

  function addCharacter() {
    if (!additionsEnabled || !characterId || characters.some((item) => item.logicalId === characterId)) return;
    setCharacters((current) => [...current, { logicalId: characterId, eidolon: 0, level: 1 }]
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId)));
  }

  function addLightCone() {
    if (!additionsEnabled || !lightConeId) return;
    const instanceId = `manual:light-cone:${crypto.randomUUID()}`;
    setLightCones((current) => [...current, { instanceId, logicalId: lightConeId, superimposition: 1, level: 1 }]
      .sort((left, right) => coneInstanceId(left).localeCompare(coneInstanceId(right))));
  }

  function addRelic() {
    if (!additionsEnabled || !relicInstanceId.trim() || !relicSetId || !relicSlot.trim()
      || relics.some((item) => item.instanceId === relicInstanceId.trim())) return;
    setRelics((current) => [...current, {
      instanceId: relicInstanceId.trim(), setLogicalId: relicSetId, slot: relicSlot.trim(),
    }].sort((left, right) => left.instanceId.localeCompare(right.instanceId)));
    setRelicInstanceId("");
    setRelicSlot("");
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({ ...profile, updatedAt: new Date().toISOString(), characters, lightCones, relics });
    } finally { setSaving(false); }
  }

  return (
    <section className="inventory-editor" aria-labelledby="inventory-title">
      <h2 id="inventory-title">本地库存</h2>
      {!bundle || bundle.release.id !== profile.dataReleaseId ? <p className="version-warning">
        当前未载入档案版本 {profile.dataReleaseId}；可保存现有 stable ID，但新增选项仅来自当前载入资料。
      </p> : null}

      <fieldset><legend>角色、等级与星魂</legend>
        <div className="inventory-add"><label>添加角色<select aria-label="添加角色" value={characterId} onChange={(event) => setCharacterId(event.target.value)}><option value="">请选择</option>{availableCharacters.map((character) => <option key={character.logicalId} value={character.logicalId}>{character.name} · {character.logicalId}</option>)}</select></label><button type="button" disabled={!additionsEnabled} onClick={addCharacter}>添加角色</button></div>
        {characters.length === 0 ? <p>尚未记录角色。</p> : characters.map((character, index) => <div className="inventory-row" key={character.logicalId}><strong>{character.logicalId}</strong><label>星魂<input aria-label={`${character.logicalId} 星魂`} type="number" min="0" max="6" value={character.eidolon} onChange={(event) => setCharacters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, eidolon: Number(event.target.value) } : item))} /></label><label>等级<input aria-label={`${character.logicalId} 等级`} type="number" min="1" value={character.level} onChange={(event) => setCharacters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, level: Number(event.target.value) } : item))} /></label><button type="button" onClick={() => setCharacters((current) => current.filter((_, itemIndex) => itemIndex !== index))}>移除 {character.logicalId}</button></div>)}
      </fieldset>

      <fieldset><legend>光锥、等级与叠影</legend>
        <div className="inventory-add"><label>添加光锥<select aria-label="添加光锥" value={lightConeId} onChange={(event) => setLightConeId(event.target.value)}><option value="">请选择</option>{equipment.filter(({ kind }) => kind === "light-cone").map((item) => <option key={item.logicalId} value={item.logicalId}>{item.name} · {item.logicalId}</option>)}</select></label><button type="button" disabled={!additionsEnabled} onClick={addLightCone}>添加光锥</button></div>
        {lightCones.length === 0 ? <p>尚未记录光锥。</p> : lightCones.map((cone, index) => { const instanceId = coneInstanceId(cone); return <div className="inventory-row" key={instanceId}><strong>{cone.logicalId}</strong><small>实例 {instanceId}</small><label>叠影<input aria-label={`${instanceId} 叠影`} type="number" min="1" max="5" value={cone.superimposition} onChange={(event) => setLightCones((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, superimposition: Number(event.target.value) } : item))} /></label><label>等级<input aria-label={`${instanceId} 等级`} type="number" min="1" value={cone.level} onChange={(event) => setLightCones((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, level: Number(event.target.value) } : item))} /></label><button type="button" onClick={() => setLightCones((current) => current.filter((_, itemIndex) => itemIndex !== index))}>移除实例 {instanceId}</button></div>; })}
      </fieldset>

      <fieldset><legend>遗器库存</legend>
        <div className="inventory-add relic-add"><label>实例 ID<input aria-label="遗器实例 ID" value={relicInstanceId} onChange={(event) => setRelicInstanceId(event.target.value)} /></label><label>套装<select aria-label="遗器套装" value={relicSetId} onChange={(event) => setRelicSetId(event.target.value)}><option value="">请选择</option>{equipment.filter(({ kind }) => kind === "relic-set").map((item) => <option key={item.logicalId} value={item.logicalId}>{item.name} · {item.logicalId}</option>)}</select></label><label>部位<input aria-label="遗器部位" value={relicSlot} onChange={(event) => setRelicSlot(event.target.value)} /></label><button type="button" disabled={!additionsEnabled} onClick={addRelic}>添加遗器</button></div>
        {relics.length === 0 ? <p>尚未记录遗器。</p> : <ul>{relics.map((relic) => <li key={relic.instanceId}>{relic.instanceId} · {relic.setLogicalId} · {relic.slot} <button type="button" onClick={() => setRelics((current) => current.filter(({ instanceId }) => instanceId !== relic.instanceId))}>移除 {relic.instanceId}</button></li>)}</ul>}
      </fieldset>
      <button type="button" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存库存"}</button>
    </section>
  );
}
