import type { ChangeEvent } from "react";
import type { GameReleaseBundle } from "../domain/releases";
import type { TeamBuild, TeamMemberBuild } from "../effects/evaluateTeam";

type TeamSlotsProps = {
  bundle: GameReleaseBundle;
  build: TeamBuild;
  maxSlots?: number;
  onChange: (slot: number, update: Partial<TeamMemberBuild> | null) => void;
};

export function TeamSlots({ bundle, build, maxSlots = 4, onChange }: TeamSlotsProps) {
  const characters = bundle.entities.characters.filter(({ validToReleaseId }) => validToReleaseId === null);
  const cones = bundle.entities.equipment.filter((item) => item.kind === "light-cone" && item.validToReleaseId === null);
  const relics = bundle.entities.equipment.filter((item) => item.kind === "relic-set" && item.validToReleaseId === null);
  const selectedIds = new Set(build.members.map((member) => member.characterLogicalId));

  function memberAt(slot: number) {
    return build.members.find((member) => member.slotId === `slot-${slot}`);
  }

  function selectCharacter(slot: number, event: ChangeEvent<HTMLSelectElement>) {
    const characterLogicalId = event.target.value;
    onChange(slot, characterLogicalId ? {
      characterLogicalId, eidolon: 0, lightCone: undefined, relicSets: undefined, skillLevels: undefined,
    } : null);
  }

  function updateSkillLevel(
    slot: number, member: TeamMemberBuild, featureLogicalId: string, level: number,
  ) {
    onChange(slot, { skillLevels: { ...(member.skillLevels ?? {}), [featureLogicalId]: level } });
  }

  function updateRelic(slot: number, member: TeamMemberBuild, index: number, logicalId: string) {
    const relicSets = (member.relicSets ?? []).filter((set): set is NonNullable<typeof set> => Boolean(set));
    if (index > relicSets.length) return;
    if (logicalId && index === relicSets.length) relicSets.push({ logicalId, pieces: 2 });
    else if (logicalId) relicSets[index] = { logicalId, pieces: 2 };
    else relicSets.splice(index, 1);
    onChange(slot, { relicSets: relicSets.length ? relicSets : undefined });
  }

  function updateRelicPieces(slot: number, member: TeamMemberBuild, index: number, pieces: number) {
    const relicSets = (member.relicSets ?? []).filter((set): set is NonNullable<typeof set> => Boolean(set));
    const selected = relicSets[index];
    if (!selected) return;
    relicSets[index] = { ...selected, pieces };
    onChange(slot, { relicSets });
  }

  return (
    <section className="team-panel" aria-labelledby="team-slots-title">
      <div className="section-heading">
        <div><p className="eyebrow">队伍配置</p><h2 id="team-slots-title">{maxSlots === 1 ? "单角色构筑" : "最多四名角色"}</h2></div>
        <span className="release-pin">正式服 {bundle.release.gameVersion}</span>
      </div>
      <div className="team-slots">
        {Array.from({ length: maxSlots }, (_, index) => {
          const slot = index + 1;
          const member = memberAt(slot);
          const character = characters.find(({ logicalId }) => logicalId === member?.characterLogicalId);
          const selectedCone = cones.find(({ logicalId }) => logicalId === member?.lightCone?.logicalId);
          const characterFeatures = character && member ? [
            ...character.abilities,
            ...character.traces,
            ...character.eidolons.slice(0, member.eidolon),
          ] : [];
          const scalingFeatures = characterFeatures.flatMap((feature) => {
            const reviewed = bundle.entities.effects.filter((effect) => (
              effect.sourceRevisionId === feature.revisionId
              && effect.reviewStatus === "reviewed" && effect.value.scaling.length > 0
            ));
            if (!reviewed.length) return [];
            const maximumLevels = new Set(reviewed.map(({ value }) => value.scaling.length + 1));
            if (maximumLevels.size !== 1) return [];
            return [{ feature, maximumLevel: [...maximumLevels][0]! }];
          }) ?? [];
          return (
            <fieldset className="team-slot" key={slot}>
              <legend>{slot}号位</legend>
              <label>
                <span>{slot}号位角色</span>
                <select aria-label={`${slot}号位角色`} value={member?.characterLogicalId ?? ""} onChange={(event) => selectCharacter(slot, event)}>
                  <option value="">选择角色</option>
                  {characters.map((option) => (
                    <option
                      key={option.logicalId} value={option.logicalId}
                      disabled={option.logicalId !== member?.characterLogicalId && selectedIds.has(option.logicalId)}
                    >
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              {character && member ? (
                <>
                  <label>
                    <span>{character.name}星魂</span>
                    <select
                      aria-label={`${character.name}星魂`} value={member.eidolon}
                      onChange={(event) => onChange(slot, { eidolon: Number(event.target.value) })}
                    >
                      {Array.from({ length: character.eidolons.length + 1 }, (_, eidolon) => (
                        <option key={eidolon} value={eidolon}>{eidolon}魂</option>
                      ))}
                    </select>
                  </label>
                  {scalingFeatures.map(({ feature, maximumLevel }) => {
                    const explicit = member.skillLevels?.[feature.logicalId];
                    const selectedLevel = explicit ?? 1;
                    return <label key={feature.logicalId}>
                      <span>{feature.name}技能等级</span>
                      <select
                        aria-label={`${character.name}${feature.name}技能等级`}
                        value={selectedLevel}
                        onChange={(event) => updateSkillLevel(slot, member, feature.logicalId, Number(event.target.value))}
                      >
                        {Array.from({ length: maximumLevel }, (_, level) => (
                          <option key={level + 1} value={level + 1}>等级 {level + 1}</option>
                        ))}
                      </select>
                      <small>当前等级：{selectedLevel}{explicit === undefined ? "（默认）" : "（明确选择）"}</small>
                    </label>;
                  })}
                  <label>
                    <span>光锥</span>
                    <select
                      aria-label={`${character.name}光锥`} value={member.lightCone?.logicalId ?? ""}
                      onChange={(event) => onChange(slot, {
                        lightCone: event.target.value ? { logicalId: event.target.value, superimposition: 1 } : undefined,
                      })}
                    >
                      <option value="">未装备</option>
                      {cones.map((cone) => (
                        <option
                          key={cone.logicalId} value={cone.logicalId}
                          disabled={cone.pathRestriction !== null && cone.pathRestriction !== character.path}
                        >
                          {cone.name}{cone.pathRestriction !== null && cone.pathRestriction !== character.path ? "（命途不符）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedCone ? (
                    <label>
                      <span>叠影</span>
                      <select
                        aria-label={`${selectedCone.name}叠影`} value={member.lightCone?.superimposition ?? 1}
                        onChange={(event) => onChange(slot, {
                          lightCone: { logicalId: selectedCone.logicalId, superimposition: Number(event.target.value) },
                        })}
                      >
                        {Array.from({ length: Math.max(1, selectedCone.superimpositionValues.length) }, (_, rank) => (
                          <option key={rank + 1} value={rank + 1}>叠影 {rank + 1}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {Array.from({ length: 3 }, (_, relicIndex) => {
                    const selectedSet = member.relicSets?.[relicIndex];
                    const selectedRelic = relics.find(({ logicalId }) => logicalId === selectedSet?.logicalId);
                    const selectedRelicIds = new Set(member.relicSets?.map(({ logicalId }) => logicalId) ?? []);
                    const disabled = relicIndex > (member.relicSets?.length ?? 0);
                    return (
                      <div className="relic-selection" key={relicIndex}>
                        <label>
                          <span>遗器套装 {relicIndex + 1}</span>
                          <select
                            aria-label={`${character.name}遗器套装 ${relicIndex + 1}`}
                            value={selectedSet?.logicalId ?? ""}
                            disabled={disabled}
                            onChange={(event) => updateRelic(slot, member, relicIndex, event.target.value)}
                          >
                            <option value="">未选择</option>
                            {relics.map((relic) => (
                              <option
                                key={relic.logicalId} value={relic.logicalId}
                                disabled={relic.logicalId !== selectedSet?.logicalId && selectedRelicIds.has(relic.logicalId)}
                              >
                                {relic.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {selectedRelic ? (
                          <label>
                            <span>套装件数</span>
                            <select
                              aria-label={`${selectedRelic.name}件数`} value={selectedSet?.pieces ?? 2}
                              onChange={(event) => updateRelicPieces(slot, member, relicIndex, Number(event.target.value))}
                            >
                              {Array.from(new Set(selectedRelic.setThresholds)).map((pieces) => (
                                <option key={pieces} value={pieces}>{pieces}件</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </>
              ) : <p className="slot-hint">选择角色后配置星魂与装备。</p>}
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
