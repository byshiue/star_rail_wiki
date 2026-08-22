import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { loadPublicProfile, PublicProfileNotFoundError, type PublicAccountProfile } from "./publication";

export function PublicProfilePage() {
  const { uid = "" } = useParams(); const [profile, setProfile] = useState<PublicAccountProfile | null>(null); const [state, setState] = useState<"loading" | "not-found" | "error" | "ready">("loading");
  useEffect(() => { let active = true; setState("loading"); setProfile(null); void loadPublicProfile(uid).then((loaded) => { if (active) { setProfile(loaded); setState("ready"); } }).catch((error: unknown) => { if (active) setState(error instanceof PublicProfileNotFoundError ? "not-found" : "error"); }); return () => { active = false; }; }, [uid]);
  if (state === "loading") return <p role="status">正在加载公开档案…</p>;
  if (state === "not-found") return <section aria-labelledby="public-profile-title"><h1 id="public-profile-title">公开档案</h1><p>UID {uid} 尚无已合并的公开档案。</p></section>;
  if (state === "error" || !profile) return <section aria-labelledby="public-profile-title"><h1 id="public-profile-title">公开档案</h1><p role="alert">公开档案读取或验证失败。未显示未经验证的数据。</p></section>;
  return <article className="profile-page" aria-labelledby="public-profile-title"><header><p className="eyebrow">已合并的静态公开档案</p><h1 id="public-profile-title">UID {profile.uid}</h1><p>数据版本 {profile.releaseId} · 更新 {profile.updatedAt} · 同意公开 {profile.consentAt}</p></header><section><h2>角色</h2><ul>{profile.characters.map((item) => <li key={item.logicalId}>{item.logicalId} · E{item.eidolon} · Lv.{item.level}</li>)}</ul></section><section><h2>光锥</h2><ul>{profile.lightCones.map((item) => <li key={item.logicalId}>{item.logicalId} · S{item.superimposition} · Lv.{item.level}</li>)}</ul></section><section><h2>遗器</h2><ul>{profile.relics.map((item, index) => <li key={`${item.setLogicalId}:${item.slot}:${index}`}>{item.setLogicalId} · {item.slot}</li>)}</ul></section><p>撤回或更正需通过后续 Pull Request 删除或替换该文件；即使当前站点不再显示，Git 与 Pages 历史中仍可能保留旧版本。</p></article>;
}
