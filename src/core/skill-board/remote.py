#!/usr/bin/env python3
"""Skill board helper that runs on another machine (SSH host or WSL distro).

Mirrors src/core/skill-board/model.ts for one home directory and prints one JSON
document. Commands: board | link | unlink | ack | create | read | save | export |
import | guide | attach <skill> <ids> | history | restore | trash | trashlist | untrash.
Only the Python standard library is used so any host with python3 (or Windows py) works.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HOME = Path(os.environ.get("DIOS_HOME") or Path.home())
SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")
RELAY_ID = "agent-relay"
FOLDER_AGENTS = [
    ("claude", "Claude", Path(".claude") / "skills"),
    ("claude-team", "Claude Team", Path(".claude-team") / "skills"),
    ("claude-pro", "Claude Pro", Path(".claude-pro") / "skills"),
    ("codex", "Codex", Path(".codex") / "skills"),
    ("cursor", "Cursor", Path(".cursor") / "skills"),
    ("grok", "Grok", Path(".grok") / "skills"),
    ("cline", "Cline", Path(".cline") / "skills"),
    ("commandcode", "CommandCode", Path(".commandcode") / "skills"),
    ("opencode", "OpenCode", Path(".config") / "opencode" / "skills"),
]
HANGUL = re.compile(r"[가-힣]")


def canonical_dir() -> Path:
    return HOME / ".agents" / "skills"


def watch_path() -> Path:
    return HOME / ".local" / "share" / "dios" / "skill-watch.json"


def portfolio_path() -> Path:
    return HOME / ".local" / "share" / "AgentRelay" / "night-runtime" / "config" / "portfolio.json"


def is_link(path: Path) -> bool:
    if path.is_symlink():
        return True
    isjunction = getattr(os.path, "isjunction", None)
    return bool(isjunction and isjunction(str(path)))


def link_target(entry: Path) -> Path:
    """Where a link points, read without walking through it.

    Windows SSH sessions refuse to traverse junctions (WinError 448), so the
    target path is checked directly instead of through the link.
    """
    try:
        target = os.readlink(str(entry))
    except OSError:
        return entry
    if target.startswith("\\\\?\\"):
        target = target[4:]
    resolved = Path(target)
    return resolved if resolved.is_absolute() else (entry.parent / resolved)


def safe_exists(path: Path) -> bool:
    try:
        return path.exists()
    except OSError:
        return False


def is_skill_dir(entry: Path) -> bool:
    linked = is_link(entry)
    try:
        if not linked and not entry.is_dir():
            return False
    except OSError:
        return False
    real = link_target(entry) if linked else entry
    return safe_exists(real / "SKILL.md")


def list_skill_dirs(directory: Path) -> list[str]:
    if not safe_exists(directory):
        return []
    names = []
    try:
        entries = list(directory.iterdir())
    except OSError:
        return []
    for entry in entries:
        if SAFE_NAME.match(entry.name) and is_skill_dir(entry):
            names.append(entry.name)
    return sorted(names)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def read_watch() -> dict:
    try:
        parsed = json.loads(watch_path().read_text(encoding="utf-8"))
        if isinstance(parsed, dict) and isinstance(parsed.get("skills"), dict):
            return parsed
    except (OSError, ValueError):
        pass
    return {"skills": {}}


def write_watch(watch: dict) -> None:
    watch_path().parent.mkdir(parents=True, exist_ok=True)
    watch_path().write_text(json.dumps(watch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def text_print(text: str) -> str:
    """Same fingerprint as model.ts textPrint, so two computers compare without sending text."""
    return hash_text(text.replace("\r\n", "\n").strip()) if text else ""


def split_front_matter(raw: str) -> tuple[str, str]:
    if not raw.startswith("---"):
        return "", raw
    end = raw.find("\n---", 3)
    if end < 0:
        return "", raw
    front = raw[3:end]
    match = re.search(r"^description:\s*(.+)$", front, re.M)
    description = match.group(1).strip().strip("\"'") if match else ""
    return description, raw[end + 4:]


def clip(text: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    return clean if len(clean) <= limit else clean[: limit - 1] + "…"


def korean_sentence(text: str) -> str:
    """First sentence that is mostly Korean. English descriptions give an empty summary."""
    flat = re.sub(r"\s+", " ", text).strip()
    for piece in re.split(r"(?<=[.!?。])\s+", flat):
        if hangul_ratio(piece) >= 0.35:
            return clip(piece, 90)
    return ""


def hangul_ratio(text: str) -> float:
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    return sum(1 for c in chars if HANGUL.match(c)) / len(chars)


def korean_lines(body: str, limit: int = 42) -> list[str]:
    lines: list[str] = []
    fence = False
    for raw_line in body.split("\n"):
        line = raw_line.strip()
        if line.startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        item = re.sub(r"^#{1,6}\s+", "", line)
        item = re.sub(r"^[-*]\s+", "", item)
        item = re.sub(r"`[^`]*`", "", item).strip()
        if hangul_ratio(item) < 0.35:
            continue
        match = HANGUL.search(item)
        visible = clip(item[match.start():], limit) if match else ""
        if len(visible) < 4 or visible in lines:
            continue
        lines.append(visible)
    return lines


def skill_story(raw: str) -> tuple[str, list[str], list[str]]:
    description, body = split_front_matter(raw)
    full = korean_lines(body, 180)[:5] or ["이 스킬의 순서는 글을 열면 보여요."]
    return korean_sentence(description), [clip(step, 42) for step in full], full


def line_diff(before: str, after: str) -> tuple[list[str], list[str]]:
    old = [l.strip() for l in before.split("\n") if l.strip()]
    new = [l.strip() for l in after.split("\n") if l.strip()]
    old_set, new_set = set(old), set(new)
    added = [l for l in new if l not in old_set][:6]
    removed = [l for l in old if l not in new_set][:6]
    return added, removed


def read_relay_skills() -> tuple[bool, list[str]]:
    path = portfolio_path()
    if not path.exists():
        return False, []
    try:
        portfolio = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False, []
    names: set[str] = set()
    for project in portfolio.get("projects") or []:
        skills = project.get("skills") if isinstance(project, dict) else None
        if not isinstance(skills, dict):
            continue
        for items in skills.values():
            if isinstance(items, list):
                names.update(i for i in items if isinstance(i, str) and SAFE_NAME.match(i))
    return True, sorted(names)


def load_board() -> dict:
    watch = read_watch()
    dirty = False
    names = set(list_skill_dirs(canonical_dir()))
    agents = []
    agent_skills: dict[str, list[str]] = {}
    for agent_id, name, rel in FOLDER_AGENTS:
        directory = HOME / rel
        ready = safe_exists(directory.parent) or safe_exists(directory)
        skill_names = list_skill_dirs(directory) if ready else []
        names.update(skill_names)
        agent_skills[agent_id] = skill_names
        agents.append({"id": agent_id, "name": name, "ready": ready, "guideOn": guide_enabled(agent_id), "skillNames": skill_names})
    relay_ready, relay_names = read_relay_skills()
    agents.append({"id": RELAY_ID, "name": "Agent Relay", "ready": relay_ready, "guideOn": False, "skillNames": relay_names})
    names.update(relay_names)
    agent_skills[RELAY_ID] = relay_names

    skills = []
    for name in sorted(names):
        raw = read_text(canonical_dir() / name / "SKILL.md")
        summary, steps, full_steps = skill_story(raw)
        current = hash_text(raw) if raw else ""
        seen = watch["skills"].get(name)
        changed = bool(seen and current and seen.get("hash") != current)
        added, removed = line_diff(seen.get("body", ""), raw) if changed and seen else ([], [])
        if raw and not seen:
            watch["skills"][name] = {"hash": current, "body": raw[:20000]}
            dirty = True
        skills.append({
            "name": name,
            "summary": summary,
            "steps": steps,
            "fullSteps": full_steps,
            "print": text_print(raw),
            "agents": [aid for aid, items in agent_skills.items() if name in items],
            "changed": changed,
            "addedLines": added,
            "removedLines": removed,
        })
    if dirty:
        write_watch(watch)
    return {"agents": agents, "skills": skills}


def result(ok: bool, message: str) -> dict:
    return {"ok": ok, "message": message, "board": load_board()}


def make_link(src: Path, dest: Path) -> None:
    if os.name == "nt":
        try:
            os.symlink(str(src), str(dest), target_is_directory=True)
            return
        except OSError:
            subprocess.run(["cmd", "/c", "mklink", "/J", str(dest), str(src)], check=True, capture_output=True)
            return
    os.symlink(str(src), str(dest))


def same_target(link: Path, src: Path) -> bool:
    try:
        return os.path.normcase(str(link_target(link))) == os.path.normcase(str(src.resolve()))
    except OSError:
        return False


def apply_relay(portfolio: dict, skill: str, attached: bool) -> int:
    touched = 0
    for project in portfolio.get("projects") or []:
        skills = project.get("skills") if isinstance(project, dict) else None
        if not isinstance(skills, dict):
            continue
        for role, items in list(skills.items()):
            if not isinstance(items, list) or not all(isinstance(i, str) for i in items):
                continue
            has = skill in items
            if attached and not has:
                items.append(skill)
                touched += 1
            if not attached and has:
                skills[role] = [i for i in items if i != skill]
                touched += 1
    return touched


def finish_relay(skill: str, attached: bool) -> dict:
    path = portfolio_path()
    if not path.exists():
        return result(False, "Agent Relay 설정이 이 컴퓨터에 없어요.")
    try:
        portfolio = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return result(False, "Agent Relay 설정을 읽지 못했어요.")
    touched = apply_relay(portfolio, skill, attached)
    if touched:
        tmp = path.with_suffix(".json.dios-tmp")
        tmp.write_text(json.dumps(portfolio, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    if attached:
        return result(True, f"Agent Relay 작업 {touched}곳에 붙였어요." if touched else "Agent Relay에 이미 붙어 있어요.")
    return result(True, f"Agent Relay 작업 {touched}곳에서 뺐어요. 스킬 글은 그대로예요." if touched else "Agent Relay에는 이미 없어요.")


def link(agent_id: str, skill: str) -> dict:
    if not SAFE_NAME.match(skill):
        return result(False, "스킬 이름이 이상해요.")
    src = canonical_dir() / skill
    if not (src / "SKILL.md").exists():
        return result(False, "그 스킬 원본이 없어요.")
    if agent_id == RELAY_ID:
        return finish_relay(skill, True)
    agent = next((a for a in FOLDER_AGENTS if a[0] == agent_id), None)
    if not agent:
        return result(False, "그 에이전트는 없어요.")
    dest_dir = HOME / agent[2]
    dest = dest_dir / skill
    dest_dir.mkdir(parents=True, exist_ok=True)
    if is_link(dest):
        same = same_target(dest, src)
        return result(same, f"{agent[1]}에 이미 붙어 있어요." if same else "다른 곳을 가리키고 있어서 바꾸지 않았어요.")
    if safe_exists(dest):
        return result(False, "이 에이전트 안에 스킬 복사본이 있어서 링크만 달지는 않았어요.")
    make_link(src, dest)
    return result(True, f"{agent[1]}에 붙였어요.")


def unlink(agent_id: str, skill: str) -> dict:
    if not SAFE_NAME.match(skill):
        return result(False, "스킬 이름이 이상해요.")
    if agent_id == RELAY_ID:
        return finish_relay(skill, False)
    agent = next((a for a in FOLDER_AGENTS if a[0] == agent_id), None)
    if not agent:
        return result(False, "그 에이전트는 없어요.")
    dest = HOME / agent[2] / skill
    linked = is_link(dest)
    if not (linked or safe_exists(dest)):
        return result(True, f"{agent[1]}에는 이미 없어요.")
    if not linked:
        return result(False, "원본 폴더라서 빼지 않았어요. 스킬 글은 그대로예요.")
    if os.name == "nt" and not dest.is_symlink():
        os.rmdir(dest)
    else:
        os.unlink(dest)
    return result(True, f"{agent[1]}에서 뺐어요. 스킬 글은 그대로예요.")


def ack(skill: str) -> dict:
    if not SAFE_NAME.match(skill):
        return result(False, "스킬 이름이 이상해요.")
    raw = read_text(canonical_dir() / skill / "SKILL.md")
    if not raw:
        return result(False, "그 스킬 글이 없어요.")
    watch = read_watch()
    watch["skills"][skill] = {"hash": hash_text(raw), "body": raw[:20000]}
    write_watch(watch)
    return result(True, "바뀐 글을 확인했어요.")


MARKER = "<!-- founder-gate-relay-always -->"
GUIDE_FILES = {
    "claude": (Path(".claude") / "CLAUDE.md", False, False),
    "claude-team": (Path(".claude-team") / "CLAUDE.md", False, False),
    "claude-pro": (Path(".claude-pro") / "CLAUDE.md", False, False),
    "codex": (Path(".codex") / "AGENTS.md", False, False),
    "cursor": (Path(".cursor") / "rules" / "founder-gate-relay.mdc", True, True),
    "grok": (Path(".grok") / "rules" / "founder-gate.md", True, False),
    "cline": (Path(".cline") / "rules" / "founder-gate.md", True, False),
    "commandcode": (Path(".commandcode") / "AGENTS.md", False, False),
    "opencode": (Path(".config") / "opencode" / "AGENTS.md", False, False),
}
BUNDLED_GUIDE = MARKER + "\n# Founder Gate\n\nSend Founder work with founder-gate-relay before asking in chat.\n"


def guide_enabled(agent_id: str) -> bool:
    spec = GUIDE_FILES.get(agent_id)
    if not spec:
        return False
    return MARKER in read_text(HOME / spec[0])


def pack_path() -> Path:
    return HOME / ".dios-pack.json"


def take_pack() -> dict:
    path = pack_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    try:
        path.unlink()
    except OSError:
        pass
    return data if isinstance(data, dict) else {}


def remember_skill(name: str, text: str) -> None:
    watch = read_watch()
    watch["skills"][name] = {"hash": hash_text(text), "body": text[:20000]}
    write_watch(watch)


def create_skill() -> dict:
    data = take_pack()
    name = str(data.get("name") or "")
    summary = re.sub(r"\s+", " ", str(data.get("summary") or "")).strip()
    steps = [str(step).strip() for step in (data.get("steps") or []) if str(step).strip()]
    if not SAFE_NAME.match(name):
        return result(False, "이름은 영문 소문자와 줄표로 적어 주세요. 예: weekly-report")
    if not summary:
        return result(False, "하는 일을 한 문장으로 적어 주세요.")
    if not steps:
        return result(False, "순서를 한 줄씩 적어 주세요.")
    dest = canonical_dir() / name / "SKILL.md"
    if dest.exists():
        return result(False, "이미 있는 스킬이에요.")
    body = "\n".join(f"- {step}" for step in steps)
    text = f"---\nname: {name}\ndescription: {summary}\n---\n\n# {name}\n\n{body}\n"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    remember_skill(name, text)
    extra = attach_summary(*attach_many(name, [str(i) for i in data.get("agentIds") or []]))
    return result(True, f"스킬을 등록했어요. {extra}" if extra else "스킬을 등록했어요. 에이전트 카드에서 붙이면 돼요.")


def agent_label(agent_id: str) -> str:
    if agent_id == RELAY_ID:
        return "Agent Relay"
    agent = next((item for item in FOLDER_AGENTS if item[0] == agent_id), None)
    return agent[1] if agent else agent_id


def agent_ready(agent_id: str) -> bool:
    if agent_id == RELAY_ID:
        return read_relay_skills()[0]
    agent = next((item for item in FOLDER_AGENTS if item[0] == agent_id), None)
    return bool(agent and (safe_exists((HOME / agent[2]).parent) or safe_exists(HOME / agent[2])))


def attach_many(skill: str, agent_ids: list[str]) -> tuple[list[str], list[str]]:
    """Attach to every ready agent in one run. Unready or refused agents are skipped."""
    linked, skipped = [], []
    for agent_id in agent_ids:
        if not agent_id:
            continue
        label = agent_label(agent_id)
        if not agent_ready(agent_id):
            skipped.append(label)
            continue
        (linked if link(agent_id, skill).get("ok") else skipped).append(label)
    return linked, skipped


def attach_summary(linked: list[str], skipped: list[str]) -> str:
    parts = []
    if linked:
        parts.append(f"{', '.join(linked)}에 붙였어요.")
    if skipped:
        parts.append(f"빼 둔 곳: {', '.join(skipped)}.")
    return " ".join(parts)


def attach(skill: str, ids: str) -> dict:
    if not SAFE_NAME.match(skill):
        return result(False, "스킬 이름이 이상해요.")
    if not (canonical_dir() / skill / "SKILL.md").exists():
        return result(False, "그 스킬 원본이 없어요.")
    text = attach_summary(*attach_many(skill, [i for i in ids.split(",") if i]))
    return result(True, text)


HISTORY_KEEP = 10


def history_dir(name: str) -> Path:
    return HOME / ".local" / "share" / "dios" / "skill-history" / name


def trash_dir() -> Path:
    return HOME / ".local" / "share" / "dios" / "skill-trash"


def stamp() -> str:
    return str(int(time.time() * 1000))


def keep_history(name: str, text: str) -> None:
    """Keep the text that is about to be replaced. Only the newest ten stay."""
    if not text:
        return
    folder = history_dir(name)
    folder.mkdir(parents=True, exist_ok=True)
    versions = sorted(p for p in folder.glob("*.md"))
    if versions and read_text(versions[-1]) == text:
        return
    dest = folder / f"{stamp()}.md"
    while dest.exists():
        dest = folder / f"{int(dest.stem.split('-')[0]) + 1}.md"
    dest.write_text(text, encoding="utf-8")
    for old in sorted(folder.glob("*.md"))[:-HISTORY_KEEP]:
        try:
            old.unlink()
        except OSError:
            pass


def changed_lines(before: str, after: str) -> int:
    old = {line.strip() for line in before.split("\n") if line.strip()}
    new = {line.strip() for line in after.split("\n") if line.strip()}
    return len(old ^ new)


def list_history(name: str) -> dict:
    if not SAFE_NAME.match(name):
        return {"ok": False, "message": "스킬 이름이 이상해요.", "versions": []}
    current = read_text(canonical_dir() / name / "SKILL.md")
    versions = []
    folder = history_dir(name)
    if folder.exists():
        for file in sorted(folder.glob("*.md"), reverse=True):
            if not file.stem.isdigit():
                continue
            versions.append({"id": file.stem, "when": int(file.stem), "diff": changed_lines(read_text(file), current)})
    return {"ok": True, "message": "" if versions else "아직 보관된 이전 글이 없어요.", "versions": versions}


def restore_version(name: str, version: str) -> dict:
    if not SAFE_NAME.match(name) or not version.isdigit():
        return result(False, "되돌릴 글을 찾지 못했어요.")
    old = read_text(history_dir(name) / f"{version}.md")
    dest = canonical_dir() / name / "SKILL.md"
    if not old:
        return result(False, "되돌릴 글을 찾지 못했어요.")
    if not dest.exists():
        return result(False, "그 스킬 글이 없어요.")
    current = read_text(dest)
    if current == old:
        return result(True, "지금 글과 같아요.")
    keep_history(name, current)
    dest.write_text(old, encoding="utf-8")
    remember_skill(name, old)
    return result(True, "이전 글로 되돌렸어요. 방금 글도 이전 글에 보관했어요.")


def trash_skill(name: str) -> dict:
    """Move a skill to Dios's trash after taking it off every agent. It can come back."""
    if not SAFE_NAME.match(name):
        return result(False, "스킬 이름이 이상해요.")
    src = canonical_dir() / name
    if not (src / "SKILL.md").exists():
        return result(False, "그 스킬 원본이 없어요.")
    board = load_board()
    attached = next((s["agents"] for s in board["skills"] if s["name"] == name), [])
    kept, removed = [], []
    for agent_id in attached:
        (removed if unlink(agent_id, name).get("ok") else kept).append(agent_id)
    if kept:
        return result(False, f"{', '.join(agent_label(i) for i in kept)} 안에 복사본이 있어서 지우지 않았어요.")
    trash_dir().mkdir(parents=True, exist_ok=True)
    item_id = f"{name}--{stamp()}"
    shutil.move(str(src), str(trash_dir() / item_id))
    meta = {"name": name, "when": int(item_id.rsplit("--", 1)[1]), "agents": removed}
    (trash_dir() / f"{item_id}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return result(True, "휴지통으로 옮겼어요. 휴지통에서 다시 꺼낼 수 있어요.")


def list_trash() -> dict:
    items = []
    folder = trash_dir()
    if folder.exists():
        for meta_file in sorted(folder.glob("*.json"), reverse=True):
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if (folder / meta_file.stem).is_dir():
                items.append({"id": meta_file.stem, "name": meta.get("name", ""), "when": meta.get("when", 0), "agents": meta.get("agents", [])})
    return {"ok": True, "message": "" if items else "휴지통이 비어 있어요.", "items": items}


def untrash(item_id: str) -> dict:
    if not re.match(r"^[a-z0-9][a-z0-9-]{0,80}--\d+$", item_id):
        return result(False, "휴지통에서 찾지 못했어요.")
    folder = trash_dir() / item_id
    meta_file = trash_dir() / f"{item_id}.json"
    if not folder.is_dir():
        return result(False, "휴지통에서 찾지 못했어요.")
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    name = item_id.rsplit("--", 1)[0]
    dest = canonical_dir() / name
    if dest.exists():
        return result(False, "같은 이름의 스킬이 이미 있어서 꺼내지 않았어요.")
    canonical_dir().mkdir(parents=True, exist_ok=True)
    shutil.move(str(folder), str(dest))
    try:
        meta_file.unlink()
    except OSError:
        pass
    extra = attach_summary(*attach_many(name, [str(i) for i in meta.get("agents") or []]))
    return result(True, f"다시 꺼냈어요. {extra}".strip())


def read_skill(name: str) -> dict:
    if not SAFE_NAME.match(name):
        return {"ok": False, "message": "스킬 이름이 이상해요.", "text": ""}
    text = read_text(canonical_dir() / name / "SKILL.md")
    if not text:
        return {"ok": False, "message": "그 스킬 글이 없어요.", "text": ""}
    return {"ok": True, "message": "", "text": text}


def save_skill() -> dict:
    data = take_pack()
    name = str(data.get("name") or "")
    text = str(data.get("text") or "")
    if not SAFE_NAME.match(name):
        return result(False, "스킬 이름이 이상해요.")
    dest = canonical_dir() / name / "SKILL.md"
    if not dest.exists():
        return result(False, "그 스킬 글이 없어요.")
    if not text.endswith("\n"):
        text += "\n"
    if "name:" not in text:
        return result(False, "스킬 이름 줄이 있어야 저장돼요.")
    previous = read_text(dest)
    keep_history(name, previous)
    dest.write_text(text, encoding="utf-8")
    remember_skill(name, text)
    old = {line.strip() for line in previous.split("\n") if line.strip()}
    new = {line.strip() for line in text.split("\n") if line.strip()}
    return result(True, f"저장했어요. {len(new - old)}줄이 들어오고 {len(old - new)}줄이 빠졌어요.")


def export_skill(name: str) -> dict:
    if not SAFE_NAME.match(name):
        return {"ok": False, "message": "스킬 이름이 이상해요.", "pack": None}
    root = canonical_dir() / name
    if not (root / "SKILL.md").exists():
        return {"ok": False, "message": "그 스킬 원본이 없어요.", "pack": None}
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [item for item in dirnames if item not in {".git", "node_modules"}]
        for filename in filenames:
            if len(files) >= 40:
                break
            full = Path(dirpath) / filename
            if full.stat().st_size > 256000:
                continue
            raw = full.read_bytes()
            if b"\0" in raw:
                continue
            rel = full.relative_to(root).as_posix()
            files.append({"path": rel, "text": raw.decode("utf-8")})
    return {"ok": True, "message": "", "pack": {"name": name, "files": files}}


def import_skill(overwrite: bool) -> dict:
    data = take_pack()
    name = str(data.get("name") or "")
    files = data.get("files") or []
    if not SAFE_NAME.match(name):
        return result(False, "스킬 이름이 이상해요.")
    skill = next((item for item in files if isinstance(item, dict) and item.get("path") == "SKILL.md" and item.get("text")), None)
    if not skill:
        return result(False, "보낼 스킬 글이 없어요.")
    root = canonical_dir() / name
    if (root / "SKILL.md").exists() and not overwrite:
        return result(False, "이미 있어요.")
    keep_history(name, read_text(root / "SKILL.md"))
    base = root.resolve()
    for item in files:
        if not isinstance(item, dict):
            return result(False, "스킬 안에 이상한 경로가 있어요.")
        rel = str(item.get("path") or "")
        if not rel or rel.startswith("/") or ".." in rel or "\\" in rel:
            return result(False, "스킬 안에 이상한 경로가 있어요.")
        dest = (root / rel).resolve()
        if dest != base and base not in dest.parents:
            return result(False, "스킬 안에 이상한 경로가 있어요.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(str(item.get("text") or ""), encoding="utf-8")
    text = str(skill["text"])
    remember_skill(name, text if text.endswith("\n") else text + "\n")
    return result(True, "그 컴퓨터의 스킬 글을 바꿨어요." if overwrite else "그 컴퓨터에 스킬을 보냈어요.")


def guide_text() -> str:
    file = canonical_dir() / "founder-gate-relay" / "always.md"
    text = read_text(file)
    if MARKER in text:
        return text if text.endswith("\n") else text + "\n"
    return BUNDLED_GUIDE


def set_guide(agent_id: str, on: bool) -> dict:
    spec = GUIDE_FILES.get(agent_id)
    if not spec:
        return result(False, "그 에이전트에는 매 대화 안내가 없어요.")
    file = HOME / spec[0]
    current = read_text(file)
    enabled = MARKER in current
    if on and enabled:
        return result(True, "이미 켜져 있어요.")
    if not on and not enabled:
        return result(True, "이미 꺼져 있어요.")
    if not on:
        kept = current[: current.index(MARKER)].rstrip()
        only_front = bool(re.match(r"^---\s*\ndescription:[\s\S]*alwaysApply:\s*true\s*\n---\s*$", kept))
        if not kept or (spec[1] and only_front):
            try:
                file.unlink()
            except OSError:
                pass
        else:
            file.write_text(kept + "\n", encoding="utf-8")
        return result(True, "매 대화 안내를 껐어요.")
    block = guide_text()
    if spec[2]:
        block = "---\ndescription: Send Founder work to MainPC HumanGate before asking only in chat\nalwaysApply: true\n---\n\n" + block
    base = (current[: current.index(MARKER)] if enabled else current).rstrip()
    nxt = f"{base}\n\n{block}" if base else block
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(nxt if nxt.endswith("\n") else nxt + "\n", encoding="utf-8")
    return result(True, "매 대화 안내를 켰어요.")


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = argv[1] if len(argv) > 1 else "board"
    if cmd == "board":
        out = load_board()
    elif cmd == "link" and len(argv) >= 4:
        out = link(argv[2], argv[3])
    elif cmd == "unlink" and len(argv) >= 4:
        out = unlink(argv[2], argv[3])
    elif cmd == "ack" and len(argv) >= 3:
        out = ack(argv[2])
    elif cmd == "create":
        out = create_skill()
    elif cmd == "read" and len(argv) >= 3:
        out = read_skill(argv[2])
    elif cmd == "save":
        out = save_skill()
    elif cmd == "export" and len(argv) >= 3:
        out = export_skill(argv[2])
    elif cmd == "import":
        out = import_skill(len(argv) >= 3 and argv[2] == "1")
    elif cmd == "guide" and len(argv) >= 4:
        out = set_guide(argv[2], argv[3] == "1")
    elif cmd == "attach" and len(argv) >= 3:
        out = attach(argv[2], argv[3] if len(argv) >= 4 else "")
    elif cmd == "history" and len(argv) >= 3:
        out = list_history(argv[2])
    elif cmd == "restore" and len(argv) >= 4:
        out = restore_version(argv[2], argv[3])
    elif cmd == "trash" and len(argv) >= 3:
        out = trash_skill(argv[2])
    elif cmd == "trashlist":
        out = list_trash()
    elif cmd == "untrash" and len(argv) >= 3:
        out = untrash(argv[2])
    else:
        out = {"ok": False, "message": "모르는 명령이에요.", "board": {"agents": [], "skills": []}}
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
