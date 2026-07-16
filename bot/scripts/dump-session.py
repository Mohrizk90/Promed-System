#!/usr/bin/env python3
import json
from pathlib import Path

p = Path("/var/lib/promed-bot/sessions.json")
if not p.exists():
    print("no session file")
    raise SystemExit(0)

d = json.loads(p.read_text())
for cid, s in d.items():
    print(f"=== chat {cid} ===")
    print("intent:", s.get("lastUserIntent"))
    print("tools:", s.get("lastToolSummary"))
    print("pending:", s.get("pendingConfirmation"))
    for t in (s.get("turns") or [])[-16:]:
        role = t.get("role")
        if role == "user":
            txt = ((t.get("parts") or [{}])[0].get("text") or "")[:250]
            print("USER:", txt)
        elif role == "model":
            txt = " ".join(p.get("text", "") for p in (t.get("parts") or []))[:350]
            print("MODEL:", txt)
        elif role == "function":
            print("FN:", t.get("name"), str(t.get("response"))[:220])
